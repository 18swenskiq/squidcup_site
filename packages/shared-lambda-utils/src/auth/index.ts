// Authentication utilities for Lambda functions
import { Session } from '@squidcup/types';

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
