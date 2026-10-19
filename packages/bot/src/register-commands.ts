import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { SLASH_COMMANDS } from './commands.js';

async function loadDiscordConfig(): Promise<{
  appId: string;
  botToken: string;
  guildId?: string;
}> {
  let appId = process.env.DISCORD_APP_ID ?? '';
  let botToken = process.env.DISCORD_BOT_TOKEN ?? '';
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!appId || !botToken) {
    try {
      const ssm = new SSMClient({});
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
