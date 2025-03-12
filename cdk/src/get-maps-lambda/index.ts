import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

// Initialize the SSM client
const ssmClient = new SSMClient({ region: 'us-east-2' });

const steamIds: {"gameMode": "5v5" | "wingman" | "3v3", "id": string}[] = [
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

export async function handler(event: any): Promise<any> {
  // Extract query parameters and headers
  const queryParams = event.queryStringParameters || {};
  const headers = event.headers || {};

  //console.log('query parameters 👉', JSON.stringify(queryParams));
  //console.log('headers 👉', JSON.stringify(headers));

  // Get Steam API key from Parameter Store
  let steamApiKey = '';
  try {
    steamApiKey = await getParameterValue('/unencrypted/SteamApiKey');
    console.log('Successfully retrieved Steam API key');
  } catch (error) {
    console.error('Failed to retrieve Steam API key:', error);
  }

  const collectionId = "2747675401";

  // Create URLSearchParams directly instead of FormData
  const params = new URLSearchParams();
  params.append("key", steamApiKey);
  params.append("collectioncount", "1");
  params.append("publishedfileids[0]", collectionId);

  const response = await fetch(`https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/`, {
    method: 'POST',
    body: params,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
  });

  console.log(response);

  try {
    const jsonData = await response.json();
    return {
      body: JSON.stringify({
        message: 'SUCCESS 🎉',
        steamApiKeyRetrieved: !!steamApiKey,
        response: jsonData,
      }),
      statusCode: 200,
    };
  } catch (error) {
    return {
      body: JSON.stringify({
        message: 'ERROR parsing response',
        steamApiKeyRetrieved: !!steamApiKey,
        error: error,
      }),
      statusCode: 500,
    };
  }
}

// Also export using CommonJS for maximum compatibility
exports.handler = handler;
