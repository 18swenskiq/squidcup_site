import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as path from 'path';

export class ApiStack extends Construct {
  // Constants for Lambda configuration
  private readonly RUNTIME = lambda.Runtime.NODEJS_22_X;
  private readonly MEMORY_SIZE = 1024;
  private readonly TIMEOUT = cdk.Duration.seconds(5);
  private readonly REGION = 'us-east-2';

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const getMapsFunction = new lambda.Function(this, "get-maps-function", {
      runtime: this.RUNTIME,
      memorySize: this.MEMORY_SIZE,
      timeout: this.TIMEOUT,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '/../src/get-maps-lambda')),
      environment: {
        REGION: this.REGION,
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
      }
    });

    // Create an API Gateway with specific configuration
    const api = new apigw.RestApi(this, 'SquidCupApi', {
      restApiName: 'SquidCupService',
      deployOptions: {
        stageName: 'prod',
      }
    });
    
    // Add a resource for /maps endpoint
    const mapsResource = api.root.addResource('maps');
    mapsResource.addMethod('GET', new apigw.LambdaIntegration(getMapsFunction));
    
    // Add a resource for /servers endpoint
    const serversResource = api.root.addResource('servers');
    serversResource.addMethod('GET', new apigw.LambdaIntegration(getServersFunction));
  }
}
