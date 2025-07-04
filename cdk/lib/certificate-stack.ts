import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export class CertificateStack extends cdk.Stack {
  public readonly certificateArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'squidcup.spkymnr.xyz',
      validation: acm.CertificateValidation.fromDns(),
    });

    this.certificateArn = certificate.certificateArn;

    // Export the ARN for use in other stacks
    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificateArn,
      exportName: 'SquidCupCertificateArn',
    });
  }
}
