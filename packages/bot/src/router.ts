import { createHash, randomBytes } from 'node:crypto';
import type {
  GuildBankItem,
  GuildRepository,
  GuildRequestTicket,
  ObtainedGearAward,
  SignupStatus,
} from '@dr/db';
import {
  CLASS_ICONS,
  CLASS_VIABLE_ROLES,
  GUILD_NAME,
  isValidRaceClass,
  isValidRoleForClass,
  type LootSpecType,
  normalizeCharacterName,
  type Profession,
  parseGargulExport,
  parseWowItemToken,
  type RaidRole,
  ROLE_ICONS,
  VALID_RACE_CLASSES,
  WOW_FOREVER_RAIDS,
  type WowClass,
  type WowRace,
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
import {
  buildWelcomeOnboardingPayload,
  ensureGuildClassRoles,
  syncMemberNicknameAndClassRole,
} from './discord-rest.js';
import {
  ALLIANCE_BLUE,
  buildCandidateComparisonEmbed,
  buildLootCouncilRecommendationEmbed,
  buildRaidEventMessage,
  buildRequestTicketMessage,
  buildRosterSummaryEmbed,
  GOLD_COLOR,
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

export async function handleDiscordInteraction(
  interaction: APIInteraction,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  if (interaction.type === InteractionType.Ping) {
    return { type: InteractionResponseType.Pong };
  }

  const guildId = interaction.guild_id ?? 'default-guild';
  const userId = interaction.member?.user.id ?? interaction.user?.id ?? 'unknown-user';

  if (interaction.type === InteractionType.ApplicationCommand) {
    const data = interaction.data as APIChatInputApplicationCommandInteractionData;
    const { subcommand, options } = getSubcommandAndOptions(data);

    switch (data.name) {
      case 'character':
        return handleCharacterCommand(guildId, userId, subcommand, options, repo);
      case 'roster':
        return handleRosterCommand(guildId, subcommand, options, repo);
      case 'raid':
        return handleRaidCommand(guildId, userId, interaction.channel?.id, subcommand, options, repo);
      case 'loot':
        return handleLootCommand(guildId, userId, subcommand, options, repo);
      case 'bank':
        return handleBankCommand(guildId, userId, subcommand, options, repo);
      case 'request':
        return handleRequestCommand(guildId, userId, subcommand, options, repo);
      case 'setup':
        return handleSetupCommand(guildId, interaction.channel?.id, subcommand, repo);
      default:
        return ephemeralMessage(`Unknown command: \`/${data.name}\``);
    }
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const data = interaction.data as APIMessageComponentInteractionData;
    return handleMessageComponent(guildId, userId, data.custom_id, repo);
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    const data = interaction.data as APIModalSubmission;
    return handleModalSubmit(guildId, userId, data, repo);
  }

  return ephemeralMessage('Unsupported interaction type.');
}

async function handleCharacterCommand(
  guildId: string,
  userId: string,
  subcommand: string,
  options: Map<string, string | number | boolean>,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  if (subcommand === 'register') {
    const rawName = String(options.get('name') ?? '');
    const name = normalizeCharacterName(rawName);
    const race = String(options.get('race') ?? '') as WowRace;
    const wowClass = String(options.get('class') ?? '') as WowClass;
    const primaryRole = String(options.get('role') ?? '') as RaidRole;
    const offspecRole = options.get('offspec') ? (String(options.get('offspec')) as RaidRole) : undefined;
    const isMain = options.get('main') !== undefined ? Boolean(options.get('main')) : true;

    if (!name || name.length < 2 || name.length > 16) {
      return ephemeralMessage('❌ Character name must be between 2 and 16 characters.');
    }

    if (!isValidRaceClass(race, wowClass)) {
      const validClasses = VALID_RACE_CLASSES[race]?.join(', ') ?? 'None';
      return ephemeralMessage(
        `❌ **${race} ${wowClass}** is not a valid race/class combination in *World of Warcraft: Forever*.\nValid classes for **${race}**: ${validClasses}`
      );
    }

    if (!isValidRoleForClass(wowClass, primaryRole)) {
      const validRoles = CLASS_VIABLE_ROLES[wowClass]?.join(', ') ?? 'None';
      return ephemeralMessage(
        `❌ **${wowClass}** cannot register with primary role **${primaryRole}**.\nViable roles for **${wowClass}**: ${validRoles}`
      );
    }

    if (offspecRole && !isValidRoleForClass(wowClass, offspecRole)) {
      const validRoles = CLASS_VIABLE_ROLES[wowClass]?.join(', ') ?? 'None';
      return ephemeralMessage(
        `❌ **${wowClass}** cannot use off-spec role **${offspecRole}**.\nViable roles for **${wowClass}**: ${validRoles}`
      );
    }

    const professions: Profession[] = [];
    const p1 = options.get('profession1') as Profession | undefined;
    const p2 = options.get('profession2') as Profession | undefined;
    if (p1) professions.push(p1);
    if (p2 && p2 !== p1) professions.push(p2);

    const rawRecipes = options.get('recipes') ? String(options.get('recipes')) : '';
    const notableRecipes = rawRecipes
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    const now = new Date().toISOString();
    const saved = await repo.upsertCharacter({
      guildId,
      userId,
      name,
      race,
      wowClass,
      primaryRole,
      offspecRole,
      isMain,
      professions,
      notableRecipes,
      createdAt: now,
      updatedAt: now,
    });

    const syncNotes = saved.isMain
      ? await syncGuildMemberToMain(guildId, userId, saved.name, saved.wowClass, repo)
      : [];

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `🦁 Character Registered — ${saved.name}`,
            description: [
              `**Faction:** Alliance (${GUILD_NAME})`,
              `**Race & Class:** ${saved.race} ${CLASS_ICONS[saved.wowClass]} **${saved.wowClass}**`,
              `**Designation:** ${saved.isMain ? '⭐ **Main**' : '🔹 **Alt**'}`,
              `**Role:** ${ROLE_ICONS[saved.primaryRole]} **${saved.primaryRole}**${saved.offspecRole ? ` (Off-Spec: ${ROLE_ICONS[saved.offspecRole]} ${saved.offspecRole})` : ''}`,
              saved.professions.length > 0 ? `**Professions:** ${saved.professions.join(', ')}` : '',
              saved.notableRecipes.length > 0 ? `**Notable Recipes:** ${saved.notableRecipes.join(', ')}` : '',
              ...syncNotes,
            ]
              .filter(Boolean)
              .join('\n'),
            color: ALLIANCE_BLUE,
          },
        ],
      },
    };
  }

  if (subcommand === 'list') {
    const targetUserId = options.get('user') ? String(options.get('user')) : userId;
    const chars = await repo.listUserCharacters(guildId, targetUserId);
    if (chars.length === 0) {
      return ephemeralMessage(
        targetUserId === userId
          ? 'You have no registered characters yet. Run `/character register` to add your Main!'
          : `<@${targetUserId}> has no registered characters yet.`
      );
    }

    const lines = chars.map((c) => {
      const profText = c.professions.length > 0 ? ` • 🛠️ ${c.professions.join('/')}` : '';
      return `${c.isMain ? '⭐ **[MAIN]**' : '🔹 **[ALT]**'} ${CLASS_ICONS[c.wowClass]} **${c.name}** — ${c.race} ${c.wowClass} (${ROLE_ICONS[c.primaryRole]} ${c.primaryRole}${c.offspecRole ? ` / ${c.offspecRole}` : ''})${profText}`;
    });

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `📜 Registered Characters (${chars.length})`,
            description: `Member: <@${targetUserId}>\n\n${lines.join('\n')}`,
            color: ALLIANCE_BLUE,
          },
        ],
      },
    };
  }

  if (subcommand === 'delete') {
    const name = normalizeCharacterName(String(options.get('name') ?? ''));
    const deleted = await repo.deleteCharacter(guildId, userId, name);
    if (!deleted) {
      return ephemeralMessage(`❌ Could not find character **${name}** owned by you.`);
    }
    return ephemeralMessage(`✅ Removed character **${name}** from the guild roster.`);
  }

  return ephemeralMessage('Unknown `/character` subcommand.');
}

async function handleRosterCommand(
  guildId: string,
  subcommand: string,
  options: Map<string, string | number | boolean>,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  const characters = await repo.listGuildCharacters(guildId);

  if (subcommand === 'summary') {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [buildRosterSummaryEmbed(characters)],
      },
    };
  }

  if (subcommand === 'crafters') {
    const profFilter = options.get('profession') ? String(options.get('profession')) : undefined;
    const recipeFilter = options.get('recipe') ? String(options.get('recipe')).toLowerCase() : undefined;

    const matching = characters.filter((c) => {
      if (c.professions.length === 0 && c.notableRecipes.length === 0) return false;
      if (profFilter && !c.professions.includes(profFilter as Profession)) return false;
      if (
        recipeFilter &&
        !c.notableRecipes.some((r) => r.toLowerCase().includes(recipeFilter)) &&
        !c.professions.some((p) => p.toLowerCase().includes(recipeFilter))
      ) {
        return false;
      }
      return true;
    });

    const lines =
      matching.length > 0
        ? matching.map(
            (c) =>
              `${CLASS_ICONS[c.wowClass]} **${c.name}** (<@${c.userId}>) — **${c.professions.join(', ') || 'Crafter'}**${c.notableRecipes.length > 0 ? `\n  ↳ *Recipes:* ${c.notableRecipes.join(', ')}` : ''}`
          )
        : ['_No matching guild crafters found._'];

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `⚒️ ${GUILD_NAME} — Guild Crafter Directory`,
            description: lines.join('\n'),
            color: GOLD_COLOR,
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown `/roster` subcommand.');
}

async function handleRaidCommand(
  guildId: string,
  userId: string,
  channelId: string | undefined,
  subcommand: string,
  options: Map<string, string | number | boolean>,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
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
  userId: string,
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
        : ['_No loot history recorded yet. Use `/loot import-gargul` or `/loot award` to log drops._'];

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

  if (subcommand === 'compare') {
    const rawList = String(options.get('characters') ?? '');
    const names = rawList
      .split(',')
      .map((n) => normalizeCharacterName(n))
      .filter(Boolean)
      .slice(0, 10);

    if (names.length === 0) {
      return ephemeralMessage('Please provide at least one character name to compare.');
    }

    const summaries = await repo.getCandidateLootSummaries(guildId, names);
    const embed = buildCandidateComparisonEmbed(
      `⚖️ Loot Council Candidate Comparison (${summaries.length})`,
      'Comparing obtained gear in the database to assist Loot Council deliberation:',
      summaries
    );

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { embeds: [embed] },
    };
  }

  if (subcommand === 'council') {
    const rawItem = String(options.get('item') ?? '');
    const { itemId, itemName } = parseWowItemToken(rawItem);
    const rawCandidates = options.get('candidates') ? String(options.get('candidates')) : '';
    const roleFilter = options.get('role') ? (String(options.get('role')) as RaidRole) : undefined;
    const raidOption = options.get('raid') ? String(options.get('raid')).trim() : undefined;

    let raidContext = raidOption;
    let candidateNames: string[] = [];

    if (rawCandidates.trim()) {
      candidateNames = rawCandidates
        .split(/[,;]+/)
        .map((n) => normalizeCharacterName(n))
        .filter(Boolean);
    } else {
      // Check if there is a matching or recent raid with confirmed/bench signups
      let targetRaid = raidOption ? await repo.getRaidEvent(guildId, raidOption) : null;
      if (!targetRaid) {
        const recentRaids = await repo.listRaidEvents(guildId, 10);
        if (raidOption) {
          targetRaid =
            recentRaids.find((r) => r.name.toLowerCase().includes(raidOption.toLowerCase())) ??
            recentRaids[0] ??
            null;
        } else {
          targetRaid = recentRaids[0] ?? null;
        }
      }

      if (targetRaid) {
        if (!raidContext) {
          raidContext = `${targetRaid.name} (${targetRaid.scheduledAt})`;
        }
        const signups = await repo.listRaidSignups(guildId, targetRaid.raidId);
        const attending = signups.filter((s) => {
          if (s.status !== 'CONFIRMED' && s.status !== 'BENCH') return false;
          if (roleFilter && s.role !== roleFilter) return false;
          return true;
        });
        candidateNames = attending.map((s) => s.characterName);
      }

      // Fall back to registered guild characters if no raid signups matched
      if (candidateNames.length === 0) {
        const guildChars = await repo.listGuildCharacters(guildId);
        const mains = guildChars.filter((c) => c.isMain);
        const pool = mains.length > 0 ? mains : guildChars;
        candidateNames = pool.map((c) => c.name);
      }

      // Fall back to recent loot history characters if no characters are registered yet
      if (candidateNames.length === 0) {
        const recentHistory = await repo.listGuildLootHistory(guildId, 50);
        const uniqueChars = new Set<string>();
        for (const award of recentHistory) {
          uniqueChars.add(award.characterName);
        }
        candidateNames = Array.from(uniqueChars);
      }
    }

    let summaries = await repo.getCandidateLootSummaries(guildId, candidateNames);

    if (roleFilter) {
      summaries = summaries.filter((s) => {
        if (!s.character) return true;
        return (
          s.character.primaryRole === roleFilter || s.character.offspecRole === roleFilter
        );
      });
    }

    const embed = buildLootCouncilRecommendationEmbed({
      itemName,
      itemId,
      raidContext,
      roleFilter,
      summaries,
    });

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { embeds: [embed] },
    };
  }

  if (subcommand === 'award') {
    const winnerName = normalizeCharacterName(String(options.get('character') ?? ''));
    const rawItem = String(options.get('item') ?? '').trim();
    const specType = (options.get('spec') ? String(options.get('spec')) : 'MS') as LootSpecType;
    const raidInstance = options.get('raid') ? String(options.get('raid')) : undefined;

    if (!winnerName) {
      return ephemeralMessage('❌ Please specify a valid winning character name.');
    }

    const { itemId, itemName } = parseWowItemToken(rawItem);
    const awardedAt = new Date().toISOString();
    const awardHash = createHash('sha256')
      .update(`${awardedAt.slice(0, 16)}|${winnerName.toLowerCase()}|${(itemId ?? itemName).toString().toLowerCase()}`)
      .digest('hex')
      .slice(0, 16);

    const award: ObtainedGearAward = {
      guildId,
      awardHash,
      characterName: winnerName,
      itemName,
      itemId,
      specType,
      raidInstance,
      awardedByUserId: userId,
      awardedAt,
    };

    await repo.recordLootAwards([award]);

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `🏆 Loot Awarded — ${itemName}`,
            description: `**${winnerName}** was awarded **[${itemName}]** (${specType})${raidInstance ? ` in **${raidInstance}**` : ''} by <@${userId}>.`,
            color: PURPLE_EPIC,
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown `/loot` subcommand.');
}

async function handleBankCommand(
  guildId: string,
  userId: string,
  subcommand: string,
  options: Map<string, string | number | boolean>,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  if (subcommand === 'set') {
    const itemName = String(options.get('item') ?? '').trim();
    const quantity = Number(options.get('quantity') ?? 0);
    const category = (options.get('category') ?? 'Consumable') as GuildBankItem['category'];

    const updated = await repo.upsertBankItem({
      guildId,
      category,
      itemName,
      quantity,
      updatedByUserId: userId,
      updatedAt: new Date().toISOString(),
    });

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: '🏦 Guild Bank Updated',
            description:
              updated.quantity > 0
                ? `Set **[${updated.itemName}]** (${updated.category}) quantity to **${updated.quantity}x**.`
                : `Removed **[${updated.itemName}]** from the Guild Bank inventory.`,
            color: GOLD_COLOR,
          },
        ],
      },
    };
  }

  if (subcommand === 'search') {
    const query = options.get('query') ? String(options.get('query')) : undefined;
    const items = await repo.listBankItems(guildId, query);
    const lines =
      items.length > 0
        ? items.map((i) => `• **[${i.category}]** **${i.itemName}** — \`${i.quantity}x\``)
        : ['_No matching items in the Guild Bank._'];

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `🏦 ${GUILD_NAME} — Guild Bank Inventory${query ? ` ("${query}")` : ''}`,
            description: lines.join('\n'),
            color: GOLD_COLOR,
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown `/bank` subcommand.');
}

async function handleRequestCommand(
  guildId: string,
  userId: string,
  subcommand: string,
  options: Map<string, string | number | boolean>,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  if (subcommand === 'create') {
    const requestType = String(options.get('type') ?? 'CRAFTING') as GuildRequestTicket['requestType'];
    const itemName = String(options.get('item') ?? '').trim();
    const quantity = Math.max(1, Number(options.get('quantity') ?? 1));
    const matsProvided = Boolean(options.get('mats_provided') ?? false);
    const notes = options.get('notes') ? String(options.get('notes')) : undefined;

    let characterName = options.get('character')
      ? normalizeCharacterName(String(options.get('character')))
      : '';

    if (!characterName) {
      const userChars = await repo.listUserCharacters(guildId, userId);
      characterName = userChars[0]?.name ?? 'Guild Member';
    }

    const now = new Date().toISOString();
    const ticket = await repo.createRequestTicket({
      guildId,
      requestId: shortId('req'),
      requesterUserId: userId,
      characterName,
      requestType,
      itemName,
      quantity,
      matsProvided,
      notes,
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    });

    const payload = buildRequestTicketMessage(ticket);
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: payload,
    };
  }

  if (subcommand === 'list') {
    const open = await repo.listOpenRequestTickets(guildId);
    const lines =
      open.length > 0
        ? open.map(
            (t) =>
              `• \`${t.requestId}\` [${t.status}] **${t.quantity}x ${t.itemName}** for **${t.characterName}** (${t.matsProvided ? 'Mats Ready' : 'Needs Mats'})`
          )
        : ['_No open guild crafting or consumable requests!_'];

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `🛠️ ${GUILD_NAME} — Open Guild Requests (${open.length})`,
            description: lines.join('\n'),
            color: GOLD_COLOR,
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown `/request` subcommand.');
}

async function handleMessageComponent(
  guildId: string,
  userId: string,
  customId: string,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  const [action, entityId, value] = customId.split(':');

  if (action === 'raid_signup' && entityId && value) {
    const raid = await repo.getRaidEvent(guildId, entityId);
    if (!raid) {
      return ephemeralMessage('❌ This raid event no longer exists.');
    }

    const userChars = await repo.listUserCharacters(guildId, userId);
    const mainChar = userChars[0];
    if (!mainChar) {
      return ephemeralMessage(
        '❌ You need to register a character first! Run `/character register` to set up your Alliance character.'
      );
    }

    let status: SignupStatus = 'CONFIRMED';
    let role: RaidRole = mainChar.primaryRole;

    if (value === 'BENCH') status = 'BENCH';
    else if (value === 'TENTATIVE') status = 'TENTATIVE';
    else if (value === 'ABSENT') status = 'ABSENT';
    else if (['Tank', 'Healer', 'Melee', 'Ranged'].includes(value)) {
      const requestedRole = value as RaidRole;
      if (!isValidRoleForClass(mainChar.wowClass, requestedRole)) {
        return ephemeralMessage(
          `❌ Your character **${mainChar.name}** (${mainChar.wowClass}) cannot sign up as **${requestedRole}**.`
        );
      }
      role = requestedRole;
    }

    await repo.upsertRaidSignup({
      guildId,
      raidId: raid.raidId,
      userId,
      characterName: mainChar.name,
      wowClass: mainChar.wowClass,
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

  if (action === 'req_action' && entityId && value) {
    const status = value as GuildRequestTicket['status'];
    const updated = await repo.updateRequestTicketStatus(guildId, entityId, status, userId);
    if (!updated) {
      return ephemeralMessage('❌ Request ticket not found.');
    }

    const updatedMessage = buildRequestTicketMessage(updated);
    return {
      type: InteractionResponseType.UpdateMessage,
      data: updatedMessage,
    };
  }

  if (customId === 'onboard_open_modal') {
    return {
      type: InteractionResponseType.Modal,
      data: {
        custom_id: 'modal_onboard_register',
        title: `Register Main Character (${GUILD_NAME})`,
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.TextInput,
                custom_id: 'onboard_char_name',
                label: 'Character Name (Sets your Server Nickname)',
                style: TextInputStyle.Short,
                placeholder: 'e.g. Bolvar',
                min_length: 2,
                max_length: 16,
                required: true,
              },
            ],
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.TextInput,
                custom_id: 'onboard_race',
                label: 'Alliance Race',
                style: TextInputStyle.Short,
                placeholder: 'Human, Dwarf, Night Elf, Gnome, or High Order Skyborne',
                required: true,
              },
            ],
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.TextInput,
                custom_id: 'onboard_class',
                label: 'WoW Class (Sets your Discord Class Group)',
                style: TextInputStyle.Short,
                placeholder: 'Warrior, Paladin, Hunter, Rogue, Priest, Shaman, Mage, Warlock, Druid',
                required: true,
              },
            ],
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.TextInput,
                custom_id: 'onboard_role',
                label: 'Primary Raid Role',
                style: TextInputStyle.Short,
                placeholder: 'Tank, Healer, Melee, or Ranged',
                required: true,
              },
            ],
          },
        ],
      },
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
  if (data.custom_id === 'modal_onboard_register') {
    let rawName = '';
    let rawRace = '';
    let rawClass = '';
    let rawRole = '';

    for (const row of data.components) {
      for (const comp of row.components) {
        if (comp.custom_id === 'onboard_char_name') rawName = comp.value ?? '';
        else if (comp.custom_id === 'onboard_race') rawRace = comp.value ?? '';
        else if (comp.custom_id === 'onboard_class') rawClass = comp.value ?? '';
        else if (comp.custom_id === 'onboard_role') rawRole = comp.value ?? '';
      }
    }

    const name = normalizeCharacterName(rawName);
    const race = matchAllianceRace(rawRace);
    const wowClass = matchWowClass(rawClass);
    const primaryRole = matchRaidRole(rawRole);

    if (!name || name.length < 2 || name.length > 16) {
      return ephemeralMessage('❌ Character name must be between 2 and 16 characters.');
    }
    if (!race) {
      return ephemeralMessage(
        '❌ Unrecognized Alliance race. Choose from: **Human, Dwarf, Night Elf, Gnome, High Order Skyborne**.'
      );
    }
    if (!wowClass) {
      return ephemeralMessage(
        '❌ Unrecognized class. Choose from: **Warrior, Paladin, Hunter, Rogue, Priest, Shaman, Mage, Warlock, Druid**.'
      );
    }
    if (!primaryRole) {
      return ephemeralMessage(
        '❌ Unrecognized role. Choose from: **Tank, Healer, Melee, Ranged**.'
      );
    }

    if (!isValidRaceClass(race, wowClass)) {
      const validClasses = VALID_RACE_CLASSES[race]?.join(', ') ?? 'None';
      return ephemeralMessage(
        `❌ **${race} ${wowClass}** is not a valid combination in *WoW: Forever*.\nValid classes for **${race}**: ${validClasses}`
      );
    }

    if (!isValidRoleForClass(wowClass, primaryRole)) {
      const validRoles = CLASS_VIABLE_ROLES[wowClass]?.join(', ') ?? 'None';
      return ephemeralMessage(
        `❌ **${wowClass}** cannot use primary role **${primaryRole}**.\nViable roles for **${wowClass}**: ${validRoles}`
      );
    }

    const now = new Date().toISOString();
    const saved = await repo.upsertCharacter({
      guildId,
      userId,
      name,
      race,
      wowClass,
      primaryRole,
      isMain: true,
      professions: [],
      notableRecipes: [],
      createdAt: now,
      updatedAt: now,
    });

    const syncNotes = await syncGuildMemberToMain(guildId, userId, saved.name, saved.wowClass, repo);

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: `🦁 Welcome ${saved.name} — Character Registered!`,
            description: [
              `Member: <@${userId}>`,
              `**Race & Class:** ${saved.race} ${CLASS_ICONS[saved.wowClass]} **${saved.wowClass}**`,
              `**Primary Role:** ${ROLE_ICONS[saved.primaryRole]} **${saved.primaryRole}**`,
              ...syncNotes,
            ]
              .filter(Boolean)
              .join('\n'),
            color: ALLIANCE_BLUE,
          },
        ],
      },
    };
  }

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
              text: 'Obtained gear is now available in /loot history, /loot compare, and /loot council',
            },
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown modal submission.');
}

async function handleSetupCommand(
  guildId: string,
  channelId: string | undefined,
  subcommand: string,
  repo: GuildRepository
): Promise<APIInteractionResponse> {
  if (subcommand === 'discord') {
    const existingConfig = await repo.getGuildConfig(guildId);
    const roleSetup = await ensureGuildClassRoles(guildId, existingConfig?.classRoleIds);

    await repo.upsertGuildConfig({
      guildId,
      welcomeChannelId: channelId ?? existingConfig?.welcomeChannelId,
      classRoleIds: roleSetup.roleMap,
      welcomedUserIds: existingConfig?.welcomedUserIds ?? [],
      updatedAt: new Date().toISOString(),
    });

    const welcomePayload = buildWelcomeOnboardingPayload();
    const setupSummaryEmbed = {
      title: '⚙️ Discord Server Configured for Diminishing Returns',
      description: [
        `✅ **Hoisted Class Roles Ready:** ${Object.keys(roleSetup.roleMap).length} / 9 classes (${roleSetup.created.length} created, ${roleSetup.updated.length} updated)`,
        channelId ? `✅ **Welcome & Onboarding Channel Set:** <#${channelId}>` : '',
        `💡 **Tip:** In Discord **Server Settings → Roles**, make sure the **Diminishing Returns** bot role is dragged **above** the 9 WoW Class Roles so it has permission to assign them and update member nicknames!`,
        roleSetup.errors.length > 0 ? `⚠️ **Notes:** ${roleSetup.errors.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      color: GOLD_COLOR,
    };

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [setupSummaryEmbed, ...welcomePayload.embeds],
        components: welcomePayload.components,
      },
    };
  }

  if (subcommand === 'sync-members') {
    const existingConfig = await repo.getGuildConfig(guildId);
    const roleSetup = await ensureGuildClassRoles(guildId, existingConfig?.classRoleIds);

    await repo.upsertGuildConfig({
      guildId,
      welcomeChannelId: existingConfig?.welcomeChannelId,
      classRoleIds: roleSetup.roleMap,
      welcomedUserIds: existingConfig?.welcomedUserIds ?? [],
      updatedAt: new Date().toISOString(),
    });

    const allChars = await repo.listGuildCharacters(guildId);
    const mains = allChars.filter((c) => c.isMain);

    let nickCount = 0;
    let roleCount = 0;
    for (const main of mains) {
      const res = await syncMemberNicknameAndClassRole({
        guildId,
        userId: main.userId,
        characterName: main.name,
        wowClass: main.wowClass,
        classRoleIds: roleSetup.roleMap,
      });
      if (res.nicknameSynced) nickCount++;
      if (res.roleSynced) roleCount++;
    }

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          {
            title: '🔄 Guild Member Nicknames & Class Roles Synced',
            description: [
              `**Main Characters Checked:** ${mains.length}`,
              `🏷️ **Discord Nicknames Updated:** ${nickCount}`,
              `🛡️ **Class Roles Assigned:** ${roleCount}`,
              mains.length > nickCount
                ? `_(Note: Discord prevents bots from changing the Server Owner's nickname—the owner must rename themselves manually, though their Class Role is still assigned!)_`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
            color: ALLIANCE_BLUE,
          },
        ],
      },
    };
  }

  return ephemeralMessage('Unknown `/setup` subcommand.');
}

async function syncGuildMemberToMain(
  guildId: string,
  userId: string,
  characterName: string,
  wowClass: WowClass,
  repo: GuildRepository
): Promise<string[]> {
  try {
    let config = await repo.getGuildConfig(guildId);
    let classRoleIds = config?.classRoleIds ?? {};

    // If the guild hasn't run /setup discord yet, provision the 9 hoisted class roles automatically
    if (!classRoleIds[wowClass]) {
      const ensured = await ensureGuildClassRoles(guildId, classRoleIds);
      classRoleIds = ensured.roleMap;
      config = await repo.upsertGuildConfig({
        guildId,
        welcomeChannelId: config?.welcomeChannelId,
        classRoleIds,
        welcomedUserIds: config?.welcomedUserIds ?? [],
        updatedAt: new Date().toISOString(),
      });
    }

    const syncRes = await syncMemberNicknameAndClassRole({
      guildId,
      userId,
      characterName,
      wowClass,
      classRoleIds,
    });

    const messages: string[] = [];
    if (syncRes.nicknameSynced) {
      messages.push(`🏷️ **Discord Nickname:** Updated to \`${characterName}\``);
    }
    if (syncRes.roleSynced) {
      messages.push(`🛡️ **Discord Class Group:** Assigned **@${wowClass}**`);
    }
    for (const note of syncRes.notes) {
      messages.push(`ℹ️ _${note}_`);
    }
    return messages;
  } catch {
    return [];
  }
}

function matchAllianceRace(raw: string): WowRace | null {
  const lower = raw.trim().toLowerCase();
  if (lower === 'human') return 'Human';
  if (lower === 'dwarf') return 'Dwarf';
  if (lower === 'night elf' || lower === 'nightelf' || lower === 'nelf' || lower === 'ne') return 'Night Elf';
  if (lower === 'gnome') return 'Gnome';
  if (lower.includes('skyborne') || lower.includes('high order')) return 'High Order Skyborne';
  return null;
}

function matchWowClass(raw: string): WowClass | null {
  const lower = raw.trim().toLowerCase();
  const map: Record<string, WowClass> = {
    warrior: 'Warrior',
    war: 'Warrior',
    paladin: 'Paladin',
    pally: 'Paladin',
    hunter: 'Hunter',
    hunt: 'Hunter',
    rogue: 'Rogue',
    priest: 'Priest',
    shaman: 'Shaman',
    sham: 'Shaman',
    mage: 'Mage',
    warlock: 'Warlock',
    lock: 'Warlock',
    druid: 'Druid',
  };
  return map[lower] ?? null;
}

function matchRaidRole(raw: string): RaidRole | null {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith('tank')) return 'Tank';
  if (lower.startsWith('heal')) return 'Healer';
  if (lower.startsWith('melee') || lower === 'mdps') return 'Melee';
  if (lower.startsWith('range') || lower === 'rdps' || lower === 'caster') return 'Ranged';
  return null;
}

