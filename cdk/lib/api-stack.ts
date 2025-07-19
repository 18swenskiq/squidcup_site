import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export class ApiStack extends cdk.Stack {
  // Constants for Lambda configuration
  private readonly RUNTIME = lambda.Runtime.NODEJS_22_X;
  private readonly MEMORY_SIZE = 512;
  private readonly TIMEOUT = cdk.Duration.seconds(5);
  private readonly REGION = 'us-east-1';

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create DynamoDB table
    const table = new dynamodb.Table(this, 'SquidCupTable', {
      tableName: 'squidcup-data',
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
      pointInTimeRecovery: true,
    });

    // Add GSI1 for querying active queues
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'GSI1PK',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'GSI1SK',
        type: dynamodb.AttributeType.STRING
      },
    });

    const getMapsFunction = new lambda.Function(this, "get-maps-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',  // The Lambda runtime will look for index.js
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-maps-lambda')),
      environment: {
        REGION: this.REGION,
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
      }
    });

    const steamLoginFunction = new lambda.Function(this, "steam-login-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: cdk.Duration.seconds(10), // Slightly longer for OAuth operations
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/steam-login-lambda')),
      environment: {
        REGION: this.REGION,
        TABLE_NAME: table.tableName,
        FRONTEND_URL: 'https://squidcup.spkymnr.xyz', // Your actual domain
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
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
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
        TABLE_NAME: table.tableName,
      }
    });

    // Create an SSM parameter access policy
    const ssmPolicy = new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: ['*'], // This grants access to all parameters
    });

    // Add the SSM policy to all Lambda functions
    getMapsFunction.addToRolePolicy(ssmPolicy);
    getServersFunction.addToRolePolicy(ssmPolicy);
    steamLoginFunction.addToRolePolicy(ssmPolicy);
    getUserProfileFunction.addToRolePolicy(ssmPolicy);
    getUserQueueFunction.addToRolePolicy(ssmPolicy);
    getAllQueuesFunction.addToRolePolicy(ssmPolicy);
    leaveQueueFunction.addToRolePolicy(ssmPolicy);
    getQueueHistoryFunction.addToRolePolicy(ssmPolicy);

    // Grant DynamoDB permissions to Lambda functions
    table.grantReadWriteData(getMapsFunction);
    table.grantReadWriteData(getServersFunction);
    table.grantReadWriteData(steamLoginFunction);
    table.grantReadWriteData(getUserProfileFunction);
    table.grantReadWriteData(addServerFunction);
    table.grantReadWriteData(deleteServerFunction);
    table.grantReadWriteData(startQueueFunction);
    table.grantReadWriteData(getUserQueueFunction);
    table.grantReadWriteData(getAllQueuesFunction);
    table.grantReadWriteData(leaveQueueFunction);
    table.grantReadWriteData(joinQueueFunction);
    table.grantReadWriteData(getQueueHistoryFunction);

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
          'method.response.header.Access-Control-Allow-Origin': "'*'",
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
          'method.response.header.Access-Control-Allow-Origin': "'*'",
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
          'method.response.header.Access-Control-Allow-Origin': "'*'",
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
          'method.response.header.Access-Control-Allow-Origin': "'*'",
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
          'method.response.header.Access-Control-Allow-Origin': "'*'",
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
          'method.response.header.Access-Control-Allow-Origin': "'*'",
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
          'method.response.header.Access-Control-Allow-Origin': "'*'",
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
          'method.response.header.Access-Control-Allow-Origin': "'*'",
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

    // Export the API URL as a stack output with a consistent name
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'URL of the API Gateway',
      exportName: 'SquidCupApiUrl'
    });

    // Export the DynamoDB table name
    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'Name of the DynamoDB table',
      exportName: 'SquidCupTableName'
    });

    // Export the CloudWatch log group name for easy access
    new cdk.CfnOutput(this, 'ApiLogGroup', {
      value: apiLogGroup.logGroupName,
      description: 'CloudWatch log group for API Gateway logs',
    });
  }
}
