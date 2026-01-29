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

/**
 * Unified API Stack
 * 
 * This stack consolidates all 30 individual Lambda functions into a single
 * unified Lambda function that handles all API routes. This eliminates cold
 * starts and simplifies deployment.
 */
export class ApiStackUnified extends cdk.Stack {
    // Constants for Lambda configuration
    private readonly RUNTIME = lambda.Runtime.NODEJS_22_X;
    private readonly REGION = 'us-east-1';
    private readonly LOG_RETENTION = logs.RetentionDays.ONE_WEEK;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // ========================================================================
        // UNIFIED API LAMBDA
        // ========================================================================
        // A single Lambda function that handles all API routes via internal routing

        const unifiedApiFunction = new NodejsFunction(this, "unified-api-function", {
            runtime: this.RUNTIME,
            memorySize: 1024, // Increased memory for handling all routes
            timeout: cdk.Duration.seconds(30), // Increased timeout for complex operations
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '/../src/unified-api-lambda')),
            logRetention: this.LOG_RETENTION,
            environment: {
                REGION: this.REGION,
                FRONTEND_URL: 'https://squidcup.spkymnr.xyz',
            },
            bundling: {
                minify: true,
                // Include openid dependency
                externalModules: ['@aws-sdk/*'],
            },
        });

        // ========================================================================
        // IAM POLICIES
        // ========================================================================

        // SSM Parameter Store access for database credentials, Steam API key, etc.
        const ssmPolicy = new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: ['*'],
        });
        unifiedApiFunction.addToRolePolicy(ssmPolicy);

        // ========================================================================
        // S3 BUCKET FOR GAME CONFIGS
        // ========================================================================

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
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // Grant Lambda permission to write to S3 bucket
        gameConfigsBucket.grantPut(unifiedApiFunction);
        gameConfigsBucket.grantPutAcl(unifiedApiFunction);
        unifiedApiFunction.addEnvironment('GAME_CONFIGS_BUCKET', gameConfigsBucket.bucketName);

        // ========================================================================
        // CLOUDWATCH LOGS
        // ========================================================================

        const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogGroup', {
            logGroupName: `/aws/apigateway/squidcup-api`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // ========================================================================
        // API GATEWAY - REST API with Lambda Proxy Integration
        // ========================================================================

        const api = new apigw.RestApi(this, 'SquidCupApi', {
            restApiName: 'SquidCupService',
            deployOptions: {
                stageName: 'prod',
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
            cloudWatchRole: true,
        });

        // Lambda integration with proxy enabled
        const lambdaIntegration = new apigw.LambdaIntegration(unifiedApiFunction, {
            proxy: true,
        });

        // Standard method response parameters for CORS - all status codes need consistent headers
        const corsResponseParams = {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
        };

        const methodResponsesCors: apigw.MethodResponse[] = [
            { statusCode: '200', responseParameters: corsResponseParams },
            { statusCode: '400', responseParameters: corsResponseParams },
            { statusCode: '401', responseParameters: corsResponseParams },
            { statusCode: '403', responseParameters: corsResponseParams },
            { statusCode: '404', responseParameters: corsResponseParams },
            { statusCode: '500', responseParameters: corsResponseParams },
        ];

        // Helper function to add OPTIONS method for CORS preflight
        const addCorsOptions = (resource: apigw.IResource, allowedMethods: string) => {
            resource.addMethod('OPTIONS', new apigw.MockIntegration({
                integrationResponses: [{
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': "'https://squidcup.spkymnr.xyz'",
                        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
                        'method.response.header.Access-Control-Allow-Methods': `'${allowedMethods}'`,
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
        };

        // ========================================================================
        // AUTH ROUTES
        // ========================================================================

        const authResource = api.root.addResource('auth');
        const steamAuthResource = authResource.addResource('steam');
        steamAuthResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(steamAuthResource, 'GET,OPTIONS');

        const steamCallbackResource = steamAuthResource.addResource('callback');
        steamCallbackResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(steamCallbackResource, 'GET,OPTIONS');

        const logoutResource = authResource.addResource('logout');
        logoutResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(logoutResource, 'POST,OPTIONS');

        // ========================================================================
        // MAPS ROUTE
        // ========================================================================

        const mapsResource = api.root.addResource('maps');
        mapsResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(mapsResource, 'GET,OPTIONS');

        // ========================================================================
        // SERVERS ROUTES
        // ========================================================================

        const serversResource = api.root.addResource('servers');
        serversResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(serversResource, 'GET,PUT,OPTIONS');

        const serverIdResource = serversResource.addResource('{id}');
        serverIdResource.addMethod('PUT', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(serverIdResource, 'PUT,OPTIONS');

        const addServerResource = api.root.addResource('addServer');
        addServerResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(addServerResource, 'POST,OPTIONS');

        const setupServerResource = api.root.addResource('setupServer');
        setupServerResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(setupServerResource, 'POST,OPTIONS');

        const deleteServerResource = api.root.addResource('deleteServer');
        const deleteServerIdResource = deleteServerResource.addResource('{id}');
        deleteServerIdResource.addMethod('DELETE', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(deleteServerIdResource, 'DELETE,OPTIONS');

        // ========================================================================
        // QUEUE ROUTES
        // ========================================================================

        const startQueueResource = api.root.addResource('startQueue');
        startQueueResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(startQueueResource, 'POST,OPTIONS');

        const userQueueResource = api.root.addResource('userQueue');
        userQueueResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(userQueueResource, 'GET,OPTIONS');

        const joinQueueResource = api.root.addResource('joinQueue');
        joinQueueResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(joinQueueResource, 'POST,OPTIONS');

        const leaveQueueResource = api.root.addResource('leaveQueue');
        leaveQueueResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(leaveQueueResource, 'POST,OPTIONS');

        const queuesResource = api.root.addResource('queues');
        queuesResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(queuesResource, 'GET,OPTIONS');

        const activeQueuesResource = api.root.addResource('activeQueues');
        activeQueuesResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(activeQueuesResource, 'GET,OPTIONS');

        const queueHistoryResource = api.root.addResource('queueHistory');
        queueHistoryResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(queueHistoryResource, 'GET,OPTIONS');

        // ========================================================================
        // LOBBY ROUTES
        // ========================================================================

        const createLobbyResource = api.root.addResource('createLobby');
        createLobbyResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(createLobbyResource, 'POST,OPTIONS');

        const leaveLobbyResource = api.root.addResource('leaveLobby');
        leaveLobbyResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(leaveLobbyResource, 'POST,OPTIONS');

        const selectMapResource = api.root.addResource('selectMap');
        selectMapResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(selectMapResource, 'POST,OPTIONS');

        const endMatchResource = api.root.addResource('endMatch');
        endMatchResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(endMatchResource, 'POST,OPTIONS');

        // ========================================================================
        // USER MATCH ROUTES
        // ========================================================================

        const acceptMatchResultResource = api.root.addResource('acceptMatchResult');
        acceptMatchResultResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(acceptMatchResultResource, 'POST,OPTIONS');

        const matchHistoryResource = api.root.addResource('matchHistory');
        matchHistoryResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(matchHistoryResource, 'GET,OPTIONS');

        // ========================================================================
        // USER PROFILE ROUTES
        // ========================================================================

        const profileResource = api.root.addResource('profile');
        profileResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(profileResource, 'GET,OPTIONS');

        const userResource = api.root.addResource('user');
        const userSteamIdResource = userResource.addResource('{steamId}');
        userSteamIdResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(userSteamIdResource, 'GET,OPTIONS');

        // ========================================================================
        // STATS ROUTES
        // ========================================================================

        const leaderboardResource = api.root.addResource('leaderboard');
        leaderboardResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(leaderboardResource, 'GET,OPTIONS');

        const mapStatsResource = api.root.addResource('mapStats');
        mapStatsResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(mapStatsResource, 'GET,OPTIONS');

        const playerStatsResource = api.root.addResource('playerStats');
        const playerStatsSteamIdResource = playerStatsResource.addResource('{steamId}');
        playerStatsSteamIdResource.addMethod('GET', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(playerStatsSteamIdResource, 'GET,OPTIONS');

        // ========================================================================
        // ADMIN ROUTES
        // ========================================================================

        const recalculateEloResource = api.root.addResource('recalculateElo');
        recalculateEloResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });
        addCorsOptions(recalculateEloResource, 'POST,OPTIONS');

        // ========================================================================
        // GAME SERVER API ROUTES (IP-based auth)
        // ========================================================================

        const apiResource = api.root.addResource('api');
        const matchesApiResource = apiResource.addResource('matches');

        // POST /api/matches/init
        const initResource = matchesApiResource.addResource('init');
        initResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });

        // POST /api/matches/{matchId}/map/{mapNumber}/finalize
        const matchIdApiResource = matchesApiResource.addResource('{matchId}');
        const mapResource = matchIdApiResource.addResource('map');
        const mapNumberResource = mapResource.addResource('{mapNumber}');
        const finalizeResource = mapNumberResource.addResource('finalize');
        finalizeResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });

        // POST /api/matches/{matchId}/players/{steamId}/stats
        const playersApiResource = matchIdApiResource.addResource('players');
        const playerSteamIdApiResource = playersApiResource.addResource('{steamId}');
        const statsResource = playerSteamIdApiResource.addResource('stats');
        statsResource.addMethod('POST', lambdaIntegration, { methodResponses: methodResponsesCors });

        // ========================================================================
        // EVENTBRIDGE RULE FOR QUEUE CLEANUP
        // ========================================================================

        // Run every 5 minutes to cleanup stale queues
        const rule = new events.Rule(this, 'QueueCleanupRule', {
            schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
        });

        rule.addTarget(new targets.LambdaFunction(unifiedApiFunction, {
            event: events.RuleTargetInput.fromObject({
                path: '/queueCleanup',
                httpMethod: 'POST',
                headers: {},
                body: '{}',
            }),
        }));

        // ========================================================================
        // OUTPUTS
        // ========================================================================

        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: api.url,
            description: 'The URL of the API Gateway',
        });

        new cdk.CfnOutput(this, 'UnifiedLambdaName', {
            value: unifiedApiFunction.functionName,
            description: 'The name of the unified API Lambda function',
        });
    }
}
