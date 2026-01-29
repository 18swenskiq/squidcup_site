/**
 * Maps Routes
 * 
 * Routes:
 * - GET /maps - Get available maps for game modes
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    getSsmParameter,
    GameMode,
    MapResponseObj,
    getMapsByGameMode,
    createCorsHeaders
} from '@squidcup/shared-lambda-utils';

export async function handleMaps(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const queryParams = event.queryStringParameters || {};

    console.log('[Maps] query parameters:', JSON.stringify(queryParams, null, 2));

    // Get Steam API key from Parameter Store
    let steamApiKey = '';
    try {
        steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');
        console.log('[Maps] Successfully retrieved Steam API key');
    } catch (error) {
        console.error('[Maps] Failed to retrieve Steam API key:', error);
        return {
            body: JSON.stringify({
                message: 'Failed to retrieve Steam API key from Parameter Store',
                error: error,
            }),
            statusCode: 500,
            headers: createCorsHeaders(),
        };
    }

    if (!steamApiKey || steamApiKey.trim() === '') {
        console.error('[Maps] Steam API key is empty or undefined');
        return {
            body: JSON.stringify({
                message: 'Steam API key is empty or not found',
                error: 'No valid Steam API key available',
            }),
            statusCode: 500,
            headers: createCorsHeaders(),
        };
    }

    const selectedGameModes: GameMode[] = queryParams.gameModes
        ? queryParams.gameModes.split(',') as GameMode[]
        : ["5v5", "wingman", "3v3", "1v1"];

    try {
        const steamMaps = await getMapsByGameMode(selectedGameModes, steamApiKey);

        const maps: MapResponseObj[] = steamMaps.map(map => ({
            name: map.name,
            id: map.id,
            thumbnailUrl: map.thumbnailUrl,
            gameModes: map.gameModes as GameMode[]
        }));

        console.log("[Maps] Maps Successfully Retrieved:", maps.length);

        return {
            body: JSON.stringify({ data: maps }),
            statusCode: 200,
            headers: createCorsHeaders(),
        };
    } catch (error) {
        console.error("[Maps] Error:", error);

        return {
            body: JSON.stringify({
                message: 'ERROR parsing response',
                error: error instanceof Error ? {
                    name: error.name,
                    message: error.message,
                } : error,
            }),
            statusCode: 500,
            headers: createCorsHeaders(),
        };
    }
}
