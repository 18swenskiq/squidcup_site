import * as net from 'net';

// RCON packet types
const RCON_PACKET_TYPE = {
  AUTH: 3,
  EXECCOMMAND: 2,
  AUTH_RESPONSE: 2,
  RESPONSE_VALUE: 0
};

interface RconPacket {
  id: number;
  type: number;
  body: string;
}

interface RconResponse {
  success: boolean;
  response?: string;
  error?: string;
}

export class RconClient {
  private socket: net.Socket | null = null;
  private isAuthenticated = false;
  private requestId = 1;

  constructor(
    private host: string,
    private port: number,
    private password: string,
    private timeout: number = 5000
  ) {}

  private createPacket(type: number, body: string): Buffer {
    const id = this.requestId++;
    const bodyBuffer = Buffer.from(body, 'ascii');
    const packet = Buffer.alloc(14 + bodyBuffer.length);
    
    // Packet structure: size(4) + id(4) + type(4) + body + null(1) + null(1)
    packet.writeInt32LE(10 + bodyBuffer.length, 0); // size
    packet.writeInt32LE(id, 4); // id
    packet.writeInt32LE(type, 8); // type
    bodyBuffer.copy(packet, 12); // body
    packet.writeUInt8(0, 12 + bodyBuffer.length); // null terminator
    packet.writeUInt8(0, 13 + bodyBuffer.length); // null terminator
    
    return packet;
  }

  private parsePacket(buffer: Buffer): RconPacket {
    const size = buffer.readInt32LE(0);
    const id = buffer.readInt32LE(4);
    const type = buffer.readInt32LE(8);
    const body = buffer.subarray(12, 12 + size - 10).toString('ascii');
    
    return { id, type, body };
  }

  private async sendPacket(type: number, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      const packet = this.createPacket(type, body);
      let responseBuffer = Buffer.alloc(0);
      let expectedSize = 0;

      const timeout = setTimeout(() => {
        reject(new Error('RCON request timeout'));
      }, this.timeout);

      const onData = (data: Buffer) => {
        responseBuffer = Buffer.concat([responseBuffer, data]);

        // Read the packet size if we haven't yet
        if (expectedSize === 0 && responseBuffer.length >= 4) {
          expectedSize = responseBuffer.readInt32LE(0) + 4; // +4 for size field itself
        }

        // Check if we have the complete packet
        if (expectedSize > 0 && responseBuffer.length >= expectedSize) {
          clearTimeout(timeout);
          this.socket!.removeListener('data', onData);

          try {
            const response = this.parsePacket(responseBuffer);
            resolve(response.body);
          } catch (error) {
            reject(error);
          }
        }
      };

      this.socket.on('data', onData);
      this.socket.write(packet);
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error('Connection timeout'));
      }, this.timeout);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.socket.connect(this.port, this.host);
    });
  }

  async authenticate(): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected to server');
    }

    try {
      await this.sendPacket(RCON_PACKET_TYPE.AUTH, this.password);
      this.isAuthenticated = true;
    } catch (error) {
      throw new Error(`Authentication failed: ${error}`);
    }
  }

  async executeCommand(command: string): Promise<string> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    return await this.sendPacket(RCON_PACKET_TYPE.EXECCOMMAND, command);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.isAuthenticated = false;
    }
  }
}

export async function sendRconCommand(
  serverIp: string,
  serverPort: number,
  rconPassword: string,
  command: string,
  timeout: number = 5000
): Promise<RconResponse> {
  const client = new RconClient(serverIp, serverPort, rconPassword, timeout);

  try {
    await client.connect();
    await client.authenticate();
    const response = await client.executeCommand(command);
    
    return {
      success: true,
      response: response.trim()
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  } finally {
    client.disconnect();
  }
}
