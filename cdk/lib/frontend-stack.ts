import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';

export class FrontendStack extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create the S3 bucket
    const websiteBucket = new s3.Bucket(this, "squidcup_site_frontend", {
      encryption: s3.BucketEncryption.S3_MANAGED, 
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
    });

    // Deploy the frontend assets to the S3 bucket
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../assets'))],
      destinationBucket: websiteBucket,
    });
  }
}
