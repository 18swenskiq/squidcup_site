import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Initialize the Lambda client for database service calls
const lambdaClient = new LambdaClient({ region: process.env.REGION });

type GameMode = "5v5" | "wingman" | "3v3" | "1v1";

type MapResponseObj = {
  "name": string,
  "id": string,
  "thumbnailUrl": string,
  "gameModes": GameMode[]
}

const steamCollectionIds: {"gameMode": GameMode, "id": string}[] = [
  { gameMode: "5v5", id: '2753947063'},
  { gameMode: "wingman", id: '2747675401'},
  { gameMode: "3v3", id: "2752973478"},
  { gameMode: "1v1", id: "3517834095"} // Use 3529142840 when approved
]

// Function to call the database service
async function callDatabaseService(operation: string, params?: any[], data?: any): Promise<any> {
  const payload = {
    operation,
    params,
    data
  };

  const command = new InvokeCommand({
    FunctionName: process.env.DATABASE_SERVICE_FUNCTION_NAME!,
    Payload: JSON.stringify(payload),
  });

  const response = await lambdaClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  
  if (!result.success) {
    throw new Error(result.error || 'Database service call failed');
  }
  
  return result.data;
}

// Function to get parameter from SSM Parameter Store via database service
async function getParameterValue(parameterName: string): Promise<string> {
  try {
    return await callDatabaseService('getSsmParameter', undefined, { parameterName });
  } catch (error) {
    console.error(`Error getting parameter ${parameterName}:`, error);
    throw error;
  }
}

async function getMapsFromSteamAPI(steamApiKey: string, gameModes: GameMode[]): Promise<MapResponseObj[]>
{
  console.log("passed gamemodes", JSON.stringify(gameModes, null, 2));

  let collectionIds = [];

  // If no gamemode is defined, get maps from every collection
  if (gameModes.length === 0)
  {
    collectionIds = steamCollectionIds.map(x => x.id);
  }
  else
  {
    collectionIds = steamCollectionIds.filter(x => gameModes.includes(x.gameMode)).map(x => x.id);
  }

  // Create URLSearchParams directly instead of FormData
  const params = new URLSearchParams();
  params.append("key", steamApiKey);
  params.append("collectioncount", `${collectionIds.length}`);
  collectionIds.forEach((collectionId, index) => {
    params.append(`publishedfileids[${index}]`, collectionId);
  });

  console.log("collection request params", JSON.stringify(Object.fromEntries(params), null, 2));

  const rawCollectionResponse = await fetch(`https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/`, {
    method: 'POST',
    body: params,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
  });

  const collectionResponse = await rawCollectionResponse.json();

  console.log("collection response", JSON.stringify(collectionResponse, null, 2));

  let mapIdsWithGamemodes: { "id": string, "gameModes": GameMode[]}[] = []

  collectionResponse.response.collectiondetails.forEach((collection: any) => {
    // Get the game mode of the child collection
    const gameMode = steamCollectionIds.find(x => x.id === collection.publishedfileid)?.gameMode;

    if (gameMode)
    {
      // Flatten children of collection into mapIdsWithGamemodes
      const ids = collection.children.flatMap((child: any) => child.publishedfileid);
      mapIdsWithGamemodes = mapIdsWithGamemodes.concat(ids.map((id: string) => { return { "id": id, "gameModes": [gameMode] }}));
    }
  });

  // Remove duplicate map entries and collapse gamemodes into a single array
  mapIdsWithGamemodes = mapIdsWithGamemodes.reduce((acc: { "id": string, "gameModes": GameMode[] }[], current) => {
    const existing = acc.find(x => x.id === current.id);
    if (existing)
    {
      existing.gameModes.push(...current.gameModes);
    }
    else
    {
      acc.push(current);
    }
    return acc;
  }, []);

  console.log("map ids with gamemodes", JSON.stringify(mapIdsWithGamemodes, null, 2));

  // Get map details for each map from steam api
  const mapParams = new URLSearchParams();
  mapParams.append("key", steamApiKey);
  mapParams.append("itemcount", `${mapIdsWithGamemodes.length}`);
  mapIdsWithGamemodes.forEach((mapId, index) => {
    mapParams.append(`publishedfileids[${index}]`, mapId.id);
  });

  console.log("map params", JSON.stringify(Object.fromEntries(mapParams), null, 2));
  
  const rawMapsResponse = await fetch(`https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
    method: 'POST',
    body: mapParams,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
  });

  const mapsResponse = await rawMapsResponse.json();

  console.log("maps response", JSON.stringify(mapsResponse, null, 2));

  return mapsResponse.response.publishedfiledetails
    .map((map: any) => {
      return {
        "name": map.title || "Unknown Map",
        "id": map.publishedfileid,
        "thumbnailUrl": map.preview_url || "",
        "gameModes": mapIdsWithGamemodes.find(x => x.id === map.publishedfileid)?.gameModes || []
      };
    })
    .filter((map: MapResponseObj) => map.name && map.name !== "Unknown Map"); // Filter out maps without proper names
}

export async function handler(event: any): Promise<any> {
  // Extract query parameters and headers
  const queryParams = event.queryStringParameters || {};
  const headers = event.headers || {};

  console.log('query parameters 👉', JSON.stringify(queryParams, null, 2));
  console.log('headers 👉', JSON.stringify(headers, null, 2));

  // Get Steam API key from Parameter Store
  let steamApiKey = '';
  try {
    steamApiKey = await getParameterValue('/unencrypted/SteamApiKey');
    console.log('Successfully retrieved Steam API key');
  } catch (error) {
    console.error('Failed to retrieve Steam API key:', JSON.stringify(error, null, 2));
    return {
      body: JSON.stringify({
        message: 'Failed to retrieve Steam API key from Parameter Store',
        error: error,
      }),
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': true,
      },
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': true,
      },
    };
  }

  // Ensure queryparams.gameModes is an array of strings and it is passed to getMapsFromSteamAPI properly
  // If no gameModes are passed, default to ["5v5", "wingman", "3v3", "1v1"]
  const selectedGameModes: GameMode[] = queryParams.gameModes ? queryParams.gameModes.split(',') as GameMode[] : ["5v5", "wingman", "3v3", "1v1"];

  try {
    const maps: MapResponseObj[] = await getMapsFromSteamAPI(steamApiKey, selectedGameModes);
    console.log("Maps Successfully Retrieved:", JSON.stringify(maps, null, 2));
    
    let sortedMaps;
    try {
      sortedMaps = maps.sort((a, b) => a.name.localeCompare(b.name));
      console.log("Maps successfully sorted");
    } catch (sortError) {
      console.error("Error sorting maps:", sortError);
      sortedMaps = maps; // Return unsorted if sorting fails
    }
    
    const responseBody = {
      data: sortedMaps,
    };
    
    console.log("Response body size:", JSON.stringify(responseBody).length);
    console.log("About to return successful response");
    
    const response = {
      body: JSON.stringify(responseBody),
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': true,
        'Content-Type': 'application/json',
      },
    };
    
    console.log("Final response object:", JSON.stringify(response, null, 2));
    return response;
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': true,
        'Content-Type': 'application/json',
      },
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
