// eslint-disable-next-line @typescript-eslint/no-var-requires
const Rcon = require('rcon');

interface RconResponse {
  success: boolean;
  response?: string;
  error?: string;
}

export async function sendRconCommand(
  serverIp: string,
  serverPort: number,
  rconPassword: string,
  command: string,
  timeout: number = 10000
): Promise<RconResponse> {
  return new Promise((resolve) => {
    const rcon = new Rcon(serverIp, serverPort, rconPassword);
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      rcon.disconnect();
      resolve({
        success: false,
        error: 'RCON connection timeout'
      });
    }, timeout);

    // Handle connection
    rcon.on('auth', () => {
      console.log('RCON authenticated successfully');
      rcon.send(command);
    });

    // Handle response
    rcon.on('response', (response: string) => {
      clearTimeout(timeoutId);
      rcon.disconnect();
      resolve({
        success: true,
        response: response.trim()
      });
    });

    // Handle errors
    rcon.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      rcon.disconnect();
      resolve({
        success: false,
        error: error.message
      });
    });

    // Handle connection end
    rcon.on('end', () => {
      clearTimeout(timeoutId);
    });

    // Connect to the server
    try {
      rcon.connect();
    } catch (error) {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown connection error'
      });
    }
  });
}
