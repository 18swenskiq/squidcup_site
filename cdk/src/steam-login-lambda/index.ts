import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import * as crypto from 'crypto';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

export async function handler(event: any): Promise<any> {
  console.log('Steam login event:', JSON.stringify(event, null, 2));

  const path = event.path;
  const method = event.httpMethod;

  try {
    // Handle Steam login initiation
    if (path.includes('/auth/steam') && method === 'GET' && !path.includes('callback')) {
      return handleSteamLogin(event);
    }
    
    // Handle Steam OAuth callback
    if (path.includes('/auth/steam/callback') && method === 'GET') {
      return handleSteamCallback(event);
    }
    
    // Handle logout
    if (path.includes('/auth/logout') && method === 'POST') {
      return handleLogout(event);
    }

    return {
      statusCode: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  } catch (error) {
    console.error('Error in steam login handler:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

async function handleSteamLogin(event: any): Promise<any> {
  // Generate Steam OpenID URL
  const returnUrl = `${event.headers.origin || FRONTEND_URL}/api/auth/steam/callback`;
  const realm = event.headers.origin || FRONTEND_URL;
  
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });

  const steamLoginUrl = `https://steamcommunity.com/openid/login?${params.toString()}`;

  return {
    statusCode: 302,
    headers: {
      'Location': steamLoginUrl,
      'Access-Control-Allow-Origin': '*',
    },
    body: '',
  };
}

async function handleSteamCallback(event: any): Promise<any> {
  const queryParams = event.queryStringParameters || {};
  
  // Verify the Steam OpenID response
  if (!queryParams['openid.claimed_id']) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid Steam response' }),
    };
  }

  // Extract Steam ID from the claimed_id
  const steamId = queryParams['openid.claimed_id'].replace('https://steamcommunity.com/openid/id/', '');
  
  try {
    // Store user session in DynamoDB
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store user profile
    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `USER#${steamId}`,
        sk: 'PROFILE',
        steamId: steamId,
        lastLogin: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    }));

    // Store session
    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `SESSION#${sessionToken}`,
        sk: 'METADATA',
        userId: steamId,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
      },
    }));

    // Redirect back to frontend with session token
    const redirectUrl = `${FRONTEND_URL}?token=${sessionToken}&steamId=${steamId}`;

    return {
      statusCode: 302,
      headers: {
        'Location': redirectUrl,
        'Access-Control-Allow-Origin': '*',
      },
      body: '',
    };
  } catch (error) {
    console.error('Error storing user session:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to create user session' }),
    };
  }
}

async function handleLogout(event: any): Promise<any> {
  const body = JSON.parse(event.body || '{}');
  const sessionToken = body.sessionToken;

  if (!sessionToken) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Session token required' }),
    };
  }

  try {
    // Delete session from DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `SESSION#${sessionToken}`,
        sk: 'METADATA',
        deleted: true,
        deletedAt: new Date().toISOString(),
      },
    }));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({ message: 'Logged out successfully' }),
    };
  } catch (error) {
    console.error('Error during logout:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to logout' }),
    };
  }
}
