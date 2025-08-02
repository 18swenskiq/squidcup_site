import { sendRconCommand, getServerInfoForGame, getGameWithPlayers, getGameTeams, getUsersBySteamIds } from '@squidcup/shared-lambda-utils';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Initialize S3 client
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

interface MatchZyConfig {
  matchid: string;
  team1: {
    name: string;
    players: Record<string, string>;
  };
  team2: {
    name: string;
    players: Record<string, string>;
  };
  num_maps: number;
  maplist: string[];
  map_sides: string[];
  players_per_team: number;
  cvars: {
    hostname: string;
  };
}

async function generateAndUploadMatchZyConfig(gameId: string, serverInfo: any): Promise<string> {
  // Get game details with players and teams
  const gameWithPlayers = await getGameWithPlayers(gameId);
  if (!gameWithPlayers) {
    throw new Error(`Game ${gameId} not found`);
  }

  // Get team information
  const teams = await getGameTeams(gameId);
  console.log('Teams found:', teams);

  // Get user information for all players
  const playerSteamIds = gameWithPlayers.players.map(p => p.player_steam_id);
  const users = await getUsersBySteamIds(playerSteamIds);
  console.log('Users found:', users.length);

  // Create a map of steamId to username for quick lookup
  const steamIdToUsername = new Map();
  users.forEach(user => {
    steamIdToUsername.set(user.steam_id, user.username || `Player_${user.steam_id.slice(-4)}`);
  });

  // Group players by team
  const team1Players: Record<string, string> = {};
  const team2Players: Record<string, string> = {};
  
  // Default team names and ELOs
  let team1Name = 'Team 1';
  let team2Name = 'Team 2';
  let team1AvgElo = 1000;
  let team2AvgElo = 1000;
  
  // Use actual team information if available
  if (teams.length >= 2) {
    const team1 = teams.find(t => t.team_number === 1);
    const team2 = teams.find(t => t.team_number === 2);
    
    if (team1) {
      team1Name = team1.team_name;
      team1AvgElo = team1.average_elo;
    }
    if (team2) {
      team2Name = team2.team_name;
      team2AvgElo = team2.average_elo;
    }
  }

  // Assign players to teams based on team_id
  for (const player of gameWithPlayers.players) {
    const username = steamIdToUsername.get(player.player_steam_id) || `Player_${player.player_steam_id.slice(-4)}`;
    
    // If we have team information, use it; otherwise split evenly
    if (player.team_id && teams.length > 0) {
      const playerTeam = teams.find(t => t.id === player.team_id);
      if (playerTeam?.team_number === 1) {
        team1Players[player.player_steam_id] = username;
      } else if (playerTeam?.team_number === 2) {
        team2Players[player.player_steam_id] = username;
      } else {
        // Fallback if team not found
        if (Object.keys(team1Players).length <= Object.keys(team2Players).length) {
          team1Players[player.player_steam_id] = username;
        } else {
          team2Players[player.player_steam_id] = username;
        }
      }
    } else {
      // Fallback: split players evenly if no team assignment
      if (Object.keys(team1Players).length <= Object.keys(team2Players).length) {
        team1Players[player.player_steam_id] = username;
      } else {
        team2Players[player.player_steam_id] = username;
      }
    }
  }

  const playersPerTeam = Math.max(Object.keys(team1Players).length, Object.keys(team2Players).length);

  // Build the MatchZy configuration
  const config: MatchZyConfig = {
    matchid: gameId,
    team1: {
      name: team1Name,
      players: team1Players
    },
    team2: {
      name: team2Name,
      players: team2Players
    },
    num_maps: 1,
    maplist: [gameWithPlayers.map || 'de_dust2'], // Use selected map or default
    map_sides: [
      'team1_ct',
      'team2_ct',
      'knife'
    ],
    players_per_team: playersPerTeam,
    cvars: {
      hostname: `Squidcup: ${team1Name} (${team1AvgElo}) vs ${team2Name} (${team2AvgElo})`
    }
  };

  console.log('Generated MatchZy config:', JSON.stringify(config, null, 2));

  // Convert to JSON string
  const configJson = JSON.stringify(config, null, 2);
  
  // Upload to S3
  const bucketName = process.env.GAME_CONFIGS_BUCKET;
  if (!bucketName) {
    throw new Error('GAME_CONFIGS_BUCKET environment variable not set');
  }
  
  const fileName = `${gameId}.json`;
  
  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: configJson,
    ContentType: 'application/json',
    CacheControl: 'no-cache'
  });

  await s3Client.send(putCommand);
  
  // Return the public URL
  const publicUrl = `https://${bucketName}.s3.amazonaws.com/${fileName}`;
  console.log('MatchZy config uploaded to:', publicUrl);
  
  return publicUrl;
}

export async function handler(event: any): Promise<any> {
  console.log('Hello world - setup server lambda called');
  console.log('Event received:', JSON.stringify(event, null, 2));

  // Extract gameId from the event payload
  const gameId = event.gameId;
  console.log('Game ID:', gameId);

  if (!gameId) {
    console.error('No gameId provided in event');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'gameId is required' }),
    };
  }

  // Get server information for this game from the database
  try {
    console.log(`Looking up server info for game ${gameId}...`);
    const serverInfo = await getServerInfoForGame(gameId);
    
    if (!serverInfo) {
      console.error(`No server found for game ${gameId}`);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Server not found for this game' }),
      };
    }

    console.log('Server info found:', {
      id: serverInfo.id,
      ip: serverInfo.ip,
      port: serverInfo.port,
      nickname: serverInfo.nickname
    });

    // Check for CounterStrikeSharp and MatchZy plugin
    console.log(`Checking for CounterStrikeSharp and MatchZy plugin on ${serverInfo.ip}:${serverInfo.port} for game ${gameId}...`);
    const rconResult = await sendRconCommand(
      serverInfo.ip, 
      serverInfo.port, 
      serverInfo.rcon_password, 
      'css_plugins list'
    );
    
    if (rconResult.success) {
      console.log('RCON css_plugins Response:', rconResult.response);
      
      // Check if CounterStrikeSharp is installed
      if (rconResult.response?.includes("Unknown command 'css_plugins'")) {
        console.error('CounterStrikeSharp is not installed on the server');
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          },
          body: JSON.stringify({ 
            error: 'CounterStrikeSharp is not installed on the server',
            gameId: gameId,
            serverInfo: {
              id: serverInfo.id,
              ip: serverInfo.ip,
              port: serverInfo.port,
              nickname: serverInfo.nickname
            },
            timestamp: new Date().toISOString()
          }),
        };
      }
      
      // Check if MatchZy plugin is loaded
      if (!rconResult.response?.includes('MatchZy')) {
        console.error('MatchZy plugin is not loaded on the server');
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          },
          body: JSON.stringify({ 
            error: 'MatchZy plugin is not loaded on the server',
            gameId: gameId,
            serverInfo: {
              id: serverInfo.id,
              ip: serverInfo.ip,
              port: serverInfo.port,
              nickname: serverInfo.nickname
            },
            pluginsList: rconResult.response,
            timestamp: new Date().toISOString()
          }),
        };
      }
      
      console.log('MatchZy plugin found and loaded successfully');
      
      // Generate MatchZy configuration and upload to S3
      try {
        const configFileUrl = await generateAndUploadMatchZyConfig(gameId, serverInfo);
        console.log('MatchZy config uploaded successfully:', configFileUrl);
        
        // Load the match configuration on the server via RCON
        console.log(`Loading MatchZy config on server ${serverInfo.ip}:${serverInfo.port}...`);
        const loadMatchResult = await sendRconCommand(
          serverInfo.ip,
          serverInfo.port,
          serverInfo.rcon_password,
          `matchzy_loadmatch_url "${configFileUrl}"`
        );
        
        if (loadMatchResult.success) {
          console.log('MatchZy config loaded successfully:', loadMatchResult.response);
          
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
              'Access-Control-Allow-Headers': 'Content-Type,Authorization',
              'Access-Control-Allow-Methods': 'POST,OPTIONS',
            },
            body: JSON.stringify({ 
              message: `Server setup completed successfully for game ${gameId} - MatchZy config loaded`,
              serverInfo: {
                id: serverInfo.id,
                ip: serverInfo.ip,
                port: serverInfo.port,
                nickname: serverInfo.nickname
              },
              pluginCheck: {
                success: true,
                matchZyFound: true,
                pluginsList: rconResult.response
              },
              configFile: {
                url: configFileUrl,
                uploaded: true,
                loaded: true,
                loadResponse: loadMatchResult.response
              },
              timestamp: new Date().toISOString()
            }),
          };
        } else {
          console.error('Failed to load MatchZy config on server:', loadMatchResult.error);
          return {
            statusCode: 500,
            headers: {
              'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
            },
            body: JSON.stringify({ 
              error: 'MatchZy config uploaded but failed to load on server',
              gameId: gameId,
              serverInfo: {
                id: serverInfo.id,
                ip: serverInfo.ip,
                port: serverInfo.port,
                nickname: serverInfo.nickname
              },
              configFile: {
                url: configFileUrl,
                uploaded: true,
                loaded: false
              },
              loadError: loadMatchResult.error,
              timestamp: new Date().toISOString()
            }),
          };
        }
      } catch (configError) {
        console.error('Failed to generate or upload MatchZy config:', configError);
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
          },
          body: JSON.stringify({ 
            error: 'MatchZy plugin verified but failed to generate configuration',
            gameId: gameId,
            serverInfo: {
              id: serverInfo.id,
              ip: serverInfo.ip,
              port: serverInfo.port,
              nickname: serverInfo.nickname
            },
            configError: configError instanceof Error ? configError.message : 'Unknown error',
            timestamp: new Date().toISOString()
          }),
        };
      }
    } else {
      console.log('RCON Error:', rconResult.error);
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        },
        body: JSON.stringify({ 
          error: 'Failed to connect to server via RCON',
          gameId: gameId,
          serverInfo: {
            id: serverInfo.id,
            ip: serverInfo.ip,
            port: serverInfo.port,
            nickname: serverInfo.nickname
          },
          rconError: rconResult.error,
          timestamp: new Date().toISOString()
        }),
      };
    }

  } catch (error) {
    console.error('Error in server setup:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      },
      body: JSON.stringify({ 
        error: 'Failed to setup server',
        gameId: gameId,
        timestamp: new Date().toISOString()
      }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
