import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as fs from 'fs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface FrontendStackProps extends cdk.StackProps {
  certificateArn: string;
}

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // Create the S3 bucket
    const websiteBucket = new s3.Bucket(this, "squidcup_site_frontend", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
    });

    // Create Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${id}`
    });

    // Grant read permissions to CloudFront with updated policy
    websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [websiteBucket.arnForObjects('*'), websiteBucket.bucketArn],
      principals: [new iam.CanonicalUserPrincipal(originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
    }));

    // Create logging bucket for CloudFront with ACLs enabled
    const logBucket = new s3.Bucket(this, 'CloudFrontLogsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER, // Enable ACLs
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30)
        }
      ]
    });

    // Grant CloudFront log delivery access to the bucket
    logBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [logBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('logging.s3.amazonaws.com')]
    }));

    // Get certificate ARN from SSM Parameter Store
    const certificateArn = ssm.StringParameter.valueFromLookup(
      this,
      '/squidcup/certificate-arn'
    );

    // Import the certificate from ARN
    const certificate = acm.Certificate.fromCertificateArn(
      this, 'Certificate', certificateArn
    );

    // Create CloudFront distribution with updated configuration
    const distribution = new cloudfront.Distribution(this, 'SquidcupDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, {
          originAccessIdentity,
          originPath: ''
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
      },
      domainNames: ['squidcup.spkymnr.xyz'],
      certificate: certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        },
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

    // Add domain name output
    new cdk.CfnOutput(this, 'DomainName', {
      value: 'squidcup.spkymnr.xyz',
      description: 'Custom domain name'
    });

    // Add certificate ARN output
    new cdk.CfnOutput(this, 'CertificateArn', {
      value: props.certificateArn,
      description: 'Certificate ARN'
    });
  }
}
