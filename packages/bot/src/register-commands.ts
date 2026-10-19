import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { SLASH_COMMANDS } from './commands.js';

function loadDotEnvIfNeeded(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

async function loadDiscordConfig(): Promise<{
  appId: string;
  botToken: string;
  guildId?: string;
}> {
  loadDotEnvIfNeeded();
  let appId = process.env.DISCORD_APP_ID ?? '';
  let botToken = process.env.DISCORD_BOT_TOKEN ?? '';
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!appId || !botToken) {
    try {
      const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
      const res = await ssm.send(
        new GetParametersCommand({
          Names: ['/dr/discord/app-id', '/dr/discord/bot-token'],
          WithDecryption: true,
        })
      );
      for (const param of res.Parameters ?? []) {
        if (param.Name === '/dr/discord/app-id' && !appId && param.Value !== 'REPLACE_ME') {
          appId = param.Value ?? '';
        }
        if (param.Name === '/dr/discord/bot-token' && !botToken && param.Value !== 'REPLACE_ME') {
          botToken = param.Value ?? '';
        }
      }
    } catch {
      // Fall back to environment check below
    }
  }

  if (!appId || !botToken) {
    throw new Error(
      'Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN. Set them in environment variables or in AWS SSM Parameter Store (/dr/discord/app-id and /dr/discord/bot-token).'
    );
  }

  return { appId, botToken, guildId };
}

async function main() {
  const { appId, botToken, guildId } = await loadDiscordConfig();

  const endpoint = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`;

  console.log(
    `Registering ${SLASH_COMMANDS.length} Diminishing Returns slash commands (${guildId ? `Guild: ${guildId}` : 'Global'})...`
  );

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(SLASH_COMMANDS),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Discord API returned ${response.status}: ${errText}`);
  }

  const registered = (await response.json()) as Array<{ name: string; id: string }>;
  console.log(`Successfully registered ${registered.length} commands:`);
  for (const cmd of registered) {
    console.log(`  - /${cmd.name} (ID: ${cmd.id})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
