// Utility functions for Lambda operations

/**
 * Creates standardized CORS headers for API responses
 */
export function createCorsHeaders(origin = 'https://squidcup.spkymnr.xyz'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
  };
}

/**
 * Creates a standardized API response
 */
export function createApiResponse(
  statusCode: number, 
  data: any = null, 
  error: string | null = null,
  headers: Record<string, string> = {}
) {
  const corsHeaders = createCorsHeaders();
  
  return {
    statusCode,
    headers: { ...corsHeaders, ...headers },
    body: JSON.stringify({
      success: statusCode >= 200 && statusCode < 300,
      data,
      error
    })
  };
}

/**
 * Extracts numeric Steam ID from OpenID URL format
 */
export function extractSteamIdFromOpenId(steamId: string): string {
  // If it's already a numeric Steam ID, return as is
  if (/^\d+$/.test(steamId)) {
    return steamId;
  }
  
  // Extract from OpenID URL format: https://steamcommunity.com/openid/id/76561198041569692
  const match = steamId.match(/\/id\/(\d+)$/);
  if (match && match[1]) {
    return match[1];
  }
  
  // If no match found, return the original value
  console.warn('Could not extract Steam ID from:', steamId);
  return steamId;
}

/**
 * Gets max players for a game mode
 */
export function getMaxPlayersForGamemode(gameMode: string): number {
  switch (gameMode) {
    case '5v5':
      return 10;
    case 'wingman':
      return 4;
    case '3v3':
      return 6;
    case '1v1':
      return 2;
    default:
      return 10;
  }
}

/**
 * Validates session token format
 */
export function isValidSessionToken(token: string): boolean {
  return typeof token === 'string' && token.length > 0;
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(statusCode: number, message: string, details?: any) {
  return createApiResponse(statusCode, null, message);
}

/**
 * Creates a standardized success response
 */
export function createSuccessResponse(data: any, statusCode = 200) {
  return createApiResponse(statusCode, data);
}

/**
 * Formats duration in milliseconds to human-readable string
 */
export function formatDuration(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return '< 1m';
  }
}
