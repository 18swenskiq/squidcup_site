import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class ApiStack extends cdk.Stack {
  // Constants for Lambda configuration
  private readonly RUNTIME = lambda.Runtime.NODEJS_22_X;
  private readonly MEMORY_SIZE = 512;
  private readonly TIMEOUT = cdk.Duration.seconds(5);
  private readonly REGION = 'us-east-1';
  private readonly LOG_RETENTION = logs.RetentionDays.ONE_WEEK; // 7 days retention for all Lambda logs

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const steamLoginFunction = new NodejsFunction(this, "steam-login-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(10), // Slightly longer for OAuth operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/steam-login-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
        FRONTEND_URL: 'https://squidcup.spkymnr.xyz', // Your actual domain
      },
      bundling: {
        minify: true,
        command: [
        'bash', '-c', 
        'pwd && npm install && ls'
      ],
      },
    });

    const getUserProfileFunction = new NodejsFunction(this, "get-user-profile-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-user-profile-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getMapsFunction = new NodejsFunction(this, "get-maps-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-maps-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const addServerFunction = new NodejsFunction(this, "add-server-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/add-server-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const setupServerFunction = new NodejsFunction(this, "setup-server-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(60), // Extended timeout for server setup operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/setup-server-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const deleteServerFunction = new NodejsFunction(this, "delete-server-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/delete-server-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getServersFunction = new NodejsFunction(this, "get-servers-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-servers-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const startQueueFunction = new NodejsFunction(this, "start-queue-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/start-queue-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getUserQueueFunction = new NodejsFunction(this, "get-user-queue-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(10), // Extended timeout for comprehensive metrics collection
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-user-queue-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getAllQueuesFunction = new NodejsFunction(this, "get-all-queues-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-all-queues-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const leaveQueueFunction = new NodejsFunction(this, "leave-queue-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/leave-queue-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const joinQueueFunction = new NodejsFunction(this, "join-queue-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/join-queue-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getQueueHistoryFunction = new NodejsFunction(this, "get-queue-history-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-queue-history-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getActiveQueuesFunction = new NodejsFunction(this, "get-active-queues-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-active-queues-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const queueCleanupFunction = new NodejsFunction(this, "queue-cleanup-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(30), // Longer timeout for cleanup operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/queue-cleanup-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
        QUEUE_TIMEOUT_MINUTES: '10', // 10 minutes of inactivity before cleanup
      },
      bundling: {
        minify: true,
      }
    });

    const createLobbyFunction = new NodejsFunction(this, "create-lobby-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(10), // Longer timeout for lobby operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/create-lobby-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const leaveLobbyFunction = new NodejsFunction(this, "leave-lobby-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/leave-lobby-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const selectMapFunction = new NodejsFunction(this, "select-map-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/select-map-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
        SETUP_SERVER_FUNCTION_NAME: setupServerFunction.functionName,
      },
      bundling: {
        minify: true,
      }
    });

    const endMatchFunction = new NodejsFunction(this, "end-match-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/end-match-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const acceptMatchResultFunction = new NodejsFunction(this, "accept-match-result-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/accept-match-result-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getMatchHistoryFunction = new NodejsFunction(this, "get-match-history-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-match-history-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getPlayerLeaderboardStatsFunction = new NodejsFunction(this, "get-player-leaderboard-stats-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-player-leaderboard-stats-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    const getMapStatsFunction = new NodejsFunction(this, "get-map-stats-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-map-stats-lambda')),
      logRetention: this.LOG_RETENTION,
      environment: {
        REGION: this.REGION,
      },
      bundling: {
        minify: true,
      }
    });

    // Create an SSM parameter access policy
    const ssmPolicy = new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: ['*'], // This grants access to all parameters
    });

    // Add the SSM policy to all Lambda functions
    addServerFunction.addToRolePolicy(ssmPolicy);
    setupServerFunction.addToRolePolicy(ssmPolicy);
    deleteServerFunction.addToRolePolicy(ssmPolicy);
    getAllQueuesFunction.addToRolePolicy(ssmPolicy);
    getMapsFunction.addToRolePolicy(ssmPolicy);
    getUserQueueFunction.addToRolePolicy(ssmPolicy);
    createLobbyFunction.addToRolePolicy(ssmPolicy);
    getActiveQueuesFunction.addToRolePolicy(ssmPolicy);
    getQueueHistoryFunction.addToRolePolicy(ssmPolicy);
    getServersFunction.addToRolePolicy(ssmPolicy);
    getUserProfileFunction.addToRolePolicy(ssmPolicy);
    joinQueueFunction.addToRolePolicy(ssmPolicy);
    leaveLobbyFunction.addToRolePolicy(ssmPolicy);
    leaveQueueFunction.addToRolePolicy(ssmPolicy);
    queueCleanupFunction.addToRolePolicy(ssmPolicy);
    selectMapFunction.addToRolePolicy(ssmPolicy);
    startQueueFunction.addToRolePolicy(ssmPolicy);
    steamLoginFunction.addToRolePolicy(ssmPolicy);
    endMatchFunction.addToRolePolicy(ssmPolicy);
    acceptMatchResultFunction.addToRolePolicy(ssmPolicy);
    getMatchHistoryFunction.addToRolePolicy(ssmPolicy);
    getPlayerLeaderboardStatsFunction.addToRolePolicy(ssmPolicy);
    getMapStatsFunction.addToRolePolicy(ssmPolicy);

    // Grant Lambda invoke permissions for lobby system
    createLobbyFunction.grantInvoke(joinQueueFunction); // Allow join-queue to invoke create-lobby
    // Note: setupServerFunction.grantInvoke(selectMapFunction) removed - using explicit policy instead
    
    // Add explicit Lambda invoke permissions for select-map to invoke setup-server
    const lambdaInvokePolicy = new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [setupServerFunction.functionArn],
    });
    selectMapFunction.addToRolePolicy(lambdaInvokePolicy);
    
    // Create S3 bucket for game configuration files
    const gameConfigsBucket = new s3.Bucket(this, 'squidcup-game-configs', {
      bucketName: 'squidcup-game-configs',
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep bucket when stack is deleted
    });

    // Grant setup-server-lambda permission to write to the S3 bucket
    gameConfigsBucket.grantPut(setupServerFunction);
    gameConfigsBucket.grantPutAcl(setupServerFunction);

    // Add S3 bucket name as environment variable for setup-server-lambda
    setupServerFunction.addEnvironment('GAME_CONFIGS_BUCKET', gameConfigsBucket.bucketName);
    
    // Grant database service invoke permissions to all lambdas that need it
    // All lambdas now use shared-lambda-utils directly
    // Note: We'll add more functions here as we convert them

    // Add environment variable to join queue function for create lobby function name
    joinQueueFunction.addEnvironment('CREATE_LOBBY_FUNCTION_NAME', createLobbyFunction.functionName);

    // Create CloudWatch log group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogGroup', {
      logGroupName: `/aws/apigateway/squidcup-api`,
      retention: logs.RetentionDays.ONE_WEEK, // Adjust as needed
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
    });

    // Create an API Gateway with specific configuration
    const api = new apigw.RestApi(this, 'SquidCupApi', {
      restApiName: 'SquidCupService',
      deployOptions: {
        stageName: 'prod',
        // Enable CloudWatch logging and detailed metrics
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        tracingEnabled: true,
        accessLogDestination: new apigw.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
      // Remove global CORS to avoid conflicts with Steam OpenID
      cloudWatchRole: true, // Auto-create CloudWatch role for API Gateway
    });
    
    // Add a resource for /maps endpoint
    const mapsResource = api.root.addResource('maps');
    mapsResource.addMethod('GET', new apigw.LambdaIntegration(getMapsFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });
    
    // Add OPTIONS method for maps endpoint
    mapsResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });
    
    // Add a resource for /servers endpoint
    const serversResource = api.root.addResource('servers');
    serversResource.addMethod('GET', new apigw.LambdaIntegration(getServersFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });
    
    // Add servers/{id} resource for PUT operations
    const serverIdResource = serversResource.addResource('{id}');
    
    // Add PUT method for servers/{id} endpoint (admin only)
    serverIdResource.addMethod('PUT', new apigw.LambdaIntegration(getServersFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '403',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for servers endpoint
    serversResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });
    
    // Add OPTIONS method for servers/{id} endpoint
    serverIdResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'PUT,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /auth endpoint with Steam login/logout
    const authResource = api.root.addResource('auth');
    const steamResource = authResource.addResource('steam');
    
    // Steam login endpoint - redirects to Steam OAuth (no CORS needed)
    steamResource.addMethod('GET', new apigw.LambdaIntegration(steamLoginFunction), {
      methodResponses: [{
        statusCode: '302',
        responseParameters: {
          'method.response.header.Location': true,
        },
      }, {
        statusCode: '200',
        responseParameters: {},
      }, {
        statusCode: '500',
        responseParameters: {},
      }],
      requestParameters: {
        'method.request.header.User-Agent': false,
        'method.request.header.X-Forwarded-For': false,
      }
    });
    
    // Steam callback endpoint - handles OAuth callback (no CORS needed)
    const callbackResource = steamResource.addResource('callback');
    callbackResource.addMethod('GET', new apigw.LambdaIntegration(steamLoginFunction), {
      methodResponses: [{
        statusCode: '302',
        responseParameters: {
          'method.response.header.Location': true,
        },
      }, {
        statusCode: '200',
        responseParameters: {},
      }, {
        statusCode: '400',
        responseParameters: {},
      }, {
        statusCode: '500',
        responseParameters: {},
      }],
      requestParameters: {
        'method.request.header.User-Agent': false,
        'method.request.header.X-Forwarded-For': false,
        'method.request.querystring.openid.mode': false,
        'method.request.querystring.openid.claimed_id': false,
      }
    });
    
    // Logout endpoint (needs CORS for frontend calls)
    const logoutResource = authResource.addResource('logout');
    logoutResource.addMethod('POST', new apigw.LambdaIntegration(steamLoginFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });
    
    // Add OPTIONS method for logout endpoint
    logoutResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // User profile endpoint
    const profileResource = api.root.addResource('profile');
    profileResource.addMethod('GET', new apigw.LambdaIntegration(getUserProfileFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });
    
    // Add OPTIONS method for profile endpoint
    profileResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /addServer endpoint
    const addServerResource = api.root.addResource('addServer');
    addServerResource.addMethod('POST', new apigw.LambdaIntegration(addServerFunction), {
      methodResponses: [{
        statusCode: '201',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '403',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for addServer endpoint
    addServerResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /setupServer endpoint
    const setupServerResource = api.root.addResource('setupServer');
    setupServerResource.addMethod('POST', new apigw.LambdaIntegration(setupServerFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '403',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for setupServer endpoint
    setupServerResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /deleteServer endpoint
    const deleteServerResource = api.root.addResource('deleteServer');
    const deleteServerIdResource = deleteServerResource.addResource('{id}');
    deleteServerIdResource.addMethod('DELETE', new apigw.LambdaIntegration(deleteServerFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '403',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '404',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for deleteServer/{id} endpoint
    deleteServerIdResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'DELETE,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /startQueue endpoint
    const startQueueResource = api.root.addResource('startQueue');
    startQueueResource.addMethod('POST', new apigw.LambdaIntegration(startQueueFunction), {
      methodResponses: [{
        statusCode: '201',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '403',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for startQueue endpoint
    startQueueResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /userQueue endpoint
    const userQueueResource = api.root.addResource('userQueue');
    userQueueResource.addMethod('GET', new apigw.LambdaIntegration(getUserQueueFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for userQueue endpoint
    userQueueResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /allQueues endpoint
    const allQueuesResource = api.root.addResource('allQueues');
    allQueuesResource.addMethod('GET', new apigw.LambdaIntegration(getAllQueuesFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '403',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for allQueues endpoint
    allQueuesResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /leaveQueue endpoint
    const leaveQueueResource = api.root.addResource('leaveQueue');
    leaveQueueResource.addMethod('POST', new apigw.LambdaIntegration(leaveQueueFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for leaveQueue endpoint
    leaveQueueResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /joinQueue endpoint
    const joinQueueResource = api.root.addResource('joinQueue');
    joinQueueResource.addMethod('POST', new apigw.LambdaIntegration(joinQueueFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '404',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for joinQueue endpoint
    joinQueueResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /queueHistory endpoint
    const queueHistoryResource = api.root.addResource('queueHistory');
    queueHistoryResource.addMethod('GET', new apigw.LambdaIntegration(getQueueHistoryFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for queueHistory endpoint
    queueHistoryResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add a resource for /activeQueues endpoint
    const activeQueuesResource = api.root.addResource('activeQueues');
    activeQueuesResource.addMethod('GET', new apigw.LambdaIntegration(getActiveQueuesFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });
    
    // Add OPTIONS method for activeQueues endpoint
    activeQueuesResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // ==================== LOBBY ENDPOINTS ====================
    
    // Add /leaveLobby endpoint
    const leaveLobbyResource = api.root.addResource('leaveLobby');
    leaveLobbyResource.addMethod('DELETE', new apigw.LambdaIntegration(leaveLobbyFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '403',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '404',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add OPTIONS method for leaveLobby endpoint
    leaveLobbyResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
          'method.response.header.Access-Control-Allow-Methods': "'DELETE,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add /selectMap endpoint
    const selectMapResource = api.root.addResource('selectMap');
    selectMapResource.addMethod('POST', new apigw.LambdaIntegration(selectMapFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '403',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '404',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add OPTIONS method for selectMap endpoint
    selectMapResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add /endMatch endpoint
    const endMatchResource = api.root.addResource('endMatch');
    endMatchResource.addMethod('POST', new apigw.LambdaIntegration(endMatchFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '404',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add OPTIONS method for endMatch endpoint
    endMatchResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'*'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add /acceptMatchResult endpoint
    const acceptMatchResultResource = api.root.addResource('acceptMatchResult');
    acceptMatchResultResource.addMethod('POST', new apigw.LambdaIntegration(acceptMatchResultFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '404',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add OPTIONS method for acceptMatchResult endpoint
    acceptMatchResultResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add /matchHistory endpoint
    const matchHistoryResource = api.root.addResource('matchHistory');
    matchHistoryResource.addMethod('GET', new apigw.LambdaIntegration(getMatchHistoryFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add OPTIONS method for matchHistory endpoint
    matchHistoryResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add /playerLeaderboardStats endpoint
    const playerLeaderboardStatsResource = api.root.addResource('playerLeaderboardStats');
    playerLeaderboardStatsResource.addMethod('GET', new apigw.LambdaIntegration(getPlayerLeaderboardStatsFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add OPTIONS method for playerLeaderboardStats endpoint
    playerLeaderboardStatsResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Add /mapStats endpoint
    const mapStatsResource = api.root.addResource('mapStats');
    mapStatsResource.addMethod('GET', new apigw.LambdaIntegration(getMapStatsFunction), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }, {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }, {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add OPTIONS method for mapStats endpoint
    mapStatsResource.addMethod('OPTIONS', new apigw.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }]
    });

    // Note: Removed API_BASE_URL environment variable to avoid circular dependency
    // The setup-server-lambda will use a hardcoded API URL instead

    // Create EventBridge rule to run queue cleanup every 5 minutes
    const cleanupRule = new events.Rule(this, 'queue-cleanup-rule', {
      description: 'Triggers queue cleanup every 5 minutes to remove inactive queues',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)), // Run every 5 minutes
    });

    // Add the queue cleanup lambda as a target for the rule
    cleanupRule.addTarget(new targets.LambdaFunction(queueCleanupFunction));

    // Export the API URL as a stack output with a consistent name
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'URL of the API Gateway',
      exportName: 'SquidCupApiUrl'
    });

    // Export the CloudWatch log group name for easy access
    new cdk.CfnOutput(this, 'ApiLogGroup', {
      value: apiLogGroup.logGroupName,
      description: 'CloudWatch log group for API Gateway logs',
    });
  }
}
