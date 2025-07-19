import { DynamoDBClient, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import * as crypto from 'crypto';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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
  }>;
  createdAt: string;
  updatedAt: string;
}

// Function to store queue history event
async function storeQueueHistoryEvent(
  queueId: string,
  userSteamId: string,
  eventType: 'start' | 'join' | 'leave' | 'disband' | 'timeout' | 'complete',
  eventData?: any
): Promise<void> {
  try {
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();

    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `QUEUEHISTORY#${userSteamId}`,
        sk: `${now}#${eventId}`,
        GSI1PK: `QUEUEEVENT#${queueId}`,
        GSI1SK: `${now}#${eventType}`,
        queueId,
        userSteamId,
        eventType,
        eventData: eventData || {},
        timestamp: now,
        createdAt: now,
      }
    }));

    console.log(`Stored queue history event: ${eventType} for user ${userSteamId} in queue ${queueId}`);
  } catch (error) {
    console.error('Error storing queue history event:', error);
    // Don't fail the main operation if history storage fails
  }
}

export async function handler(event: any): Promise<any> {
  console.log('Queue cleanup handler started');
  
  try {
    // Queue timeout in minutes (10 minutes as requested)
    const timeoutMinutes = parseInt(process.env.QUEUE_TIMEOUT_MINUTES || '10');
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
    
    console.log(`Checking for queues with no activity since ${cutoffTime}`);
    
    // Get all active queues
    const scanCommand = new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix)',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'ACTIVEQUEUE#' },
      },
    });

    const result = await dynamoClient.send(scanCommand);
    
    if (!result.Items || result.Items.length === 0) {
      console.log('No active queues found');
      return { message: 'No active queues found' };
    }
    
    console.log(`Found ${result.Items.length} active queues`);
    
    let expiredCount = 0;
    const now = new Date().toISOString();
    
    for (const item of result.Items) {
      const queueData = unmarshall(item) as ActiveQueueData;
      const queueId = queueData.pk.replace('ACTIVEQUEUE#', '');
      
      // Determine the last activity time
      // This is either the queue start time or the most recent joiner time
      let lastActivityTime = queueData.startTime;
      
      if (queueData.joiners && queueData.joiners.length > 0) {
        // Find the most recent joiner time
        const mostRecentJoinTime = queueData.joiners
          .map(joiner => joiner.joinTime)
          .sort()
          .reverse()[0]; // Get the latest join time
        
        // Use the most recent activity (start or join)
        lastActivityTime = mostRecentJoinTime > queueData.startTime ? mostRecentJoinTime : queueData.startTime;
      }
      
      console.log(`Queue ${queueId}: last activity at ${lastActivityTime}, cutoff is ${cutoffTime}`);
      
      // Check if queue has been inactive for too long
      if (lastActivityTime < cutoffTime) {
        console.log(`Queue ${queueId} has been inactive for ${timeoutMinutes}+ minutes (last activity: ${lastActivityTime})`);
        
        // Store timeout events for host and all joiners (same as disband logic)
        await storeQueueHistoryEvent(queueId, queueData.hostSteamId, 'timeout', {
          gameMode: queueData.gameMode,
          mapSelectionMode: queueData.mapSelectionMode,
          joinerCount: queueData.joiners.length,
          queueDuration: Math.floor((new Date(now).getTime() - new Date(queueData.startTime).getTime()) / 60000), // Duration in minutes
          reason: 'inactivity_timeout'
        });

        // Store timeout events for all joiners
        for (const joiner of queueData.joiners) {
          await storeQueueHistoryEvent(queueId, joiner.steamId, 'timeout', {
            gameMode: queueData.gameMode,
            mapSelectionMode: queueData.mapSelectionMode,
            hostSteamId: queueData.hostSteamId,
            queueDuration: Math.floor((new Date(now).getTime() - new Date(queueData.startTime).getTime()) / 60000), // Duration in minutes
            reason: 'inactivity_timeout'
          });
        }
        
        // Delete the expired queue
        await dynamoClient.send(new DeleteItemCommand({
          TableName: process.env.TABLE_NAME,
          Key: {
            pk: { S: queueData.pk },
            sk: { S: queueData.sk },
          },
        }));
        
        expiredCount++;
        console.log(`Deleted inactive queue ${queueId} (${queueData.joiners.length + 1} players affected)`);
      } else {
        console.log(`Queue ${queueId} is still active (last activity: ${lastActivityTime})`);
      }
    }
    
    console.log(`Cleanup completed. ${expiredCount} queues expired and removed`);
    
    return {
      message: `Queue cleanup completed`,
      totalQueues: result.Items.length,
      expiredQueues: expiredCount,
      activeQueues: result.Items.length - expiredCount,
      timeoutMinutes: timeoutMinutes,
    };
    
  } catch (error) {
    console.error('Error in queue cleanup:', error);
    throw error;
  }
}

// Export using CommonJS for maximum compatibility
exports.handler = handler;
