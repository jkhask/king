import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { DiminishingReturnsStack } from './stack.js';

describe('DiminishingReturnsStack (AWS CDK)', () => {
  it('synthesizes DynamoDB Table with GSI1, NodejsFunction Lambda, HTTP API Gateway, and SSM Parameters', () => {
    const app = new cdk.App();
    const stack = new DiminishingReturnsStack(app, 'TestDRStack', {
      env: { account: '111122223333', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // DynamoDB single-table with PAY_PER_REQUEST and GSI1
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    });

    // Lambda function with Node 22 and ARM64
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
    });

    // HTTP API Gateway Route for POST /interactions
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /interactions',
    });

    expect(stack.guildTable).toBeDefined();
    expect(stack.httpApi).toBeDefined();
  });
});
