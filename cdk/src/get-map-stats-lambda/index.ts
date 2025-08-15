// Lambda runtime declarations
declare const console: any;

import { 
  createCorsHeaders,
  getMapStats,
  getSsmParameter,
  getMapsByGameMode
} from '@squidcup/shared-lambda-utils';

export async function handler(event: any): Promise<any> {
  console.log('Get map stats event received');
  
  const corsHeaders = createCorsHeaders();

  try {
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Get Steam API key for map lookups
    const steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');

    // Get all maps from Steam API for each game mode
    const [wingmanMaps, threev3Maps, fivev5Maps] = await Promise.all([
      getMapsByGameMode(['wingman'], steamApiKey),
      getMapsByGameMode(['3v3'], steamApiKey),  
      getMapsByGameMode(['5v5'], steamApiKey)
    ]);

    console.log(`Steam API maps - Wingman: ${wingmanMaps.length}, 3v3: ${threev3Maps.length}, 5v5: ${fivev5Maps.length}`);

    // Get map statistics from database
    const mapStatsFromDb = await getMapStats();
    console.log('Raw map stats from database:', JSON.stringify(mapStatsFromDb, null, 2));

    // Create lookup maps for database stats
    const createStatsLookup = (stats: { mapId: string; gamesPlayed: number; totalRounds: number }[]) => {
      const lookup = new Map();
      stats.forEach(stat => {
        lookup.set(stat.mapId, {
          totalGames: stat.gamesPlayed,
          totalRounds: stat.totalRounds
        });
      });
      return lookup;
    };

    const wingmanStatsLookup = createStatsLookup(mapStatsFromDb.wingman);
    const threev3StatsLookup = createStatsLookup(mapStatsFromDb.threev3);
    const fivev5StatsLookup = createStatsLookup(mapStatsFromDb.fivev5);

    // Process maps for each game mode, including all maps (with 0s for unplayed)
    const processGameModeStats = (steamMaps: any[], statsLookup: Map<string, any>) => {
      return steamMaps.map(map => {
        const stats = statsLookup.get(map.id) || { totalGames: 0, totalRounds: 0 };
        return {
          id: map.id,
          name: map.name,
          totalGames: stats.totalGames,
          totalRounds: stats.totalRounds
        };
      }).sort((a, b) => b.totalGames - a.totalGames); // Sort by most played
    };

    const result = {
      wingman: processGameModeStats(wingmanMaps, wingmanStatsLookup),
      threev3: processGameModeStats(threev3Maps, threev3StatsLookup), 
      fivev5: processGameModeStats(fivev5Maps, fivev5StatsLookup)
    };

    console.log(`Processed complete map stats - Wingman: ${result.wingman.length}, 3v3: ${result.threev3.length}, 5v5: ${result.fivev5.length}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Error getting map stats:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to get map stats' }),
    };
  }
}
