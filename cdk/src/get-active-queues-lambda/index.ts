import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Initialize Lambda client for database service calls
const lambdaClient = new LambdaClient({ region: process.env.REGION || 'us-east-1' });

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

export interface DatabaseRequest {
  operation: string;
  data?: any;
  params?: any[];
  query?: string;
}

export interface DatabaseResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Function to call database service
async function callDatabaseService(request: DatabaseRequest): Promise<DatabaseResponse> {
  const functionName = process.env.DATABASE_SERVICE_FUNCTION_NAME;
  if (!functionName) {
    throw new Error('DATABASE_SERVICE_FUNCTION_NAME environment variable not set');
  }

  try {
    const command = new InvokeCommand({
      FunctionName: functionName,
      Payload: JSON.stringify(request)
    });

    const response = await lambdaClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    return result;
  } catch (error) {
    console.error('Error calling database service:', error);
    throw error;
  }
}

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
    // Get active queues with details from database service
    const response = await callDatabaseService({
      operation: 'getActiveQueuesWithDetails'
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to get active queues');
    }

    const queuesData = response.data || [];

    // Transform to frontend format
    const activeQueues: ActiveQueue[] = queuesData.map((queue: any) => {
      const gameMode = queue.gameMode as GameMode;
      const maxPlayers = getMaxPlayersForGamemode(gameMode);

      return {
        queueId: queue.queueId,
        host: queue.hostName || 'Unknown',
        gameMode: gameMode,
        players: queue.players,
        maxPlayers: maxPlayers,
        server: queue.serverName || 'Unknown Server',
        ranked: queue.ranked || false,
        hasPassword: queue.hasPassword || false,
        createdAt: queue.createdAt || '',
        lastActivity: queue.lastActivity || queue.createdAt || ''
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
