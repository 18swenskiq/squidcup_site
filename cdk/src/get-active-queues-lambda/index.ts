import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

type GameMode = "5v5" | "wingman" | "3v3" | "1v1";

type ActiveQueue = {
  queueId: string;
  host: string;
  gameMode: GameMode;
  players: number;
  maxPlayers: number;
  server: string;
  ranked: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastActivity: string;
};

type QueueData = {
  pk: string;
  sk: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  hostSteamId: string;
  gameMode: GameMode;
  serverId: string;
  password?: string;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    joinTime: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

type UserData = {
  steamId: string;
  personaname?: string;
};

type ServerData = {
  id: string;
  nickname: string;
  ip: string;
  port: number;
};

// Function to get the maximum players for a gamemode
function getMaxPlayersForGamemode(gameMode: GameMode): number {
  switch (gameMode) {
    case '5v5':
      return 10;
    case 'wingman':
      return 4;
    case '3v3':
      return 6;
    case '1v1':
      return 2;
    default:
      return 10;
  }
}

export const handler = async (event: any) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Query for all active queues using GSI1
    const queryParams = {
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'ACTIVEQUEUE'
      }
    };

    console.log('Query params:', JSON.stringify(queryParams, null, 2));

    const result = await docClient.send(new QueryCommand(queryParams));
    console.log('DynamoDB query result:', JSON.stringify(result, null, 2));

    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({ queues: [] })
      };
    }

    // Extract unique user IDs and server IDs for batch fetching
    const userIds = new Set<string>();
    const serverIds = new Set<string>();
    
    const queueItems = result.Items as QueueData[];
    queueItems.forEach(queue => {
      userIds.add(queue.hostSteamId);
      queue.joiners?.forEach(joiner => userIds.add(joiner.steamId));
      if (queue.serverId) {
        serverIds.add(queue.serverId);
      }
    });

    // Fetch user data for display names
    const usersMap = new Map<string, string>();
    if (userIds.size > 0) {
      const userScanParams = {
        TableName: process.env.TABLE_NAME,
        FilterExpression: 'begins_with(pk, :userPrefix)',
        ExpressionAttributeValues: {
          ':userPrefix': { S: 'USER#' }
        }
      };

      const usersResult = await client.send(new ScanCommand(userScanParams));
      
      if (usersResult.Items) {
        for (const item of usersResult.Items) {
          try {
            const user = unmarshall(item) as UserData;
            usersMap.set(user.steamId, user.personaname || 'Unknown');
          } catch (error) {
            console.error('Error unmarshalling user item:', error, item);
          }
        }
      }
    }

    // Fetch server data for nicknames
    const serversMap = new Map<string, string>();
    if (serverIds.size > 0) {
      const serverScanParams = {
        TableName: process.env.TABLE_NAME,
        FilterExpression: 'begins_with(pk, :serverPrefix)',
        ExpressionAttributeValues: {
          ':serverPrefix': { S: 'SERVER#' }
        }
      };

      const serversResult = await client.send(new ScanCommand(serverScanParams));
      
      if (serversResult.Items) {
        for (const item of serversResult.Items) {
          try {
            const server = unmarshall(item) as ServerData;
            serversMap.set(server.id, server.nickname || 'Unknown Server');
          } catch (error) {
            console.error('Error unmarshalling server item:', error, item);
          }
        }
      }
    }

    // Transform DynamoDB items to ActiveQueue format
    const activeQueues: ActiveQueue[] = queueItems.map((item: QueueData) => {
      const gameMode = item.gameMode as GameMode;
      const maxPlayers = getMaxPlayersForGamemode(gameMode);
      
      // Count players: host + joiners
      const joiners = item.joiners || [];
      const players = 1 + joiners.length; // host + joiners

      return {
        queueId: item.id || item.pk.replace('ACTIVEQUEUE#', ''), // Use id field or extract from pk
        host: usersMap.get(item.hostSteamId) || 'Unknown',
        gameMode: gameMode,
        players: players,
        maxPlayers: maxPlayers,
        server: serversMap.get(item.serverId) || 'Unknown Server',
        ranked: item.ranked || false,
        hasPassword: !!item.password, // Convert to boolean, don't expose actual password
        createdAt: item.createdAt || '',
        lastActivity: item.updatedAt || item.createdAt || ''
      };
    });

    // Sort by creation time (newest first)
    activeQueues.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({ queues: activeQueues })
    };

  } catch (error) {
    console.error('Error getting active queues:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to retrieve active queues'
      })
    };
  }
};
