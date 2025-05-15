#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { CertificateStack } from '../lib/certificate-stack';

const app = new cdk.App();

// Get the stack ID from context (--context stackId=xyz)
const stackId = app.node.tryGetContext('stackId');

// Create the stacks with their full names
const apiStackName = 'SquidCupSite-ApiStack';
const frontendStackName = 'SquidCupSite-FrontendStack';
const certificateStackName = 'SquidCupSite-CertificateStack';

// Create stacks based on context parameter or command line stack selection
if (stackId === 'ApiStack') {
  new ApiStack(app, apiStackName);
} else if (stackId === 'FrontendStack') {
  const certStack = new CertificateStack(app, certificateStackName, {
      env: { region: 'us-east-1' },
      crossRegionReferences: true
    });
  new FrontendStack(app, frontendStackName, buildFrontendStackProps(certStack));
} else {
  // Default behavior - check if specific stacks were requested via command line
  const selectedStacks = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  
  if (selectedStacks.includes(apiStackName) || selectedStacks.includes('ApiStack')) {
    new ApiStack(app, apiStackName);
  } else if (selectedStacks.includes(frontendStackName) || selectedStacks.includes('FrontendStack')) {
    const certStack = new CertificateStack(app, certificateStackName, {
      env: { region: 'us-east-1' },
      crossRegionReferences: true
    });
    new FrontendStack(app, frontendStackName, buildFrontendStackProps(certStack));
  } else {
    // No specific selection, instantiate both stacks
    const certStack = new CertificateStack(app, certificateStackName, {
      env: { region: 'us-east-1' },
      crossRegionReferences: true
    });

    new ApiStack(app, apiStackName, { env: { region: 'us-east-2' } });
    new FrontendStack(app, frontendStackName, {
      crossRegionReferences: true,
      env: { region: 'us-east-2' },
      certificateArn: certStack.certificateArn
    });
  }
}

app.synth();

function buildFrontendStackProps(certStack: CertificateStack) {
  return {
      crossRegionReferences: true, 
      env: { region: 'us-east-2' },
      certificateArn: certStack.certificateArn
    }
}