import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Function to get user session from DynamoDB
async function getUserSession(sessionToken: string): Promise<{ userId: string; expiresAt: string } | null> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `SESSION#${sessionToken}`,
        sk: 'METADATA',
      },
    }));

    if (!result.Item || result.Item.deleted) {
      return null;
    }

    // Check if session is expired
    const expiresAt = new Date(result.Item.expiresAt);
    if (expiresAt < new Date()) {
      return null;
    }

    return {
      userId: result.Item.userId,
      expiresAt: result.Item.expiresAt,
    };
  } catch (error) {
    console.error('Error getting user session:', error);
    return null;
  }
}

// Function to check if user is admin
function isAdmin(userId: string): boolean {
  return userId === '76561198041569692';
}

export async function handler(event: any): Promise<any> {
  console.log('Delete server event received');
  console.log('Path parameters:', event.pathParameters);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

  try {
    // Get server ID from path parameters
    const serverId = event.pathParameters?.id;
    if (!serverId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Server ID is required' }),
      };
    }

    // Get session token from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing or invalid authorization header' }),
      };
    }

    const sessionToken = authHeader.substring(7);
    const session = await getUserSession(sessionToken);
    
    if (!session || !isAdmin(session.userId)) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    // Check if server exists before deleting
    const serverCheck = await docClient.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `SERVER#${serverId}`,
        sk: 'METADATA'
      }
    }));

    if (!serverCheck.Item) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Server not found' }),
      };
    }

    // Delete the server
    await docClient.send(new DeleteCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `SERVER#${serverId}`,
        sk: 'METADATA'
      }
    }));

    console.log('Server deleted successfully:', serverId);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
      },
      body: JSON.stringify({ message: 'Server deleted successfully', serverId }),
    };
  } catch (error) {
    console.error('Error deleting server:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to delete server' }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
