import * as crypto from 'crypto';
import * as openid from 'openid';
import { 
  upsertUser,
  createSession,
  deleteSession
} from '@squidcup/shared-lambda-utils';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://squidcup.spkymnr.xyz';

// Create wildcard CORS headers for Steam authentication
const createWildcardCorsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
});

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
      headers: createWildcardCorsHeaders(),
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  } catch (error) {
    console.error('Error in steam login handler:', error);
    return {
      statusCode: 500,
      headers: createWildcardCorsHeaders(),
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
            headers: createWildcardCorsHeaders(),
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
      headers: createWildcardCorsHeaders(),
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
            headers: createWildcardCorsHeaders(),
            body: JSON.stringify({ error: 'Steam authentication verification failed' }),
          });
          return;
        }
        
        console.log('Steam OpenID verification successful:', result);
        console.log('Result authenticated:', result.authenticated);
        console.log('Result claimedIdentifier:', result.claimedIdentifier);
        
        // Extract Steam ID from the authenticated identity
        // Steam can use either HTTP or HTTPS for the claimed identifier format
        let steamId = null;
        if (result.authenticated && result.claimedIdentifier) {
          // Try both HTTP and HTTPS patterns
          steamId = result.claimedIdentifier
            .replace('http://steamcommunity.com/openid/id/', '')
            .replace('https://steamcommunity.com/openid/id/', '');
        }
        
        if (!steamId || steamId === result.claimedIdentifier) {
          console.error('Failed to extract Steam ID from verification result');
          console.error('Claimed identifier:', result.claimedIdentifier);
          resolve({
            statusCode: 400,
            headers: createWildcardCorsHeaders(),
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
              headers: createWildcardCorsHeaders(),
              body: JSON.stringify({ error: 'Failed to create user session' }),
            });
          });
      });
    });
  } catch (error) {
    console.error('Error in handleSteamCallback:', error);
    return {
      statusCode: 500,
      headers: createWildcardCorsHeaders(),
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

async function storeUserSession(steamId: string, frontendDomain: string) {
  const sessionToken = crypto.randomUUID();
  const hours = 24 * 14;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000); // 7 days

  // Upsert user profile using shared utilities
  await upsertUser({
    steamId: steamId
  });

  // Create session using shared utilities
  await createSession(sessionToken, steamId, expiresAt);

  return { sessionToken, expiresAt };
}

async function handleLogout(event: any): Promise<any> {
  const body = JSON.parse(event.body || '{}');
  const sessionToken = body.sessionToken;

  if (!sessionToken) {
    return {
      statusCode: 400,
      headers: createWildcardCorsHeaders(),
      body: JSON.stringify({ error: 'Session token required' }),
    };
  }

  try {
    // Delete session using shared utilities
    await deleteSession(sessionToken);

    return {
      statusCode: 200,
      headers: createWildcardCorsHeaders(),
      body: JSON.stringify({ message: 'Logged out successfully' }),
    };
  } catch (error) {
    console.error('Error during logout:', error);
    return {
      statusCode: 500,
      headers: createWildcardCorsHeaders(),
      body: JSON.stringify({ error: 'Failed to logout' }),
    };
  }
}