import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as fs from 'fs';

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the S3 bucket
    const websiteBucket = new s3.Bucket(this, "squidcup_site_frontend", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html'
    });

    // Create Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${id}`
    });

    // Grant read permissions to CloudFront
    websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [websiteBucket.arnForObjects('*')],
      principals: [new iam.CanonicalUserPrincipal(originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
    }));

    // Create logging bucket for CloudFront
    const logBucket = new s3.Bucket(this, 'CloudFrontLogsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // Optional: automatically delete logs when stack is destroyed
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30) // Optional: automatically delete logs after 30 days
        }
      ]
    });

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'SquidcupDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, {
          originAccessIdentity: originAccessIdentity
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        }
      ],
      logBucket: logBucket,
      logFilePrefix: 'cloudfront-logs/' // Optional: organize logs in a prefix
    });

    // Check if assets directory exists before attempting deployment
    const assetsPath = path.join(__dirname, '../assets/browser');
    if (fs.existsSync(assetsPath)) {
      new s3deploy.BucketDeployment(this, 'DeployWebsite', {
        sources: [s3deploy.Source.asset(assetsPath)],
        destinationBucket: websiteBucket,
        distribution,
        distributionPaths: ['/*'],
      });
    } else {
      console.log('Frontend assets directory not found at:', assetsPath);
      console.log('Skipping frontend deployment - bucket created without content');
    }

    // Output the CloudFront URL
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'Website URL'
    });
  }
}
