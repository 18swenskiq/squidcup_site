/**
 * Auth Routes - Steam authentication
 * 
 * Routes:
 * - GET /auth/steam - Initiate Steam login
 * - GET /auth/steam/callback - Handle Steam OAuth callback
 * - POST /auth/logout - Logout
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import * as openid from 'openid';
import {
    upsertUser,
    createSession,
    deleteSession,
    createCorsHeaders
} from '@squidcup/shared-lambda-utils';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://squidcup.spkymnr.xyz';

// Create wildcard CORS headers for Steam authentication
const createWildcardCorsHeaders = () => ({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
});

export async function handleAuth(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
            body: JSON.stringify({ error: 'Auth endpoint not found' }),
        };
    } catch (error) {
        console.error('Error in auth handler:', error);
        return {
            statusCode: 500,
            headers: createWildcardCorsHeaders(),
            body: JSON.stringify({ error: 'Internal server error' }),
        };
    }
}

async function handleSteamLogin(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        const apiDomain = `https://${event.requestContext.domainName}${event.requestContext.stage ? `/${event.requestContext.stage}` : ''}`;

        const returnUrl = `${apiDomain}/auth/steam/callback`;
        const realm = apiDomain;

        console.log('DEBUG - Constructed returnUrl:', returnUrl);
        console.log('DEBUG - Realm:', realm);

        const relyingParty = new openid.RelyingParty(
            returnUrl,
            realm,
            true,
            false,
            []
        );

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

async function handleSteamCallback(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        console.log('Steam callback received');
        console.log('Query params:', JSON.stringify(event.queryStringParameters, null, 2));

        const apiDomain = `https://${event.requestContext.domainName}${event.requestContext.stage ? `/${event.requestContext.stage}` : ''}`;
        const frontendDomain = event.headers.origin || FRONTEND_URL;

        const returnUrl = `${apiDomain}/auth/steam/callback`;
        const realm = apiDomain;

        const relyingParty = new openid.RelyingParty(
            returnUrl,
            realm,
            true,
            false,
            []
        );

        // Build query string from parameters, filtering out null/undefined
        const queryParams = event.queryStringParameters || {};
        const queryString = Object.entries(queryParams)
            .filter(([, value]) => value != null)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`)
            .join('&');
        const callbackUrl = `${returnUrl}?${queryString}`;

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

                let steamId = null;
                if (result.authenticated && result.claimedIdentifier) {
                    steamId = result.claimedIdentifier
                        .replace('http://steamcommunity.com/openid/id/', '')
                        .replace('https://steamcommunity.com/openid/id/', '');
                }

                if (!steamId || steamId === result.claimedIdentifier) {
                    console.error('Failed to extract Steam ID from verification result');
                    resolve({
                        statusCode: 400,
                        headers: createWildcardCorsHeaders(),
                        body: JSON.stringify({ error: 'Failed to extract Steam ID' }),
                    });
                    return;
                }

                console.log('Extracted Steam ID:', steamId);

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
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    await upsertUser({
        steamId: steamId
    });

    await createSession(sessionToken, steamId, expiresAt);

    return { sessionToken, expiresAt };
}

async function handleLogout(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
