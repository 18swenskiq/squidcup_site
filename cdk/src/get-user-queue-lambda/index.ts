import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, ScanCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });

interface SessionData {
  userId: string;
  expiresAt: string;
  createdAt: string;
}

// Function to extract numeric Steam ID from OpenID URL
function extractSteamIdFromOpenId(steamId: string): string {
  // Handle null/undefined steamId
  if (!steamId) {
    console.error('steamId is null or undefined');
    return '';
  }
  
  // If it's already a numeric Steam ID, return as is
  if (/^\d+$/.test(steamId)) {
    return steamId;
  }
  
  // Extract from OpenID URL format: https://steamcommunity.com/openid/id/76561198041569692
  const match = steamId.match(/\/id\/(\d+)$/);
  if (match && match[1]) {
    return match[1];
  }
  
  // If no match found, return the original value
  console.warn('Could not extract Steam ID from:', steamId);
  return steamId;
}

// Function to get player names by Steam IDs
async function getPlayerNames(steamIds: string[]): Promise<Map<string, string>> {
  const playerNames = new Map<string, string>();
  
  if (steamIds.length === 0) {
    return playerNames;
  }

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    console.error('TABLE_NAME environment variable not set');
    // Fallback: create names for all Steam IDs
    for (const steamId of steamIds) {
      playerNames.set(steamId, `Player ${steamId.slice(-4)}`);
    }
    return playerNames;
  }

  try {
    // Create batch get request for all unique Steam IDs
    const uniqueSteamIds = [...new Set(steamIds)];
    
    // DynamoDB BatchGetItem has a limit of 100 items
    const batchSize = 100;
    
    for (let i = 0; i < uniqueSteamIds.length; i += batchSize) {
      const batch = uniqueSteamIds.slice(i, i + batchSize);
      
      const requestItems: any = {};
      requestItems[tableName] = {
        Keys: batch.map(steamId => ({
          pk: { S: `PLAYER#${steamId}` },
          sk: { S: 'PROFILE' }
        }))
      };

      const batchGetCommand = new BatchGetItemCommand({
        RequestItems: requestItems
      });

      const result = await dynamoClient.send(batchGetCommand);
      
      if (result.Responses && result.Responses[tableName]) {
        for (const item of result.Responses[tableName]) {
          const player = unmarshall(item);
          playerNames.set(player.steamId, player.name || `Player ${player.steamId.slice(-4)}`);
        }
      }
    }

    // For any Steam IDs that weren't found in the database, use a fallback name
    for (const steamId of uniqueSteamIds) {
      if (!playerNames.has(steamId)) {
        playerNames.set(steamId, `Player ${steamId.slice(-4)}`);
      }
    }

    console.log('Retrieved player names:', Object.fromEntries(playerNames));
    return playerNames;
    
  } catch (error) {
    console.error('Error getting player names:', error);
    
    // Fallback: create names for all Steam IDs
    for (const steamId of steamIds) {
      playerNames.set(steamId, `Player ${steamId.slice(-4)}`);
    }
    
    return playerNames;
  }
}

interface ActiveQueueData {
  pk: string;
  sk: string;
  hostSteamId: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  password?: string;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    joinTime: string;
    name?: string; // Add optional name field
  }>;
  createdAt: string;
  updatedAt: string;
}

interface LobbyPlayer {
  steamId: string;
  team?: number;
  mapSelection?: string;
  hasSelectedMap?: boolean;
  name?: string; // Add optional name field
}

interface LobbyData {
  pk: string;
  sk: string;
  id: string;
  hostSteamId: string;
  gameMode: string;
  mapSelectionMode: string;
  serverId: string;
  password?: string;
  ranked: boolean;
  players: LobbyPlayer[];
  mapSelectionComplete: boolean;
  selectedMap?: string;
  createdAt: string;
  updatedAt: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get user queue handler started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Get session token from headers
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No session token provided' }),
      };
    }

    // Extract token from Bearer format
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    // Validate session
    const sessionQuery = new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `SESSION#${sessionToken}` },
      },
    });

    const sessionResult = await dynamoClient.send(sessionQuery);
    if (!sessionResult.Items || sessionResult.Items.length === 0) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session token' }),
      };
    }

    const sessionData = unmarshall(sessionResult.Items[0]) as SessionData;
    
    // Check if session is expired
    const expiresAtTime = new Date(sessionData.expiresAt).getTime();
    if (expiresAtTime < Date.now()) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Session expired' }),
      };
    }

    const userSteamId = extractSteamIdFromOpenId(sessionData.userId);
    console.log('User Steam ID:', userSteamId);

    // First check if user is in a lobby
    const lobbyScanCommand = new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix)',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'LOBBY#' },
      },
    });

    const lobbyResult = await dynamoClient.send(lobbyScanCommand);
    
    if (lobbyResult.Items && lobbyResult.Items.length > 0) {
      for (const item of lobbyResult.Items) {
        const lobbyData = unmarshall(item) as LobbyData;
        const isInLobby = lobbyData.players.some(player => player.steamId === userSteamId);
        
        if (isInLobby) {
          console.log('User found in lobby:', lobbyData.pk);
          const isHost = lobbyData.hostSteamId === userSteamId;
          
          // Get player names for all players in the lobby
          const allSteamIds = [lobbyData.hostSteamId, ...lobbyData.players.map(p => p.steamId)];
          const playerNames = await getPlayerNames(allSteamIds);
          
          // Enrich players with names
          const enrichedPlayers = lobbyData.players.map(player => ({
            ...player,
            name: playerNames.get(player.steamId) || `Player ${player.steamId.slice(-4)}`
          }));
          
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              inLobby: true,
              isHost: isHost,
              lobby: {
                id: lobbyData.id,
                hostSteamId: lobbyData.hostSteamId,
                hostName: playerNames.get(lobbyData.hostSteamId) || `Player ${lobbyData.hostSteamId.slice(-4)}`,
                gameMode: lobbyData.gameMode,
                mapSelectionMode: lobbyData.mapSelectionMode,
                serverId: lobbyData.serverId,
                hasPassword: !!lobbyData.password,
                ranked: lobbyData.ranked,
                players: enrichedPlayers,
                mapSelectionComplete: lobbyData.mapSelectionComplete,
                selectedMap: lobbyData.selectedMap,
                createdAt: lobbyData.createdAt,
                updatedAt: lobbyData.updatedAt,
              }
            }),
          };
        }
      }
    }

    // Query for active queues where the user is the host
    const hostScanCommand = new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix) AND hostSteamId = :hostSteamId',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'ACTIVEQUEUE#' },
        ':hostSteamId': { S: userSteamId },
      },
    });

    const hostResult = await dynamoClient.send(hostScanCommand);
    
    console.log('Host scan result:', hostResult.Items ? `Found ${hostResult.Items.length} hosted queues` : 'No hosted queues found');
    
    if (hostResult.Items && hostResult.Items.length > 0) {
      const queueData = unmarshall(hostResult.Items[0]) as ActiveQueueData;
      console.log('User is hosting queue:', queueData.pk);
      
      // Get player names for host and all joiners
      const allSteamIds = [queueData.hostSteamId, ...queueData.joiners.map(j => j.steamId)];
      const playerNames = await getPlayerNames(allSteamIds);
      
      // Enrich joiners with names
      const enrichedJoiners = queueData.joiners.map(joiner => ({
        ...joiner,
        name: playerNames.get(joiner.steamId) || `Player ${joiner.steamId.slice(-4)}`
      }));
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          inQueue: true,
          isHost: true,
          queue: {
            id: queueData.pk.replace('ACTIVEQUEUE#', ''),
            hostSteamId: queueData.hostSteamId,
            hostName: playerNames.get(queueData.hostSteamId) || `Player ${queueData.hostSteamId.slice(-4)}`,
            gameMode: queueData.gameMode,
            mapSelectionMode: queueData.mapSelectionMode,
            serverId: queueData.serverId,
            hasPassword: !!queueData.password,
            ranked: queueData.ranked,
            startTime: queueData.startTime,
            joiners: enrichedJoiners,
            createdAt: queueData.createdAt,
            updatedAt: queueData.updatedAt,
          }
        }),
      };
    }

    // If not a host, query all active queues to see if user is a joiner
    let allQueuesResult;
    try {
      const allQueuesQuery = new QueryCommand({
        TableName: process.env.TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': { S: 'ACTIVEQUEUE' },
        },
      });

      allQueuesResult = await dynamoClient.send(allQueuesQuery);
    } catch (error: any) {
      console.error('Error querying GSI1 (might be backfilling):', error);
      
      // Handle specific GSI backfilling errors
      if (error.name === 'ValidationException' && 
          (error.message?.includes('GSI1') || error.message?.includes('Global Secondary Index'))) {
        console.log('GSI1 is likely still backfilling, using fallback scan method');
      }
      
      // If GSI is backfilling, fall back to scanning the main table
      // This is less efficient but works while the GSI is being created
      const scanCommand = new ScanCommand({
        TableName: process.env.TABLE_NAME,
        FilterExpression: 'begins_with(pk, :pkPrefix)',
        ExpressionAttributeValues: {
          ':pkPrefix': { S: 'ACTIVEQUEUE#' },
        },
      });

      allQueuesResult = await dynamoClient.send(scanCommand);
    }
    
    if (allQueuesResult.Items) {
      console.log('Checking', allQueuesResult.Items.length, 'queues for user participation');
      for (const item of allQueuesResult.Items) {
        const queueData = unmarshall(item) as ActiveQueueData;
        console.log('Checking queue:', queueData.pk, 'with host:', queueData.hostSteamId);
        
        // Check if user is in the joiners array
        const isJoiner = queueData.joiners.some(joiner => joiner.steamId === userSteamId);
        console.log('User is joiner?', isJoiner, 'Joiners:', queueData.joiners.map(j => j.steamId));
        
        if (isJoiner) {
          console.log('User found as joiner in queue:', queueData.pk);
          
          // Get player names for host and all joiners
          const allSteamIds = [queueData.hostSteamId, ...queueData.joiners.map(j => j.steamId)];
          const playerNames = await getPlayerNames(allSteamIds);
          
          // Enrich joiners with names
          const enrichedJoiners = queueData.joiners.map(joiner => ({
            ...joiner,
            name: playerNames.get(joiner.steamId) || `Player ${joiner.steamId.slice(-4)}`
          }));
          
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              inQueue: true,
              isHost: false,
              queue: {
                id: queueData.pk.replace('ACTIVEQUEUE#', ''),
                hostSteamId: queueData.hostSteamId,
                hostName: playerNames.get(queueData.hostSteamId) || `Player ${queueData.hostSteamId.slice(-4)}`,
                gameMode: queueData.gameMode,
                mapSelectionMode: queueData.mapSelectionMode,
                serverId: queueData.serverId,
                hasPassword: !!queueData.password,
                ranked: queueData.ranked,
                startTime: queueData.startTime,
                joiners: enrichedJoiners,
                createdAt: queueData.createdAt,
                updatedAt: queueData.updatedAt,
              }
            }),
          };
        }
      }
    }

    // User is not in any queue or lobby
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        inQueue: false,
        inLobby: false,
        isHost: false,
        queue: null,
        lobby: null,
      }),
    };

  } catch (error) {
    console.error('Error checking user queue status:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
