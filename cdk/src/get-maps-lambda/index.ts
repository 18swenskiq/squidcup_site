async function getMaps(event: any) {
  console.log('region 👉', process.env.REGION);
  console.log('availability zones 👉', process.env.AVAILABILITY_ZONES);

  return {
    body: JSON.stringify({message: 'SUCCESS 🎉'}),
    statusCode: 200,
  };
}

// Export as handler instead of main
exports.handler = getMaps;
