import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export class CertificateStack extends cdk.Stack {
  public readonly certificateArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: 'us-east-1' }, // Force us-east-1 for CloudFront certificate
    });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'squidcup.spkymnr.xyz',
      validation: acm.CertificateValidation.fromDns(),
    });

    this.certificateArn = certificate.certificateArn;

    console.log(`Certificate ARN: ${this.certificateArn}`);

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificateArn,
      exportName: 'SquidCupCertificateArn',
    });
  }
}
