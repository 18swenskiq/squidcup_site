/**
 * AWS Lambda function handler for retrieving maps data
 */
export async function handler(event: any): Promise<any> {
  console.log('region 👉', process.env.REGION);
  console.log('availability zones 👉', process.env.AVAILABILITY_ZONES);
  console.log('event 👉', JSON.stringify(event));

  return {
    body: JSON.stringify({message: 'SUCCESS 🎉'}),
    statusCode: 200,
  };
}

// Also export using CommonJS for maximum compatibility
module.exports.handler = handler;
