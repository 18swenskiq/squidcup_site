import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  getSession,
  getGameWithPlayers,
  updateGame,
  updatePlayerMapSelection,
  getMapSelectionStatus,
  selectRandomMapFromSelections,
  replaceRandomMapSelections,
  getMapsByGameMode,
  getSsmParameter,
  createCorsHeaders,
  SelectMapRequest
} from '@squidcup/shared-lambda-utils';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
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

    // Validate HTTP method
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Validate authorization header
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or invalid authorization token' }),
      };
    }

    // Extract session token
    const sessionToken = authHeader.substring(7);

    // Validate session using shared utilities
    const session = await getSession(sessionToken);

    if (!session) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid or expired session' }),
      };
    }

    const steamId = session.steamId;

    // Parse request body
    let requestBody: SelectMapRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      };
    }

    const { gameId, mapId } = requestBody;

    if (!gameId || !mapId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required fields: gameId, mapId' }),
      };
    }

    // Get the game to verify user is the host using shared utilities
    const game = await getGameWithPlayers(gameId);
    
    if (!game) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Game not found' }),
      };
    }

    // Check if the game is in lobby status (maps can only be selected in lobby)
    if (game.status !== 'lobby') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Maps can only be selected when the game is in lobby status' }),
      };
    }

    // Check authorization based on map selection mode
    if (game.map_selection_mode === 'host-pick') {
      // Only host can select map in host-pick mode
      if (game.host_steam_id !== steamId) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Only the game host can select the map in host-pick mode' }),
        };
      }

      // Update the game with the selected map immediately for host-pick
      await updateGame(gameId, {
        map: mapId
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: 'Map selected successfully',
          game: {
            ...game,
            map: mapId,
            updatedAt: new Date().toISOString()
          }
        }),
      };
    } else if (game.map_selection_mode === 'all-pick') {
      // Any player in the game can select map in all-pick mode
      const isPlayerInGame = game.players.some(player => player.player_steam_id === steamId);
      if (!isPlayerInGame) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Only players in the game can select the map' }),
        };
      }

      // Store the player's map selection
      await updatePlayerMapSelection(gameId, steamId, mapId);

      // Check if all players have now selected maps
      const selectionStatus = await getMapSelectionStatus(gameId);
      
      let finalMap = null;
      if (selectionStatus.hasAllSelected) {
        // All players have selected - replace any "random" selections with actual maps
        // First get available maps from Steam API
        const steamApiKey = await getSsmParameter('/unencrypted/SteamApiKey');
        const availableMaps = await getMapsByGameMode(game.game_mode, steamApiKey);
        const mapNames = availableMaps.map(map => map.name);
        
        await replaceRandomMapSelections(gameId, mapNames);
        
        // Now get a random map from the updated selections
        finalMap = await selectRandomMapFromSelections(gameId);
        
        if (finalMap) {
          // Set the animation start time - use milliseconds for JavaScript compatibility
          const animStartTime = Date.now() + 10000; // 10 seconds from now in milliseconds
          
          await updateGame(gameId, { 
            map: finalMap,
            mapAnimSelectStartTime: animStartTime
          });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: selectionStatus.hasAllSelected 
            ? `Map selection complete. Selected map: ${finalMap}` 
            : 'Map selection recorded. Waiting for other players.',
          selectionStatus: {
            playersWithSelections: selectionStatus.playersWithSelections,
            totalPlayers: selectionStatus.totalPlayers,
            hasAllSelected: selectionStatus.hasAllSelected,
            finalMap: finalMap
          },
          game: selectionStatus.hasAllSelected ? {
            ...game,
            map: finalMap,
            updatedAt: new Date().toISOString()
          } : undefined
        }),
      };
    } else if (game.map_selection_mode === 'random-map') {
      // No manual map selection allowed in random mode
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Map selection is not allowed in random-map mode' }),
      };
    }

    // Fallback for unknown map selection modes
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unknown map selection mode' }),
    };

  } catch (error) {
    console.error('Error selecting map:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};