export async function handler(event: any): Promise<any> {
  console.log('Hello world - setup server lambda called');
  console.log('Event received:', JSON.stringify(event, null, 2));

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': 'https://squidcup.spkymnr.xyz',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
    },
    body: JSON.stringify({ 
      message: 'Hello world',
      timestamp: new Date().toISOString()
    }),
  };
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
