#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { CertificateStack } from '../lib/certificate-stack';

const app = new cdk.App();

// Get the stack ID from context (--context stackId=xyz)
const stackId = app.node.tryGetContext('stackId');

// Create the stacks with their full names
const apiStackName = 'SquidCupSite-ApiStack';
const frontendStackName = 'SquidCupSite-FrontendStack';
const certificateStackName = 'SquidCupCertificateStack';

// Create stacks based on context parameter or command line stack selection
if (stackId === 'ApiStack') {
  new ApiStack(app, apiStackName);
} else if (stackId === 'FrontendStack') {
  new FrontendStack(app, frontendStackName);
} else {
  // Default behavior - check if specific stacks were requested via command line
  const selectedStacks = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  
  if (selectedStacks.includes(apiStackName) || selectedStacks.includes('ApiStack')) {
    new ApiStack(app, apiStackName);
  } else if (selectedStacks.includes(frontendStackName) || selectedStacks.includes('FrontendStack')) {
    new FrontendStack(app, frontendStackName);
  } else {
    // No specific selection, instantiate both stacks
    const certStack = new CertificateStack(app, certificateStackName, {
      env: { region: 'us-east-1' },
    });

    new ApiStack(app, apiStackName);
    new FrontendStack(app, frontendStackName, {}, certStack.certificate.certificateArn);
  }
}

app.synth();