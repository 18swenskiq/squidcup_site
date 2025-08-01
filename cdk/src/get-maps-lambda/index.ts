import { getSsmParameter, GameMode, MapResponseObj, getMapsByGameMode, createCorsHeaders } from '@squidcup/shared-lambda-utils';

export async function handler(event: any): Promise<any> {
  // Extract query parameters and headers
  const queryParams = event.queryStringParameters || {};
  const headers = event.headers || {};

  console.log('query parameters 👉', JSON.stringify(queryParams, null, 2));
  console.log('headers 👉', JSON.stringify(headers, null, 2));

  // Get Steam API key from Parameter Store
  let steamApiKey = '';
  try {
    steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');
    console.log('Successfully retrieved Steam API key');
  } catch (error) {
    console.error('Failed to retrieve Steam API key:', JSON.stringify(error, null, 2));
    return {
      body: JSON.stringify({
        message: 'Failed to retrieve Steam API key from Parameter Store',
        error: error,
      }),
      statusCode: 500,
      headers: createCorsHeaders(),
    };
  }

  // Validate that we actually got a Steam API key
  if (!steamApiKey || steamApiKey.trim() === '') {
    console.error('Steam API key is empty or undefined');
    return {
      body: JSON.stringify({
        message: 'Steam API key is empty or not found',
        error: 'No valid Steam API key available',
      }),
      statusCode: 500,
      headers: createCorsHeaders(),
    };
  }

  // Ensure queryparams.gameModes is an array of strings and it is passed to getMapsByGameMode properly
  // If no gameModes are passed, default to ["5v5", "wingman", "3v3", "1v1"]
  const selectedGameModes: GameMode[] = queryParams.gameModes ? queryParams.gameModes.split(',') as GameMode[] : ["5v5", "wingman", "3v3", "1v1"];

  try {
    // Use the shared Steam utilities function
    const steamMaps = await getMapsByGameMode(selectedGameModes, steamApiKey);
    
    // Convert SteamMap[] to MapResponseObj[] format expected by frontend
    const maps: MapResponseObj[] = steamMaps.map(map => ({
      name: map.name,
      id: map.id,
      thumbnailUrl: map.thumbnailUrl,
      gameModes: map.gameModes as GameMode[]
    }));
    
    console.log("Maps Successfully Retrieved:", JSON.stringify(maps, null, 2));
    
    const responseBody = {
      data: maps, // Already sorted by shared function
    };
    
    console.log("Response body size:", JSON.stringify(responseBody).length);
    console.log("About to return successful response");
    
    return {
      body: JSON.stringify(responseBody),
      statusCode: 200,
      headers: createCorsHeaders(),
    };
  } catch (error) {
    console.error("Error in try-catch block:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : 'No stack available');
    
    return {
      body: JSON.stringify({
        message: 'ERROR parsing response',
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
      }),
      statusCode: 500,
      headers: createCorsHeaders(),
    };
  }
}
