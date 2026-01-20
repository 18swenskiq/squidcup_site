// Authentication utilities for Lambda functions
import { Session, ServerAuthResult } from '../types';
import { getDatabaseConnection } from '../database';

/**
 * Extracts Bearer token from Authorization header
 */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Validates session token format and structure
 */
export function validateSessionToken(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  // Add any additional validation logic here
  // For example, checking token format, length, etc.
  return token.length > 0;
}

/**
 * Checks if a session is expired
 */
export function isSessionExpired(session: Session): boolean {
  const expiresAt = new Date(session.expiresAt);
  const now = new Date();
  return expiresAt <= now;
}

/**
 * Creates a session validation error response
 */
export function createAuthErrorResponse() {
  return {
    statusCode: 401,
    headers: {
      'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify({
      success: false,
      error: 'Invalid or expired session'
    }),
  };
}

/**
 * Checks if a request comes from an authorized game server
 * by verifying the source IP against registered servers in the database.
 * 
 * @param requestIp - The IP address from the request (event.requestContext.identity.sourceIp)
 * @returns ServerAuthResult with authorized status and optional serverId
 */
export async function isAuthorizedServer(requestIp: string): Promise<ServerAuthResult> {
  try {
    const connection = await getDatabaseConnection();
    const query = 'SELECT id FROM squidcup_servers WHERE ip = ?';
    const [rows] = await connection.execute(query, [requestIp]);

    if (Array.isArray(rows) && rows.length > 0) {
      const server = rows[0] as { id: string };
      return { authorized: true, serverId: server.id };
    }

    return { authorized: false };
  } catch (error) {
    console.error('Error checking server authorization:', error);
    return { authorized: false };
  }
}

/**
 * Creates an unauthorized response for server-to-server API calls
 */
export function createServerAuthErrorResponse() {
  return {
    statusCode: 403,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      success: false,
      error: 'Unauthorized: Request must come from a registered game server'
    }),
  };
}

/**
 * Extracts the source IP from an API Gateway event
 */
export function extractSourceIp(event: any): string | null {
  return event?.requestContext?.identity?.sourceIp || null;
}
