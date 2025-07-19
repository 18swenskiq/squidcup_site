import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

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
        ':pk': 'ACTIVE_QUEUES'
      }
    };

    console.log('Query params:', JSON.stringify(queryParams, null, 2));

    const result = await docClient.send(new QueryCommand(queryParams));
    console.log('DynamoDB query result:', JSON.stringify(result, null, 2));

    if (!result.Items) {
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

    // Transform DynamoDB items to ActiveQueue format
    const activeQueues: ActiveQueue[] = result.Items.map((item: any) => {
      const gameMode = item.gameMode as GameMode;
      const maxPlayers = getMaxPlayersForGamemode(gameMode);
      
      // Count players: host + joiners
      const joiners = item.joiners || [];
      const players = 1 + joiners.length; // host + joiners

      return {
        queueId: item.sk.replace('QUEUE#', ''), // Remove QUEUE# prefix
        host: item.hostName || 'Unknown',
        gameMode: gameMode,
        players: players,
        maxPlayers: maxPlayers,
        server: item.serverNickname || 'Unknown Server',
        ranked: item.ranked || false,
        hasPassword: !!item.password, // Convert to boolean, don't expose actual password
        createdAt: item.createdAt || '',
        lastActivity: item.lastActivity || item.createdAt || ''
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
