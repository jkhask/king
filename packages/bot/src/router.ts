import { randomBytes } from 'node:crypto';
import type {
  GuildRepository,
  ObtainedGearAward,
  SignupStatus,
} from '@dr/db';
import {
  CLASS_VIABLE_ROLES,
  GUILD_NAME,
  isValidRoleForClass,
  normalizeCharacterName,
  parseGargulExport,
  type RaidRole,
  WOW_FOREVER_RAIDS,
  type WowClass,
} from '@dr/shared';
import {
  type APIChatInputApplicationCommandInteractionData,
  type APIInteraction,
  type APIInteractionDataOptionBase,
  type APIInteractionResponse,
  type APIMessageComponentInteractionData,
  type APIModalSubmission,
  ApplicationCommandOptionType,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  TextInputStyle,
} from 'discord-api-types/v10';
import { resolveMemberRoles } from './discord-rest.js';
import {
  ALLIANCE_BLUE,
  buildCandidateComparisonEmbed,
  buildRaidEventMessage,
  GREEN_UNCOMMON,
  PURPLE_EPIC,
} from './embeds.js';

function shortId(prefix: string): string {
  return `${prefix}-${randomBytes(3).toString('hex')}`;
}

function getSubcommandAndOptions(data: APIChatInputApplicationCommandInteractionData): {
  subcommand: string;
  options: Map<string, string | number | boolean>;
} {
  const options = new Map<string, string | number | boolean>();
  const firstOpt = data.options?.[0];
  if (firstOpt && firstOpt.type === ApplicationCommandOptionType.Subcommand) {
    for (const opt of firstOpt.options ?? []) {
      const typed = opt as APIInteractionDataOptionBase<ApplicationCommandOptionType, string | number | boolean>;
      if (typed.value !== undefined) {
        options.set(typed.name, typed.value);
      }
    }
    return { subcommand: firstOpt.name, options };
  }

  for (const opt of data.options ?? []) {
    const typed = opt as APIInteractionDataOptionBase<ApplicationCommandOptionType, string | number | boolean>;
    if (typed.value !== undefined) {
      options.set(typed.name, typed.value);
    }
  }
  return { subcommand: '', options };
}

function ephemeralMessage(content: string): APIInteractionResponse {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content,
      flags: MessageFlags.Ephemeral,
    },
  };
}

function extractMemberDisplayName(interaction: APIInteraction): string {
  const nick = interaction.member?.nick?.trim();
  const globalName = interaction.member?.user?.global_name?.trim() ?? interaction.user?.global_name?.trim();
  const username = interaction.member?.user?.username?.trim() ?? interaction.user?.username?.trim();
  const raw = nick || globalName || username || '';
  return normalizeCharacterName(raw) || raw;
}

function defaultClassForRole(role: RaidRole): WowClass {
  switch (role) {
    case 'Tank':
      return 'Warrior';
    case 'Healer':
      return 'Priest';
    case 'Melee':
      return 'Warrior';
    case 'Ranged':
      return 'Mage';
  }
}

export async function handleDiscordInteraction(
  interaction: APIInteraction,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  if (interaction.type === InteractionType.Ping) {
    return { type: InteractionResponseType.Pong };
  }

  const guildId = interaction.guild_id ?? 'default-guild';
  const userId = interaction.member?.user.id ?? interaction.user?.id ?? 'unknown-user';
  const memberRoles = interaction.member?.roles ?? [];

  if (interaction.type === InteractionType.ApplicationCommand) {
    const data = interaction.data as APIChatInputApplicationCommandInteractionData;
    const { subcommand, options } = getSubcommandAndOptions(data);

    switch (data.name) {
      case 'raid':
        return handleRaidCommand(
          guildId,
          userId,
          memberRoles,
          interaction.channel?.id,
          subcommand,
          options,
          repo
        );
      case 'loot':
        return handleLootCommand(guildId, subcommand, options, repo);
      default:
        return ephemeralMessage(`Unknown command: \`/${data.name}\``);
    }
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const data = interaction.data as APIMessageComponentInteractionData;
    return handleMessageComponent(interaction, guildId, userId, memberRoles, data.custom_id, repo);
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    const data = interaction.data as APIModalSubmission;
    return handleModalSubmit(guildId, userId, data, repo);
  }

  return ephemeralMessage('Unsupported interaction type.');
}

async function handleRaidCommand(
  guildId: string,
  userId: string,
  memberRoles: string[],
  channelId: string | undefined,
  subcommand: string,
  options: Map<string, string | number | boolean>,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  const { hasCouncilRole } = await resolveMemberRoles(guildId, memberRoles);
  if (!hasCouncilRole) {
    return ephemeralMessage('❌ Only members with the **Council** role can use `/raid` commands.');
  }

  if (subcommand === 'create') {
    const templateId = String(options.get('template') ?? 'hyjal-summit');
    const template = WOW_FOREVER_RAIDS[templateId] ?? WOW_FOREVER_RAIDS['hyjal-summit'];
    const scheduledAt = String(options.get('schedule') ?? 'TBD');
    const customTitle = options.get('title') ? String(options.get('title')) : undefined;
    const notes = options.get('notes') ? String(options.get('notes')) : undefined;

    const raidId = shortId('raid');
    const raid = await repo.createRaidEvent({
      guildId,
      raidId,
      templateId: template.id,
      name: customTitle ?? template.name,
      size: template.size,
      scheduledAt,
      description: notes ?? template.description,
      createdByUserId: userId,
      channelId,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    });

    const payload = buildRaidEventMessage(raid, []);
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: payload,
    };
  }

  if (subcommand === 'view') {
    const requestedId = options.get('raid_id') ? String(options.get('raid_id')) : undefined;
    let raid = requestedId ? await repo.getRaidEvent(guildId, requestedId) : null;
    if (!raid) {
      const recent = await repo.listRaidEvents(guildId, 1);
      raid = recent[0] ?? null;
    }

    if (!raid) {
      return ephemeralMessage('No raids have been scheduled yet. Create one with `/raid create`!');
    }

    const signups = await repo.listRaidSignups(guildId, raid.raidId);
    const payload = buildRaidEventMessage(raid, signups);
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: payload,
    };
  }

  if (subcommand === 'list') {
    const raids = await repo.listRaidEvents(guildId, 10);
    if (raids.length === 0) {
      return ephemeralMessage('No scheduled raids found.');
    }

    const lines = await Promise.all(
      raids.map(async (r) => {
        const signups = await repo.listRaidSignups(guildId, r.raidId);
        const confirmed = signups.filter((s) => s.status === 'CONFIRMED').length;
        return `• \`${r.raidId}\` — **[${r.size}m] ${r.name}** • 📅 ${r.scheduledAt} (**${confirmed}/${r.size}** signed up • \`${r.status}\`)`;
      })
    );

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `🗓️ ${GUILD_NAME} — Raid Schedule`,
            description: lines.join('\n'),
            color: ALLIANCE_BLUE,
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown `/raid` subcommand.');
}

async function handleLootCommand(
  guildId: string,
  subcommand: string,
  options: Map<string, string | number | boolean>,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  if (subcommand === 'import-gargul') {
    return {
      type: InteractionResponseType.Modal,
      data: {
        custom_id: 'modal_gargul_import',
        title: 'Import Gargul Raid Loot History',
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.TextInput,
                custom_id: 'gargul_raid_instance',
                label: 'Default Raid Instance (Optional)',
                style: TextInputStyle.Short,
                placeholder: 'e.g. Hyjal Summit, Barrow Deeps, Onyxia’s Lair',
                required: false,
              },
            ],
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.TextInput,
                custom_id: 'gargul_export_payload',
                label: 'Paste Gargul CSV / TSV / JSON Export',
                style: TextInputStyle.Paragraph,
                placeholder: 'dateTime,player,itemID,itemName,offspec\n2026-12-10,Bolvar,18803,[Finkle\'s Lava Dredger],0',
                required: true,
              },
            ],
          },
        ],
      },
    };
  }

  if (subcommand === 'history') {
    const rawChar = options.get('character') ? String(options.get('character')) : undefined;
    if (rawChar) {
      const charName = normalizeCharacterName(rawChar);
      const summaries = await repo.getCandidateLootSummaries(guildId, [charName]);
      const embed = buildCandidateComparisonEmbed(
        `📦 Obtained Gear History — ${charName}`,
        `Historical loot recorded for **${charName}** in ${GUILD_NAME}.`,
        summaries
      );
      return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { embeds: [embed] },
      };
    }

    const recentAwards = await repo.listGuildLootHistory(guildId, 20);
    const lines =
      recentAwards.length > 0
        ? recentAwards.map(
            (a) =>
              `• \`${a.awardedAt.slice(0, 10)}\` — **${a.characterName}** received **[${a.itemName}]** (${a.specType}${a.raidInstance ? ` • ${a.raidInstance}` : ''})`
          )
        : ['_No loot history recorded yet. Use `/loot import-gargul` to log drops._'];

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `🏆 ${GUILD_NAME} — Recent Guild Loot History`,
            description: lines.join('\n'),
            color: PURPLE_EPIC,
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown `/loot` subcommand.');
}

async function handleMessageComponent(
  interaction: APIInteraction,
  guildId: string,
  userId: string,
  memberRoles: string[],
  customId: string,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  const [action, entityId, value] = customId.split(':');

  if (action === 'raid_signup' && entityId && value) {
    const raid = await repo.getRaidEvent(guildId, entityId);
    if (!raid) {
      return ephemeralMessage('❌ This raid event no longer exists.');
    }

    const existingSignups = await repo.listRaidSignups(guildId, raid.raidId);
    const existingUserSignup = existingSignups.find((s) => s.userId === userId);
    const userChars = await repo.listUserCharacters(guildId, userId);
    const storedChar = userChars[0];

    const { wowClass: roleDetectedClass } = await resolveMemberRoles(guildId, memberRoles);

    const displayName = extractMemberDisplayName(interaction);
    const characterName = displayName || storedChar?.name || existingUserSignup?.characterName || 'Raider';

    let status: SignupStatus = 'CONFIRMED';
    let requestedRole: RaidRole | undefined;

    if (value === 'BENCH') status = 'BENCH';
    else if (value === 'TENTATIVE') status = 'TENTATIVE';
    else if (value === 'ABSENT') status = 'ABSENT';
    else if (['Tank', 'Healer', 'Melee', 'Ranged'].includes(value)) {
      requestedRole = value as RaidRole;
    }

    const wowClass: WowClass =
      roleDetectedClass ??
      storedChar?.wowClass ??
      existingUserSignup?.wowClass ??
      defaultClassForRole(requestedRole ?? 'Melee');

    if (requestedRole && roleDetectedClass && !isValidRoleForClass(roleDetectedClass, requestedRole)) {
      const validRoles = CLASS_VIABLE_ROLES[roleDetectedClass]?.join(', ') ?? 'None';
      return ephemeralMessage(
        `❌ Your class role (**${roleDetectedClass}**) cannot sign up as **${requestedRole}**.\nViable roles for **${roleDetectedClass}**: ${validRoles}`
      );
    }

    const role: RaidRole =
      requestedRole ??
      existingUserSignup?.role ??
      storedChar?.primaryRole ??
      CLASS_VIABLE_ROLES[wowClass][0] ??
      'Melee';

    await repo.upsertRaidSignup({
      guildId,
      raidId: raid.raidId,
      userId,
      characterName,
      wowClass,
      role,
      status,
      updatedAt: new Date().toISOString(),
    });

    const signups = await repo.listRaidSignups(guildId, raid.raidId);
    const updatedMessage = buildRaidEventMessage(raid, signups);

    return {
      type: InteractionResponseType.UpdateMessage,
      data: updatedMessage,
    };
  }

  return ephemeralMessage('Unknown button interaction.');
}

async function handleModalSubmit(
  guildId: string,
  userId: string,
  data: APIModalSubmission,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  if (data.custom_id === 'modal_gargul_import') {
    let defaultRaidInstance = '';
    let rawExport = '';

    for (const row of data.components) {
      for (const comp of row.components) {
        if (comp.custom_id === 'gargul_raid_instance') {
          defaultRaidInstance = comp.value?.trim() ?? '';
        } else if (comp.custom_id === 'gargul_export_payload') {
          rawExport = comp.value ?? '';
        }
      }
    }

    const parsed = parseGargulExport(rawExport, defaultRaidInstance || undefined);
    if (parsed.errors.length > 0 && parsed.awards.length === 0) {
      return ephemeralMessage(`❌ Failed to parse Gargul export:\n${parsed.errors.join('\n')}`);
    }

    const dbAwards: ObtainedGearAward[] = parsed.awards.map((a) => ({
      guildId,
      awardHash: a.awardHash,
      characterName: a.characterName,
      itemName: a.itemName,
      itemId: a.itemId,
      specType: a.specType,
      raidInstance: a.raidInstance,
      boss: a.boss,
      awardedByUserId: userId,
      awardedAt: a.awardedAt,
    }));

    const { inserted, skippedDuplicates } = await repo.recordLootAwards(dbAwards);

    const previewLines = parsed.awards
      .slice(0, 12)
      .map(
        (a) =>
          `• **${a.characterName}** ← **[${a.itemName}]** (${a.specType}${a.raidInstance ? ` • ${a.raidInstance}` : ''})`
      );
    if (parsed.awards.length > 12) {
      previewLines.push(`_...and ${parsed.awards.length - 12} more items._`);
    }

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: '📥 Gargul Loot History Imported',
            description: [
              `✅ **New Awards Recorded:** **${inserted}**`,
              `⏭️ **Duplicates Skipped:** ${skippedDuplicates}`,
              parsed.skippedLines > 0 ? `⚠️ **Unrecognized Lines Skipped:** ${parsed.skippedLines}` : '',
              '',
              '**Imported Drops:**',
              ...previewLines,
            ]
              .filter(Boolean)
              .join('\n'),
            color: GREEN_UNCOMMON,
            footer: {
              text: 'Obtained gear is now available in /loot history and the guild database',
            },
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown modal submission.');
}


