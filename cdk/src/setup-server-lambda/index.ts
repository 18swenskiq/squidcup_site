import { sendRconCommand, getServerInfoForGame } from '@squidcup/shared-lambda-utils';

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

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({ 
        message: `Server setup initiated successfully for game ${gameId} - MatchZy plugin verified`,
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
        timestamp: new Date().toISOString()
      }),
    };

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
