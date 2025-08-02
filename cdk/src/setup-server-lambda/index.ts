import { sendRconCommand, getServerInfoForGame } from '@squidcup/shared-lambda-utils';

export async function handler(event: any): Promise<any> {
  console.log('Hello world - setup server lambda called');
  console.log('Event received:', JSON.stringify(event, null, 2));

  // Extract gameId from the event payload
  const gameId = event.gameId;
  console.log('Game ID:', gameId);

  if (!gameId) {
    console.error('No gameId provided in event');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'gameId is required' }),
    };
  }

  // Get server information for this game from the database
  try {
    console.log(`Looking up server info for game ${gameId}...`);
    const serverInfo = await getServerInfoForGame(gameId);
    
    if (!serverInfo) {
      console.error(`No server found for game ${gameId}`);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Server not found for this game' }),
      };
    }

    console.log('Server info found:', {
      id: serverInfo.id,
      ip: serverInfo.ip,
      port: serverInfo.port,
      nickname: serverInfo.nickname
    });

    // Test RCON connection with actual server details
    console.log(`Testing RCON connection to ${serverInfo.ip}:${serverInfo.port} for game ${gameId}...`);
    const rconResult = await sendRconCommand(
      serverInfo.ip, 
      serverInfo.port, 
      serverInfo.rcon_password, 
      'status'
    );
    
    if (rconResult.success) {
      console.log('RCON Status Response:', rconResult.response);
    } else {
      console.log('RCON Error:', rconResult.error);
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({ 
        message: `Server setup initiated for game ${gameId}`,
        serverInfo: {
          id: serverInfo.id,
          ip: serverInfo.ip,
          port: serverInfo.port,
          nickname: serverInfo.nickname
        },
        rconTest: {
          success: rconResult.success,
          response: rconResult.success ? rconResult.response : rconResult.error
        },
        timestamp: new Date().toISOString()
      }),
    };

  } catch (error) {
    console.error('Error in server setup:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      },
      body: JSON.stringify({ 
        error: 'Failed to setup server',
        gameId: gameId,
        timestamp: new Date().toISOString()
      }),
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
