// Steam API functionality
export interface SteamMap {
  id: string;
  name: string;
  thumbnailUrl: string;
  gameModes: string[];
}

const steamCollectionIds: {gameMode: string, id: string}[] = [
  { gameMode: "5v5", id: '2753947063'},
  { gameMode: "wingman", id: '2747675401'},
  { gameMode: "3v3", id: "2752973478"},
  { gameMode: "1v1", id: "3517834095"} // Use 3529142840 when approved
];

/**
 * Fetches maps from Steam Workshop API for specific game modes using collections
 * @param gameModes - Array of game modes to fetch maps for, or single game mode string
 * @param steamApiKey - Steam API key for authentication
 * @returns Promise resolving to array of maps with their details
 */
export async function getMapsByGameMode(gameModes: string | string[], steamApiKey: string): Promise<SteamMap[]> {
  try {
    // Normalize gameModes to array
    const gameModesArray = Array.isArray(gameModes) ? gameModes : [gameModes];
    console.log("Fetching maps for game modes:", JSON.stringify(gameModesArray, null, 2));

    let collectionIds = [];

    // If no gamemode is defined, get maps from every collection
    if (gameModesArray.length === 0) {
      collectionIds = steamCollectionIds.map(x => x.id);
    } else {
      collectionIds = steamCollectionIds.filter(x => gameModesArray.includes(x.gameMode)).map(x => x.id);
    }

    // Create URLSearchParams for collection request
    const params = new URLSearchParams();
    params.append("key", steamApiKey);
    params.append("collectioncount", `${collectionIds.length}`);
    collectionIds.forEach((collectionId, index) => {
      params.append(`publishedfileids[${index}]`, collectionId);
    });

    console.log("Collection request params", JSON.stringify(Object.fromEntries(params), null, 2));

    const rawCollectionResponse = await fetch(`https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/`, {
      method: 'POST',
      body: params,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
    });

    if (!rawCollectionResponse.ok) {
      throw new Error(`Steam collection API request failed: ${rawCollectionResponse.status} ${rawCollectionResponse.statusText}`);
    }

    const collectionResponse = await rawCollectionResponse.json();
    console.log("Collection response", JSON.stringify(collectionResponse, null, 2));

    let mapIdsWithGamemodes: { id: string, gameModes: string[] }[] = [];

    collectionResponse.response.collectiondetails.forEach((collection: any) => {
      // Get the game mode of the child collection
      const gameMode = steamCollectionIds.find(x => x.id === collection.publishedfileid)?.gameMode;

      if (gameMode) {
        // Flatten children of collection into mapIdsWithGamemodes
        const ids = collection.children.flatMap((child: any) => child.publishedfileid);
        mapIdsWithGamemodes = mapIdsWithGamemodes.concat(ids.map((id: string) => ({ id: id, gameModes: [gameMode] })));
      }
    });

    // Remove duplicate map entries and collapse gamemodes into a single array
    mapIdsWithGamemodes = mapIdsWithGamemodes.reduce((acc: { id: string, gameModes: string[] }[], current) => {
      const existing = acc.find(x => x.id === current.id);
      if (existing) {
        existing.gameModes.push(...current.gameModes);
      } else {
        acc.push(current);
      }
      return acc;
    }, []);

    console.log("Map IDs with game modes", JSON.stringify(mapIdsWithGamemodes, null, 2));

    // Get map details for each map from steam api
    const mapParams = new URLSearchParams();
    mapParams.append("key", steamApiKey);
    mapParams.append("itemcount", `${mapIdsWithGamemodes.length}`);
    mapIdsWithGamemodes.forEach((mapId, index) => {
      mapParams.append(`publishedfileids[${index}]`, mapId.id);
    });

    console.log("Map params", JSON.stringify(Object.fromEntries(mapParams), null, 2));
    
    const rawMapsResponse = await fetch(`https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
      method: 'POST',
      body: mapParams,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
    });

    if (!rawMapsResponse.ok) {
      throw new Error(`Steam maps API request failed: ${rawMapsResponse.status} ${rawMapsResponse.statusText}`);
    }

    const mapsResponse = await rawMapsResponse.json();
    console.log("Maps response", JSON.stringify(mapsResponse, null, 2));

    const maps = mapsResponse.response.publishedfiledetails
      .map((map: any) => ({
        id: map.publishedfileid,
        name: map.title || "Unknown Map",
        thumbnailUrl: map.preview_url || "",
        gameModes: mapIdsWithGamemodes.find(x => x.id === map.publishedfileid)?.gameModes || []
      }))
      .filter((map: SteamMap) => map.name && map.name !== "Unknown Map"); // Filter out maps without proper names

    return maps.sort((a: SteamMap, b: SteamMap) => a.name.localeCompare(b.name)); // Sort alphabetically
  } catch (error) {
    console.error('Error fetching maps from Steam API:', error);
    throw error;
  }
}

/**
 * Selects a random map from the provided array of map names
 * @param availableMaps - Array of map names to choose from
 * @returns Random map name or null if no maps available
 */
export function selectRandomMapFromAvailable(availableMaps: string[]): string | null {
  if (!availableMaps || availableMaps.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * availableMaps.length);
  return availableMaps[randomIndex];
}
