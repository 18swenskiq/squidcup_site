import { getActiveQueuesWithDetails, getMaxPlayersForGamemode } from '@squidcup/shared-lambda-utils';
import { GameMode, ActiveQueueWithDetails } from '@squidcup/types-squidcup';

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

export const handler = async (event: any) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Get active queues with details from shared utilities
    const queuesData: ActiveQueueWithDetails[] = await getActiveQueuesWithDetails();

    // Transform to frontend format
    const activeQueues: ActiveQueue[] = queuesData.map((queue: ActiveQueueWithDetails) => {
      return {
        queueId: queue.queueId,
        host: queue.hostName || 'Unknown',
        gameMode: queue.gameMode,
        players: queue.players,
        maxPlayers: queue.maxPlayers,
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
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
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
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
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
