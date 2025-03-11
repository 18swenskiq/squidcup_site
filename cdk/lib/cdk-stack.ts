import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FrontendStack } from './frontend-stack';
import { ApiStack } from './api-stack';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create separate stacks for different concerns
    new FrontendStack(this, 'FrontendStack');
    new ApiStack(this, 'ApiStack');
  }
}
