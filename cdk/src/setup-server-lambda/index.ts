import { sendRconCommand } from '@squidcup/shared-lambda-utils';

export async function handler(event: any): Promise<any> {
  console.log('Hello world - setup server lambda called');
  console.log('Event received:', JSON.stringify(event, null, 2));

  // Test RCON functionality with a hardcoded server for now
  // TODO: Get actual server details from the game data
  try {
    const testServerIp = '127.0.0.1'; // Placeholder IP
    const testServerPort = 27015; // Default CS2 port
    const testRconPassword = 'test123'; // Placeholder password
    
    console.log('Testing RCON connection...');
    const rconResult = await sendRconCommand(testServerIp, testServerPort, testRconPassword, 'status');
    
    if (rconResult.success) {
      console.log('RCON Status Response:', rconResult.response);
    } else {
      console.log('RCON Error:', rconResult.error);
    }
  } catch (error) {
    console.error('Error testing RCON:', error);
  }

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
    },
    body: JSON.stringify({ 
      message: 'Hello world - setup server lambda with RCON test',
      timestamp: new Date().toISOString()
    }),
  };
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
