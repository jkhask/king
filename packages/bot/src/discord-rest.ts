import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { WOW_CLASSES, type WowClass } from '@dr/shared';
import type { APIRole } from 'discord-api-types/v10';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const ROLE_CACHE_TTL_MS = 60_000;

let cachedBotToken: string | undefined;
const guildRolesCache = new Map<string, { roles: APIRole[]; expiresAt: number }>();
const ssmClient = new SSMClient({});

export async function resolveDiscordBotToken(): Promise<string> {
  if (process.env.DISCORD_BOT_TOKEN) {
    return process.env.DISCORD_BOT_TOKEN;
  }
  if (cachedBotToken) {
    return cachedBotToken;
  }

  const paramName = process.env.DISCORD_BOT_TOKEN_SSM_PARAM ?? '/dr/discord/bot-token';
  try {
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
  } catch {
    return '';
  }
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

export async function getGuildRoles(guildId: string, botToken?: string): Promise<APIRole[]> {
  const now = Date.now();
  const cached = guildRolesCache.get(guildId);
  if (cached && cached.expiresAt > now) {
    return cached.roles;
  }

  const res = await discordRequest<APIRole[]>(`/guilds/${guildId}/roles`, { method: 'GET' }, botToken);
  if (res.ok && res.data) {
    guildRolesCache.set(guildId, { roles: res.data, expiresAt: now + ROLE_CACHE_TTL_MS });
    return res.data;
  }
  return cached?.roles ?? [];
}

function matchClassFromRoleName(roleName: string): WowClass | undefined {
  const lower = roleName.trim().toLowerCase();
  for (const wowClass of WOW_CLASSES) {
    if (lower === wowClass.toLowerCase()) {
      return wowClass;
    }
  }
  for (const wowClass of WOW_CLASSES) {
    if (lower.includes(wowClass.toLowerCase())) {
      return wowClass;
    }
  }
  return undefined;
}

/**
 * Resolves a member's Discord role IDs (or role names) to determine:
 * - Whether they have the "Council" role (required for `/raid` commands)
 * - Their WoW Class role (assigned by Carl-bot) for raid signups
 */
export async function resolveMemberRoles(
  guildId: string,
  memberRoles: string[],
  botToken?: string
): Promise<{
  hasCouncilRole: boolean;
  wowClass?: WowClass;
  roleNames: string[];
}> {
  if (memberRoles.length === 0) {
    return { hasCouncilRole: false, roleNames: [] };
  }

  const roleNames: string[] = [];
  const unresolvedIds: string[] = [];

  for (const entry of memberRoles) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (/^\d{15,22}$/.test(trimmed)) {
      unresolvedIds.push(trimmed);
    } else {
      roleNames.push(trimmed);
    }
  }

  if (unresolvedIds.length > 0) {
    const guildRoles = await getGuildRoles(guildId, botToken);
    const byId = new Map(guildRoles.map((r) => [r.id, r.name]));
    for (const id of unresolvedIds) {
      const name = byId.get(id);
      if (name) {
        roleNames.push(name);
      }
    }
  }

  const hasCouncilRole = roleNames.some((name) => name.trim().toLowerCase() === 'council');
  let wowClass: WowClass | undefined;
  for (const name of roleNames) {
    const matched = matchClassFromRoleName(name);
    if (matched) {
      wowClass = matched;
      break;
    }
  }

  return {
    hasCouncilRole,
    wowClass,
    roleNames,
  };
}


