import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DiminishingReturnsStackProps extends cdk.StackProps {
  /**
   * Optional override for the DynamoDB table name.
   */
  tableName?: string;
}

export class DiminishingReturnsStack extends cdk.Stack {
  public readonly guildTable: dynamodb.Table;
  public readonly interactionFunction: nodejs.NodejsFunction;
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props?: DiminishingReturnsStackProps) {
    super(scope, id, props);

    // 1. Single-Table DynamoDB Store for Characters, Raids, Signups, Gargul Loot History, LC & Guild Bank
    this.guildTable = new dynamodb.Table(this, 'DiminishingReturnsTable', {
      tableName: props?.tableName,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.guildTable.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 2. SSM Parameters for Discord Application Credentials (accessible across any dev machine)
    const discordPublicKeyParam = new ssm.StringParameter(this, 'DiscordPublicKeyParam', {
      parameterName: '/dr/discord/public-key',
      stringValue: process.env.DISCORD_PUBLIC_KEY || 'REPLACE_ME',
      description: 'Discord Application Ed25519 Public Key for Diminishing Returns bot',
    });

    const discordAppIdParam = new ssm.StringParameter(this, 'DiscordAppIdParam', {
      parameterName: '/dr/discord/app-id',
      stringValue: process.env.DISCORD_APP_ID || 'REPLACE_ME',
      description: 'Discord Application ID for Diminishing Returns bot',
    });

    // 3. AWS Lambda Function (Node.js 22 ARM64) bundled with esbuild from @dr/bot
    const botEntryPath = path.resolve(__dirname, '../../bot/src/handler.ts');

    this.interactionFunction = new nodejs.NodejsFunction(this, 'DiscordInteractionHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      entry: botEntryPath,
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      description: 'Diminishing Returns (WoW: Forever) Discord HTTP Interactions Handler',
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        DR_TABLE_NAME: this.guildTable.tableName,
        DISCORD_PUBLIC_KEY_SSM_PARAM: discordPublicKeyParam.parameterName,
        DISCORD_BOT_TOKEN_SSM_PARAM: '/dr/discord/bot-token',
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node22',
        sourceMap: true,
        minify: true,
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // Grant Lambda read/write access to DynamoDB and read access to `/dr/discord/*` SSM parameters
    this.guildTable.grantReadWriteData(this.interactionFunction);
    discordPublicKeyParam.grantRead(this.interactionFunction);
    discordAppIdParam.grantRead(this.interactionFunction);

    this.interactionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/dr/discord/*`,
        ],
      })
    );

    // 4. Amazon API Gateway HTTP API (`POST /interactions`)
    this.httpApi = new apigwv2.HttpApi(this, 'DiminishingReturnsHttpApi', {
      apiName: 'DiminishingReturnsDiscordApi',
      description: 'Serverless Discord Interactions Webhook for Diminishing Returns (Alliance)',
    });

    this.httpApi.addRoutes({
      path: '/interactions',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        'DiscordInteractionsIntegration',
        this.interactionFunction
      ),
    });

    // 5. CloudFormation Outputs
    new cdk.CfnOutput(this, 'InteractionsEndpointUrl', {
      value: `${this.httpApi.apiEndpoint}/interactions`,
      description:
        'Paste this URL into the Discord Developer Portal -> General Information -> Interactions Endpoint URL',
    });

    new cdk.CfnOutput(this, 'DynamoTableName', {
      value: this.guildTable.tableName,
      description: 'DynamoDB single-table store for Diminishing Returns guild data',
    });

    new cdk.CfnOutput(this, 'DiscordPublicKeyParameterName', {
      value: discordPublicKeyParam.parameterName,
      description: 'SSM Parameter storing the Discord Ed25519 Public Key',
    });
  }
}
