import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import * as crypto from 'crypto';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type GameMode = "5v5" | "wingman" | "3v3" | "1v1";
type MapSelectionMode = "All Pick" | "Host Pick" | "Random Map";

interface QueueData {
  pk: string;
  sk: string;
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  hostSteamId: string;
  gameMode: GameMode;
  mapSelectionMode: MapSelectionMode;
  serverId: string;
  password?: string;
  ranked: boolean;
  startTime: string;
  joiners: Array<{
    steamId: string;
    joinTime: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface LobbyPlayer {
  steamId: string;
  team?: number; // 1 or 2 for team assignment
  mapSelection?: string; // Selected map ID (for applicable modes)
  hasSelectedMap?: boolean;
}

interface LobbyData {
  pk: string; // LOBBY#${lobbyId}
  sk: string; // METADATA
  GSI1PK: string; // ACTIVELOBBY
  GSI1SK: string; // ${lobbyId}
  id: string;
  hostSteamId: string;
  gameMode: GameMode;
  mapSelectionMode: MapSelectionMode;
  serverId: string;
  password?: string;
  ranked: boolean;
  players: LobbyPlayer[];
  mapSelectionComplete: boolean;
  selectedMap?: string; // Final selected map
  createdAt: string;
  updatedAt: string;
}

// Function to get the maximum players for a gamemode
function getMaxPlayersForGamemode(gameMode: GameMode): number {
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

// Function to balance players into teams
function balancePlayersIntoTeams(players: LobbyPlayer[], gameMode: GameMode): LobbyPlayer[] {
  const maxPlayers = getMaxPlayersForGamemode(gameMode);
  const playersPerTeam = maxPlayers / 2;
  
  // Shuffle players randomly for now (later we can implement skill-based balancing)
  const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
  
  return shuffledPlayers.map((player, index) => ({
    ...player,
    team: Math.floor(index / playersPerTeam) + 1
  }));
}

// Function to store lobby history event
async function storeLobbyHistoryEvent(
  lobbyId: string,
  userSteamId: string,
  eventType: 'created' | 'joined' | 'left' | 'disbanded' | 'map_selected' | 'game_started',
  eventData?: any
): Promise<void> {
  try {
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();

    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        pk: `LOBBYHISTORY#${userSteamId}`,
        sk: `${now}#${eventId}`,
        GSI1PK: `LOBBYEVENT#${lobbyId}`,
        GSI1SK: `${now}#${eventType}`,
        lobbyId,
        userSteamId,
        eventType,
        eventData: eventData || {},
        timestamp: now,
        createdAt: now,
      }
    }));

    console.log(`Stored lobby history event: ${eventType} for user ${userSteamId} in lobby ${lobbyId}`);
  } catch (error) {
    console.error('Error storing lobby history event:', error);
    // Don't fail the main operation if history storage fails
  }
}

export const handler = async (event: any) => {
  console.log('Create lobby event:', JSON.stringify(event, null, 2));

  try {
    const { queueId } = JSON.parse(event.body || '{}');
    
    if (!queueId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Queue ID is required' })
      };
    }

    // Get the queue from DynamoDB
    const queueResult = await docClient.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `ACTIVEQUEUE#${queueId}`,
        sk: 'METADATA',
      },
    }));

    if (!queueResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Queue not found' })
      };
    }

    const queueData = queueResult.Item as QueueData;
    
    // Check if queue is full
    const maxPlayers = getMaxPlayersForGamemode(queueData.gameMode);
    const currentPlayers = 1 + queueData.joiners.length; // host + joiners
    
    if (currentPlayers < maxPlayers) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
        body: JSON.stringify({ error: 'Queue is not full yet' })
      };
    }

    // Create lobby ID
    const lobbyId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create players array from queue data
    const allPlayers: LobbyPlayer[] = [
      { steamId: queueData.hostSteamId, hasSelectedMap: false },
      ...queueData.joiners.map(joiner => ({
        steamId: joiner.steamId,
        hasSelectedMap: false
      }))
    ];

    // Balance players into teams if gamemode has more than 2 players
    const playersWithTeams = maxPlayers > 2 
      ? balancePlayersIntoTeams(allPlayers, queueData.gameMode)
      : allPlayers;

    // Determine if map selection is needed
    const needsMapSelection = queueData.mapSelectionMode === 'All Pick' || queueData.mapSelectionMode === 'Host Pick';
    let selectedMap: string | undefined;
    let mapSelectionComplete = false;

    // Handle Random Map selection immediately
    if (queueData.mapSelectionMode === 'Random Map') {
      // TODO: Get random map from maps table based on gameMode
      // For now, we'll leave it undefined and handle it later
      mapSelectionComplete = true;
    }

    // Create lobby data
    const lobbyData: LobbyData = {
      pk: `LOBBY#${lobbyId}`,
      sk: 'METADATA',
      GSI1PK: 'ACTIVELOBBY',
      GSI1SK: lobbyId,
      id: lobbyId,
      hostSteamId: queueData.hostSteamId,
      gameMode: queueData.gameMode,
      mapSelectionMode: queueData.mapSelectionMode,
      serverId: queueData.serverId,
      password: queueData.password,
      ranked: queueData.ranked,
      players: playersWithTeams,
      mapSelectionComplete,
      selectedMap,
      createdAt: now,
      updatedAt: now,
    };

    // Store the lobby in DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: lobbyData
    }));

    // Delete the original queue
    await dynamoClient.send(new DeleteItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: { S: queueData.pk },
        sk: { S: queueData.sk },
      },
    }));

    // Store lobby creation events for all players
    for (const player of playersWithTeams) {
      await storeLobbyHistoryEvent(lobbyId, player.steamId, 'created', {
        gameMode: queueData.gameMode,
        mapSelectionMode: queueData.mapSelectionMode,
        isHost: player.steamId === queueData.hostSteamId,
        team: player.team
      });
    }

    console.log('Lobby created successfully:', lobbyId);

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({
        message: 'Lobby created successfully',
        lobby: lobbyData
      })
    };

  } catch (error) {
    console.error('Error creating lobby:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to create lobby'
      })
    };
  }
};
