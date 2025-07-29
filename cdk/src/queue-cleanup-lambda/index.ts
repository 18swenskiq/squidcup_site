import * as crypto from 'crypto';
import { 
  getActiveQueuesForCleanup,
  getQueuePlayers,
  storeQueueHistoryEvent,
  deleteQueue,
  updateQueue
} from '@squidcup/shared-lambda-utils';

export async function handler(event: any): Promise<any> {
  console.log('Queue cleanup handler started');
  
  try {
    // Queue timeout in minutes (10 minutes as requested)
    const timeoutMinutes = parseInt(process.env.QUEUE_TIMEOUT_MINUTES || '10');
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
    
    console.log(`Checking for queues with no activity since ${cutoffTime}`);
    
    // Get all active queues using shared utilities
    const activeQueues = await getActiveQueuesForCleanup();
    
    if (!activeQueues || activeQueues.length === 0) {
      console.log('No active queues found');
      return { message: 'No active queues found' };
    }
    
    console.log(`Found ${activeQueues.length} active queues`);
    
    let expiredCount = 0;
    const now = new Date().toISOString();
    
    for (const queue of activeQueues) {
      const gameId = queue.id; // In unified architecture, this is a gameId
      
      // Get queue players to check for recent activity using shared utilities
      const players = await getQueuePlayers(gameId);
      
      // Determine the last activity time
      // This is either the queue start time or the most recent joiner time
      let lastActivityTime = queue.start_time;
      
      if (players && players.length > 0) {
        // Find the most recent joiner time
        const mostRecentJoinTime = players
          .map((player: any) => player.joined_at)
          .sort()
          .reverse()[0]; // Get the latest join time
        
        // Use the most recent activity (start or join)
        lastActivityTime = mostRecentJoinTime > queue.start_time ? mostRecentJoinTime : queue.start_time;
      }
      
      console.log(`Queue ${gameId}: last activity at ${lastActivityTime}, cutoff is ${cutoffTime}`);
      
      // Check if queue has been inactive for too long
      if (lastActivityTime < cutoffTime) {
        console.log(`Queue ${gameId} has been inactive for ${timeoutMinutes}+ minutes (last activity: ${lastActivityTime})`);
        
        // Store timeout event for host using shared utilities
        await storeQueueHistoryEvent({
          id: crypto.randomUUID(),
          gameId: gameId,
          playerSteamId: queue.host_steam_id,
          eventType: 'timeout',
          eventData: {
            gameMode: queue.game_mode,
            mapSelectionMode: queue.map_selection_mode,
            joinerCount: players.length,
            queueDuration: Math.floor((new Date(now).getTime() - new Date(queue.start_time).getTime()) / 60000), // Duration in minutes
            reason: 'inactivity_timeout'
          }
        });

        // Store timeout events for all players (excluding host) using shared utilities
        for (const player of players) {
          if (player.player_steam_id !== queue.host_steam_id) {
            await storeQueueHistoryEvent({
              id: crypto.randomUUID(),
              gameId: gameId,
              playerSteamId: player.player_steam_id,
              eventType: 'timeout',
              eventData: {
                gameMode: queue.game_mode,
                mapSelectionMode: queue.map_selection_mode,
                hostSteamId: queue.host_steam_id,
                queueDuration: Math.floor((new Date(now).getTime() - new Date(queue.start_time).getTime()) / 60000), // Duration in minutes
                reason: 'inactivity_timeout'
              }
            });
          }
        }
        
        // Mark the expired queue as cancelled due to timeout instead of deleting it
        await updateQueue(gameId, { status: 'cancelled' });
        
        expiredCount++;
        console.log(`Marked inactive queue ${gameId} as cancelled (${players.length + 1} players affected)`);
      } else {
        console.log(`Queue ${gameId} is still active (last activity: ${lastActivityTime})`);
      }
    }
    
    console.log(`Cleanup completed. ${expiredCount} queues expired and removed`);
    
    return {
      message: `Queue cleanup completed`,
      totalQueues: activeQueues.length,
      expiredQueues: expiredCount,
      activeQueues: activeQueues.length - expiredCount,
      timeoutMinutes: timeoutMinutes,
    };
    
  } catch (error) {
    console.error('Error in queue cleanup:', error);
    throw error;
  }
}
