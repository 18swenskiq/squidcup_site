import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

// Initialize the SSM client
const ssmClient = new SSMClient({ region: 'us-east-2' });

type GameMode = "5v5" | "wingman" | "3v3";

type MapResponseObj = {
  "name": string,
  "id": string,
  "thumbnailUrl": string,
  "gameModes": GameMode[]
}

const steamCollectionIds: {"gameMode": GameMode, "id": string}[] = [
  { gameMode: "5v5", id: '2753947063'},
  { gameMode: "wingman", id: '2747675401'},
  { gameMode: "3v3", id: "2752973478"}
]

// Function to get parameter from SSM Parameter Store
async function getParameterValue(parameterName: string): Promise<string> {
  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true, // In case it's a SecureString
    });
    
    const response = await ssmClient.send(command);
    return response.Parameter?.Value || '';
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

  return mapsResponse.response.publishedfiledetails.map((map: any) => {
    return {
      "name": map.title,
      "id": map.publishedfileid,
      "thumbnailUrl": map.preview_url,
      "gameModes": mapIdsWithGamemodes.find(x => x.id === map.publishedfileid)?.gameModes || []
    };
  });
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
  }

  // Ensure queryparams.gameModes is an array of strings and it is passed to getMapsFromSteamAPI properly
  // If no gameModes are passed, default to ["5v5", "wingman", "3v3"]
  const selectedGameModes: GameMode[] = queryParams.gameModes ? queryParams.gameModes.split(',') as GameMode[] : ["5v5", "wingman", "3v3"];

  try {
    const maps: MapResponseObj[] = await getMapsFromSteamAPI(steamApiKey, selectedGameModes);
    return {
      body: JSON.stringify({
        data: maps.sort((a, b) => a.name.localeCompare(b.name)),
      }),
      statusCode: 200,
    };
  } catch (error) {
    return {
      body: JSON.stringify({
        message: 'ERROR parsing response',
        error: error,
      }),
      statusCode: 500,
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
