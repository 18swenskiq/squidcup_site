#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

// Create API stack
new ApiStack(app, 'ApiStack', {
  stackName: 'SquidCupSite-ApiStack',
});

// Create Frontend stack that will be deployed after the API
new FrontendStack(app, 'FrontendStack', {
  stackName: 'SquidCupSite-FrontendStack',
});