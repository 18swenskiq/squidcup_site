#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { ApiStackUnified } from '../lib/api-stack-unified';
import { FrontendStack } from '../lib/frontend-stack';
import { CertificateStack } from '../lib/certificate-stack';

// Set to true to use the new consolidated Lambda architecture
// Default is now true - set USE_UNIFIED_API=false to revert to legacy multi-Lambda stack
const USE_UNIFIED_API = process.env.USE_UNIFIED_API !== 'false';

const app = new cdk.App();

// Get the stack ID from context (--context stackId=xyz)
const stackId = app.node.tryGetContext('stackId');
console.log(`StackId: ${stackId}`);

// Create the stacks with their full names
const apiStackName = 'SquidCupSite-ApiStack';
const frontendStackName = 'SquidCupSite-FrontendStack';
const certificateStackName = 'SquidCupSite-CertificateStack';

// Create stacks based on context parameter or command line stack selection
if (stackId === 'ApiStack') {
  if (USE_UNIFIED_API) {
    new ApiStackUnified(app, apiStackName, { env: { region: 'us-east-1' } });
  } else {
    new ApiStack(app, apiStackName, { env: { region: 'us-east-1' } });
  }
}
else if (stackId === 'FrontendStack') {
  const certStack = new CertificateStack(app, certificateStackName, {
    env: { region: 'us-east-1' }
  });
  new FrontendStack(app, frontendStackName, buildFrontendStackProps(certStack));
}
else {
  // Default behavior - check if specific stacks were requested via command line
  const selectedStacks = process.argv.slice(2).filter(arg => !arg.startsWith('-'));

  if (selectedStacks.includes(apiStackName) || selectedStacks.includes('ApiStack')) {
    if (USE_UNIFIED_API) {
      new ApiStackUnified(app, apiStackName, { env: { region: 'us-east-1' } });
    } else {
      new ApiStack(app, apiStackName, { env: { region: 'us-east-1' } });
    }
  }
  else if (selectedStacks.includes(frontendStackName) || selectedStacks.includes('FrontendStack')) {
    const certStack = new CertificateStack(app, certificateStackName, {
      env: { region: 'us-east-1' }
    });

    new FrontendStack(app, frontendStackName, buildFrontendStackProps(certStack));
  }
  else {
    // No specific selection, instantiate both stacks
    const certStack = new CertificateStack(app, certificateStackName, {
      env: { region: 'us-east-1' }
    });

    if (USE_UNIFIED_API) {
      new ApiStackUnified(app, apiStackName, { env: { region: 'us-east-1' } });
    } else {
      new ApiStack(app, apiStackName, { env: { region: 'us-east-1' } });
    }

    new FrontendStack(app, frontendStackName, {
      env: { region: 'us-east-1' },
      certificateArn: certStack.certificateArn
    });
  }
}

app.synth();

function buildFrontendStackProps(certStack: CertificateStack) {
  return {
    env: { region: 'us-east-1' },
    certificateArn: certStack.certificateArn
  }
}