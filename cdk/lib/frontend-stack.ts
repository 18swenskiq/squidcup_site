import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import * as fs from 'fs';

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the S3 bucket
    const websiteBucket = new s3.Bucket(this, "squidcup_site_frontend", {
      encryption: s3.BucketEncryption.S3_MANAGED, 
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false
      }),
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
    });

    // Deploy the frontend assets to the S3 bucket - this will fail if assets don't exist
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../assets/browser'))],
      destinationBucket: websiteBucket,
    });
  }
}
