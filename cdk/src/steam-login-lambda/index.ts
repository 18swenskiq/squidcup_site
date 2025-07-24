import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import * as crypto from 'crypto';
import * as openid from 'openid';

const lambdaClient = new LambdaClient({ region: process.env.REGION });
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://squidcup.spkymnr.xyz';

async function callDatabaseService(operation: string, params?: any[], data?: any): Promise<any> {
  const payload = {
    operation,
    params,
    data
  };

  const command = new InvokeCommand({
    FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME,
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  });

  const response = await lambdaClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  
  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }
  
  return result;
}

export async function handler(event: any): Promise<any> {
  console.log('Steam login event received');
  console.log('Path:', event.path);
  console.log('Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));
  console.log('Query params:', JSON.stringify(event.queryStringParameters, null, 2));

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
  try {
    // Get the actual domain from the request
    const apiDomain = `https://${event.requestContext.domainName}${event.requestContext.stage ? `/${event.requestContext.stage}` : ''}`;
    const frontendDomain = event.headers.origin || FRONTEND_URL;
    
    const returnUrl = `${apiDomain}/auth/steam/callback`;
    // Test: Use the same domain as return URL for realm to see if Steam validates domain consistency
    const realm = apiDomain;
    
    console.log('DEBUG - Constructed returnUrl:', returnUrl);
    console.log('DEBUG - Realm:', realm);
    
    // Create a relyingParty using the openid library
    const relyingParty = new openid.RelyingParty(
      returnUrl, // return URL
      realm, // realm (your frontend domain)
      true, // use stateless verification
      false, // don't use strict mode
      [] // no additional extensions
    );
    
    // Steam's OpenID provider URL
    const steamOpenIdUrl = 'https://steamcommunity.com/openid';
    
    return new Promise((resolve) => {
      relyingParty.authenticate(steamOpenIdUrl, false, (error: any, authUrl: string | null) => {
        if (error || !authUrl) {
          console.error('Error creating Steam auth URL:', error);
          resolve({
            statusCode: 500,
            headers: {},
            body: JSON.stringify({ error: 'Failed to create Steam authentication URL' }),
          });
          return;
        }
        
        console.log('Generated Steam auth URL:', authUrl);
        
        resolve({
          statusCode: 302,
          headers: {
            'Location': authUrl,
          },
          body: '',
        });
      });
    });
  } catch (error) {
    console.error('Error in handleSteamLogin:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

async function handleSteamCallback(event: any): Promise<any> {
  try {
    console.log('Steam callback received');
    console.log('Query params:', JSON.stringify(event.queryStringParameters, null, 2));
    
    // Get the actual domain from the request
    const apiDomain = `https://${event.requestContext.domainName}${event.requestContext.stage ? `/${event.requestContext.stage}` : ''}`;
    const frontendDomain = event.headers.origin || FRONTEND_URL;
    
    const returnUrl = `${apiDomain}/auth/steam/callback`;
    // Test: Use the same domain as return URL for realm to see if Steam validates domain consistency
    const realm = apiDomain;
    
    // Create a relyingParty for verification
    const relyingParty = new openid.RelyingParty(
      returnUrl,
      realm,
      true, // use stateless verification
      false, // don't use strict mode
      []
    );
    
    // Reconstruct the full URL for verification
    const callbackUrl = `${returnUrl}?${new URLSearchParams(event.queryStringParameters || {}).toString()}`;
    
    console.log('Verifying callback URL:', callbackUrl);
    
    return new Promise((resolve) => {
      relyingParty.verifyAssertion(callbackUrl, (error: any, result: any) => {
        if (error || !result) {
          console.error('Steam OpenID verification failed:', error);
          resolve({
            statusCode: 400,
            headers: {},
            body: JSON.stringify({ error: 'Steam authentication verification failed' }),
          });
          return;
        }
        
        console.log('Steam OpenID verification successful:', result);
        console.log('Result authenticated:', result.authenticated);
        console.log('Result claimedIdentifier:', result.claimedIdentifier);
        
        // Extract Steam ID from the authenticated identity
        // Steam uses HTTP (not HTTPS) for the claimed identifier format
        const steamId = result.authenticated ? result.claimedIdentifier?.replace('http://steamcommunity.com/openid/id/', '') : null;
        
        if (!steamId) {
          console.error('Failed to extract Steam ID from verification result');
          console.error('Claimed identifier:', result.claimedIdentifier);
          resolve({
            statusCode: 400,
            headers: {},
            body: JSON.stringify({ error: 'Failed to extract Steam ID' }),
          });
          return;
        }
        
        console.log('Extracted Steam ID:', steamId);
        
        // Store user session via database service
        storeUserSession(steamId, frontendDomain)
          .then((sessionData: { sessionToken: string; expiresAt: Date }) => {
            const redirectUrl = `${frontendDomain}?token=${sessionData.sessionToken}&steamId=${steamId}`;
            console.log('Redirecting to frontend:', redirectUrl);
            
            resolve({
              statusCode: 302,
              headers: {
                'Location': redirectUrl,
              },
              body: '',
            });
          })
          .catch((storeError: any) => {
            console.error('Error storing user session:', storeError);
            resolve({
              statusCode: 500,
              headers: {},
              body: JSON.stringify({ error: 'Failed to create user session' }),
            });
          });
      });
    });
  } catch (error) {
    console.error('Error in handleSteamCallback:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

async function storeUserSession(steamId: string, frontendDomain: string) {
  const sessionToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Upsert user profile via database service
  await callDatabaseService('upsertUser', undefined, {
    steamId: steamId,
    lastLogin: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Create session via database service
  await callDatabaseService('createSession', [sessionToken, steamId, expiresAt.toISOString()]);

  return { sessionToken, expiresAt };
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
    // Delete session via database service
    await callDatabaseService('deleteSession', [sessionToken]);

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