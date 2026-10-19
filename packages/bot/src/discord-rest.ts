import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  CLASS_COLORS,
  GUILD_NAME,
  WOW_CLASSES,
  type WowClass,
} from '@dr/shared';
import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  type APIGuildMember,
  type APIRole,
  ButtonStyle,
  ComponentType,
} from 'discord-api-types/v10';
import { ALLIANCE_BLUE } from './embeds.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

let cachedBotToken: string | undefined;
const ssmClient = new SSMClient({});

export async function resolveDiscordBotToken(): Promise<string> {
  if (process.env.DISCORD_BOT_TOKEN) {
    return process.env.DISCORD_BOT_TOKEN;
  }
  if (cachedBotToken) {
    return cachedBotToken;
  }

  const paramName = process.env.DISCORD_BOT_TOKEN_SSM_PARAM ?? '/dr/discord/bot-token';
  const res = await ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    })
  );
  const val = res.Parameter?.Value?.trim() ?? '';
  if (val && val !== 'REPLACE_ME') {
    cachedBotToken = val;
  }
  return val;
}

async function discordRequest<T>(
  path: string,
  options: RequestInit = {},
  botToken?: string
): Promise<{ ok: boolean; status: number; data?: T; errorText?: string }> {
  const token = botToken ?? (await resolveDiscordBotToken());
  if (!token) {
    return { ok: false, status: 401, errorText: 'Missing Discord bot token' };
  }

  const res = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return { ok: true, status: 204 };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, errorText: text };
  }

  try {
    return { ok: true, status: res.status, data: JSON.parse(text) as T };
  } catch {
    return { ok: true, status: res.status };
  }
}

/**
 * Ensures all 9 WoW class roles exist on the Discord server with class colors and `hoist: true`
 * ("Display role members separately from online members") so members are grouped by class in the sidebar!
 */
export async function ensureGuildClassRoles(
  guildId: string,
  existingRoleMap?: Record<string, string>,
  botToken?: string
): Promise<{
  roleMap: Record<WowClass, string>;
  created: WowClass[];
  updated: WowClass[];
  errors: string[];
}> {
  const rolesRes = await discordRequest<APIRole[]>(`/guilds/${guildId}/roles`, { method: 'GET' }, botToken);
  if (!rolesRes.ok || !rolesRes.data) {
    return {
      roleMap: (existingRoleMap ?? {}) as Record<WowClass, string>,
      created: [],
      updated: [],
      errors: [`Failed to fetch guild roles (${rolesRes.status}): ${rolesRes.errorText}`],
    };
  }

  const existingByName = new Map<string, APIRole>();
  const existingById = new Map<string, APIRole>();
  for (const r of rolesRes.data) {
    existingByName.set(r.name.toLowerCase(), r);
    existingById.set(r.id, r);
  }

  const roleMap: Record<string, string> = { ...(existingRoleMap ?? {}) };
  const created: WowClass[] = [];
  const updated: WowClass[] = [];
  const errors: string[] = [];

  await Promise.all(
    WOW_CLASSES.map(async (wowClass) => {
      const color = CLASS_COLORS[wowClass];
      const mappedId = roleMap[wowClass];
      const foundRole =
        (mappedId ? existingById.get(mappedId) : undefined) ??
        existingByName.get(wowClass.toLowerCase());

      if (foundRole) {
        roleMap[wowClass] = foundRole.id;
        // If not hoisted or color doesn't match, patch it so sidebar grouping works
        if (!foundRole.hoist || foundRole.color !== color) {
          const patchRes = await discordRequest<APIRole>(
            `/guilds/${guildId}/roles/${foundRole.id}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                name: wowClass,
                color,
                hoist: true,
                mentionable: true,
              }),
            },
            botToken
          );
          if (patchRes.ok) {
            updated.push(wowClass);
          } else {
            errors.push(`Could not update role ${wowClass}: ${patchRes.errorText}`);
          }
        }
      } else {
        const createRes = await discordRequest<APIRole>(
          `/guilds/${guildId}/roles`,
          {
            method: 'POST',
            body: JSON.stringify({
              name: wowClass,
              color,
              hoist: true,
              mentionable: true,
            }),
          },
          botToken
        );
        if (createRes.ok && createRes.data) {
          roleMap[wowClass] = createRes.data.id;
          created.push(wowClass);
        } else {
          errors.push(`Could not create role ${wowClass}: ${createRes.errorText}`);
        }
      }
    })
  );

  return {
    roleMap: roleMap as Record<WowClass, string>,
    created,
    updated,
    errors,
  };
}

/**
 * Updates a Discord member's server nickname to match their Main character name
 * and assigns their Main character's WoW class role (removing any old WoW class roles).
 */
export async function syncMemberNicknameAndClassRole(params: {
  guildId: string;
  userId: string;
  characterName: string;
  wowClass: WowClass;
  classRoleIds: Record<string, string>;
  botToken?: string;
}): Promise<{
  nicknameSynced: boolean;
  roleSynced: boolean;
  notes: string[];
}> {
  const { guildId, userId, characterName, wowClass, classRoleIds, botToken } = params;
  const notes: string[] = [];

  // 1. Fetch current member to inspect existing roles
  const memberRes = await discordRequest<APIGuildMember>(
    `/guilds/${guildId}/members/${userId}`,
    { method: 'GET' },
    botToken
  );

  let currentRoles: string[] = [];
  if (memberRes.ok && memberRes.data) {
    currentRoles = memberRes.data.roles ?? [];
  }

  const allClassRoleIdSet = new Set(Object.values(classRoleIds).filter(Boolean));
  const targetRoleId = classRoleIds[wowClass];

  let nextRoles = currentRoles.filter((id) => !allClassRoleIdSet.has(id));
  if (targetRoleId) {
    nextRoles.push(targetRoleId);
  }

  // 2. Patch nickname + roles together first
  const patchBody: { nick: string; roles?: string[] } = {
    nick: characterName,
  };
  if (targetRoleId && memberRes.ok) {
    patchBody.roles = nextRoles;
  }

  const patchRes = await discordRequest(
    `/guilds/${guildId}/members/${userId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patchBody),
    },
    botToken
  );

  if (patchRes.ok) {
    return {
      nicknameSynced: true,
      roleSynced: Boolean(targetRoleId),
      notes,
    };
  }

  // Note: If the user is the Discord Server Owner, Discord returns 403 when a bot tries to change their `nick`.
  // In that case, still apply the class role via the member roles endpoint!
  notes.push(
    patchRes.status === 403
      ? 'Could not auto-change your server nickname (Discord blocks bots from changing the Server Owner’s nickname or a higher-role user).'
      : `Nickname sync returned status ${patchRes.status}.`
  );

  let roleSynced = false;
  if (targetRoleId) {
    // Remove other class roles if present, and add the target class role
    for (const [cls, rId] of Object.entries(classRoleIds)) {
      if (cls !== wowClass && currentRoles.includes(rId)) {
        await discordRequest(
          `/guilds/${guildId}/members/${userId}/roles/${rId}`,
          { method: 'DELETE' },
          botToken
        );
      }
    }
    const addRoleRes = await discordRequest(
      `/guilds/${guildId}/members/${userId}/roles/${targetRoleId}`,
      { method: 'PUT' },
      botToken
    );
    roleSynced = addRoleRes.ok;
    if (!addRoleRes.ok) {
      notes.push(
        'Could not assign your Class Role (ensure the Diminishing Returns bot has "Manage Roles" permission and its role is dragged above the Class Roles in Server Settings → Roles).'
      );
    }
  }

  return {
    nicknameSynced: false,
    roleSynced,
    notes,
  };
}

export function buildWelcomeOnboardingPayload(guildName = GUILD_NAME): {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
} {
  const embed: APIEmbed = {
    title: `🦁 Welcome to ${guildName} (Alliance — WoW: Forever)!`,
    description: [
      `Welcome to **${guildName}**! To keep our guild organized for **World of Warcraft: Forever**, every member's **Discord Server Nickname** matches their **Main Character Name**, and members are grouped in the sidebar by their **WoW Class**.`,
      '',
      '### How to Register:',
      '1️⃣ Click the **Register Main Character** button below (or type `/character register`).',
      '2️⃣ Enter your **Character Name**, **Alliance Race**, **Class**, and **Primary Role**.',
      '3️⃣ The bot will automatically set your Discord server nickname and place you into your **Class group**!',
    ].join('\n'),
    color: ALLIANCE_BLUE,
    footer: {
      text: `${guildName} • World of Warcraft: Forever`,
    },
  };

  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        custom_id: 'onboard_open_modal',
        label: 'Register Main Character',
        emoji: { name: '🦁' },
      },
    ],
  };

  return { embeds: [embed], components: [row] };
}

export async function listRecentGuildMembers(
  guildId: string,
  limit = 100,
  botToken?: string
): Promise<APIGuildMember[]> {
  const res = await discordRequest<APIGuildMember[]>(
    `/guilds/${guildId}/members?limit=${limit}`,
    { method: 'GET' },
    botToken
  );
  return res.ok && res.data ? res.data : [];
}

export async function sendWelcomeDmOrChannelPrompt(params: {
  guildId: string;
  userId: string;
  welcomeChannelId?: string;
  botToken?: string;
}): Promise<boolean> {
  const { userId, welcomeChannelId, botToken } = params;
  const payload = buildWelcomeOnboardingPayload();

  // 1. Try opening a DM channel with the new member
  const dmChanRes = await discordRequest<{ id: string }>(
    '/users/@me/channels',
    {
      method: 'POST',
      body: JSON.stringify({ recipient_id: userId }),
    },
    botToken
  );

  if (dmChanRes.ok && dmChanRes.data?.id) {
    const dmSend = await discordRequest(
      `/channels/${dmChanRes.data.id}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: `👋 Welcome to **${GUILD_NAME}**! Please register your **World of Warcraft: Forever** character using \`/character register\` in the server (or click the button on the welcome message) so we can set your nickname and Class Role!`,
          embeds: payload.embeds,
        }),
      },
      botToken
    );
    if (dmSend.ok) {
      return true;
    }
  }

  // 2. Fallback: post a welcome ping in the configured welcome channel
  if (welcomeChannelId) {
    const chanSend = await discordRequest(
      `/channels/${welcomeChannelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: `👋 Welcome <@${userId}> to **${GUILD_NAME}**! Click the button below (or run \`/character register\`) to register your character, set your server nickname, and join your Class group!`,
          ...payload,
        }),
      },
      botToken
    );
    return chanSend.ok;
  }

  return false;
}
