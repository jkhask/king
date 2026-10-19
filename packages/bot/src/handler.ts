import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoGuildRepository, type GuildRepository } from '@dr/db';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { APIInteraction } from 'discord-api-types/v10';
import { listRecentGuildMembers, sendWelcomeDmOrChannelPrompt } from './discord-rest.js';
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
 * Checks configured guilds for newly joined members who do not have a registered character yet
 * and have not been sent an onboarding welcome DM/message.
 */
export async function processNewMemberOnboarding(repo: GuildRepository): Promise<{
  guildsChecked: number;
  membersWelcomed: number;
}> {
  const configs = await repo.listConfiguredGuilds();
  let membersWelcomed = 0;

  for (const config of configs) {
    const members = await listRecentGuildMembers(config.guildId, 100);
    if (members.length === 0) continue;

    const registeredChars = await repo.listGuildCharacters(config.guildId);
    const registeredUserIds = new Set(registeredChars.map((c) => c.userId));
    const welcomedSet = new Set(config.welcomedUserIds ?? []);
    let updatedWelcomed = false;

    for (const member of members) {
      const u = member.user;
      if (!u || u.bot) continue;

      if (registeredUserIds.has(u.id)) {
        if (!welcomedSet.has(u.id)) {
          welcomedSet.add(u.id);
          updatedWelcomed = true;
        }
        continue;
      }

      if (!welcomedSet.has(u.id)) {
        const sent = await sendWelcomeDmOrChannelPrompt({
          guildId: config.guildId,
          userId: u.id,
          welcomeChannelId: config.welcomeChannelId,
        });
        if (sent) {
          membersWelcomed++;
        }
        welcomedSet.add(u.id);
        updatedWelcomed = true;
      }
    }

    if (updatedWelcomed) {
      await repo.upsertGuildConfig({
        ...config,
        welcomedUserIds: Array.from(welcomedSet),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return {
    guildsChecked: configs.length,
    membersWelcomed,
  };
}

/**
 * AWS Lambda entry point for:
 * 1. Amazon API Gateway HTTP API (`POST /interactions`)
 * 2. Amazon EventBridge Scheduled Rule (`source === 'aws.events'`) for new-member onboarding DMs
 */
export async function handler(
  event: APIGatewayProxyEventV2 | { source?: string; 'detail-type'?: string },
  options?: { repo?: GuildRepository; publicKeyHex?: string; skipSignatureCheck?: boolean }
): Promise<APIGatewayProxyStructuredResultV2> {
  const repo = options?.repo ?? getRepository();

  // Check if invoked by EventBridge scheduled rule for new member onboarding
  if ('source' in event && event.source === 'aws.events') {
    const result = await processNewMemberOnboarding(repo);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    };
  }

  const httpEvent = event as APIGatewayProxyEventV2;
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
