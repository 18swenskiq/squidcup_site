import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

export class ApiStack extends cdk.Stack {
  // Constants for Lambda configuration
  private readonly RUNTIME = lambda.Runtime.NODEJS_22_X;
  private readonly MEMORY_SIZE = 512;
  private readonly TIMEOUT = cdk.Duration.seconds(5);
  private readonly REGION = 'us-east-1';

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const steamLoginFunction = new lambda.Function(this, "steam-login-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(10), // Slightly longer for OAuth operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/steam-login-lambda')),
      environment: {
        REGION: this.REGION,
        FRONTEND_URL: 'https://squidcup.spkymnr.xyz', // Your actual domain
      }
    });

    // Database service lambda - centralized MySQL operations
    const databaseServiceFunction = new lambda.Function(this, "database-service-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(30), // Longer timeout for database operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/database-service-lambda')),
      environment: {
        REGION: this.REGION,
      }
    });

    const getUserProfileFunction = new lambda.Function(this, "get-user-profile-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-user-profile-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const getMapsFunction = new lambda.Function(this, "get-maps-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-maps-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const addServerFunction = new lambda.Function(this, "add-server-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/add-server-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const deleteServerFunction = new lambda.Function(this, "delete-server-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/delete-server-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const getServersFunction = new lambda.Function(this, "get-servers-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-servers-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const startQueueFunction = new lambda.Function(this, "start-queue-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/start-queue-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const getUserQueueFunction = new lambda.Function(this, "get-user-queue-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-user-queue-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const getAllQueuesFunction = new lambda.Function(this, "get-all-queues-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-all-queues-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const leaveQueueFunction = new lambda.Function(this, "leave-queue-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/leave-queue-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const joinQueueFunction = new lambda.Function(this, "join-queue-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/join-queue-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const getQueueHistoryFunction = new lambda.Function(this, "get-queue-history-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-queue-history-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const getActiveQueuesFunction = new lambda.Function(this, "get-active-queues-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-active-queues-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const queueCleanupFunction = new lambda.Function(this, "queue-cleanup-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(30), // Longer timeout for cleanup operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/queue-cleanup-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
        QUEUE_TIMEOUT_MINUTES: '10', // 10 minutes of inactivity before cleanup
      }
    });

    const createLobbyFunction = new lambda.Function(this, "create-lobby-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(10), // Longer timeout for lobby operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/create-lobby-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const leaveLobbyFunction = new lambda.Function(this, "leave-lobby-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/leave-lobby-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    const selectMapFunction = new lambda.Function(this, "select-map-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/select-map-lambda')),
      environment: {
        REGION: this.REGION,
        DATABASE_SERVICE_FUNCTION_NAME: databaseServiceFunction.functionName,
      }
    });

    // Create an SSM parameter access policy
    const ssmPolicy = new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: ['*'], // This grants access to all parameters
    });

    // Add the SSM policy to all Lambda functions
    databaseServiceFunction.addToRolePolicy(ssmPolicy);
    addServerFunction.addToRolePolicy(ssmPolicy);
    deleteServerFunction.addToRolePolicy(ssmPolicy);
    getUserQueueFunction.addToRolePolicy(ssmPolicy);
    createLobbyFunction.addToRolePolicy(ssmPolicy);

    // Grant database service permissions to Lambda functions
    databaseServiceFunction.grantInvoke(getUserProfileFunction);
    databaseServiceFunction.grantInvoke(getUserQueueFunction);
    databaseServiceFunction.grantInvoke(queueCleanupFunction);

    // Grant Lambda invoke permissions for lobby system
    createLobbyFunction.grantInvoke(joinQueueFunction); // Allow join-queue to invoke create-lobby
    
    // Grant database service invoke permissions to all lambdas that need it
    databaseServiceFunction.grantInvoke(addServerFunction);
    databaseServiceFunction.grantInvoke(createLobbyFunction);
    databaseServiceFunction.grantInvoke(deleteServerFunction);
    databaseServiceFunction.grantInvoke(getActiveQueuesFunction);
    databaseServiceFunction.grantInvoke(getAllQueuesFunction);
    databaseServiceFunction.grantInvoke(getMapsFunction);
    databaseServiceFunction.grantInvoke(getQueueHistoryFunction);
    databaseServiceFunction.grantInvoke(getServersFunction);
    databaseServiceFunction.grantInvoke(joinQueueFunction);
    databaseServiceFunction.grantInvoke(leaveLobbyFunction);
    databaseServiceFunction.grantInvoke(leaveQueueFunction);
    databaseServiceFunction.grantInvoke(selectMapFunction);
    databaseServiceFunction.grantInvoke(startQueueFunction);
    databaseServiceFunction.grantInvoke(steamLoginFunction);
    // Note: We'll add more functions here as we convert them

    // Add environment variable to join queue function for create lobby function name
    joinQueueFunction.addEnvironment('CREATE_LOBBY_FUNCTION_NAME', createLobbyFunction.functionName);
    
    // Add database service function name to steam login function
    steamLoginFunction.addEnvironment('DATABASE_SERVICE_FUNCTION_NAME', databaseServiceFunction.functionName);

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
