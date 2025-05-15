import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export class CertificateStack extends cdk.Stack {
  public readonly certificateArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'squidcup.spkymnr.xyz',
      validation: acm.CertificateValidation.fromDns(),
    });

    this.certificateArn = certificate.certificateArn;

    // Store certificate ARN in SSM Parameter Store
    new ssm.StringParameter(this, 'CertificateArnParameter', {
      parameterName: '/squidcup/certificate-arn',
      stringValue: this.certificateArn,
    });

    console.log(this.certificateArn);

    // Export the ARN with a specific name for cross-region reference
    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificateArn,
      exportName: 'SquidCupCertificateArn',
    });
  }
}
