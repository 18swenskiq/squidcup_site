#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

const stackId = app.node.tryGetContext('stackId');

// If stackId is specified, only instantiate the requested stack
if (stackId === 'ApiStack') {
  new ApiStack(app, 'SquidCupSite-ApiStack');
} else if (stackId === 'FrontendStack') {
  new FrontendStack(app, 'SquidCupSite-FrontendStack');
} else {
  // If no specific stack is requested, instantiate both (default behavior)
  new ApiStack(app, 'SquidCupSite-ApiStack');
  new FrontendStack(app, 'SquidCupSite-FrontendStack');
}

app.synth();