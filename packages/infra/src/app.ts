#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DiminishingReturnsStack } from './stack.js';

const app = new cdk.App();

new DiminishingReturnsStack(app, 'DiminishingReturnsStack', {
  description:
    'Diminishing Returns (Alliance) Guild Logistics Bot & Gargul Loot Council DB for World of Warcraft: Forever',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  },
});
