import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoGuildRepository, type GuildRepository } from '@dr/db';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { APIInteraction } from 'discord-api-types/v10';
import { handleDiscordInteraction } from './router.js';
import { verifyDiscordSignature } from './verify.js';

let cachedPublicKey: string | undefined;
let defaultRepo: GuildRepository | undefined;
const ssmClient = new SSMClient({});

async function resolveDiscordPublicKey(): Promise<string> {
  if (process.env.DISCORD_PUBLIC_KEY) {
    return process.env.DISCORD_PUBLIC_KEY;
  }
  if (cachedPublicKey) {
    return cachedPublicKey;
  }

  const paramName = process.env.DISCORD_PUBLIC_KEY_SSM_PARAM ?? '/dr/discord/public-key';
  const res = await ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    })
  );
  const val = res.Parameter?.Value?.trim() ?? '';
  if (val && val !== 'REPLACE_ME') {
    cachedPublicKey = val;
  }
  return val;
}

function getRepository(): GuildRepository {
  if (!defaultRepo) {
    defaultRepo = new DynamoGuildRepository();
  }
  return defaultRepo;
}

/**
 * AWS Lambda entry point for Amazon API Gateway HTTP API (`POST /interactions`)
 */
export async function handler(
  httpEvent: APIGatewayProxyEventV2,
  options?: { repo?: GuildRepository; publicKeyHex?: string; skipSignatureCheck?: boolean }
): Promise<APIGatewayProxyStructuredResultV2> {
  const repo = options?.repo ?? getRepository();

  const rawBody = httpEvent.body
    ? httpEvent.isBase64Encoded
      ? Buffer.from(httpEvent.body, 'base64').toString('utf8')
      : httpEvent.body
    : '';

  if (!options?.skipSignatureCheck) {
    const signatureHex =
      httpEvent.headers?.['x-signature-ed25519'] ??
      httpEvent.headers?.['X-Signature-Ed25519'] ??
      '';
    const timestamp =
      httpEvent.headers?.['x-signature-timestamp'] ??
      httpEvent.headers?.['X-Signature-Timestamp'] ??
      '';
    const publicKeyHex = options?.publicKeyHex ?? (await resolveDiscordPublicKey());

    const isValid = await verifyDiscordSignature({
      publicKeyHex,
      signatureHex,
      timestamp,
      rawBody,
    });

    if (!isValid) {
      return {
        statusCode: 401,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid request signature' }),
      };
    }
  }

  let interaction: APIInteraction;
  try {
    interaction = JSON.parse(rawBody) as APIInteraction;
  } catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Malformed JSON payload' }),
    };
  }

  const response = await handleDiscordInteraction(interaction, repo);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(response),
  };
}
