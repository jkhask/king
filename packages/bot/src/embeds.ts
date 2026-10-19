import {
  type CandidateLootSummary,
  type GuildCharacter,
  type GuildRequestTicket,
  type LootCouncilSession,
  type RaidEvent,
  type RaidSignup,
  sortCandidatesByRecommendation,
} from '@dr/db';
import {
  CLASS_ICONS,
  GUILD_NAME,
  RAID_ROLES,
  ROLE_ICONS,
  WOW_CLASSES,
  WOW_FOREVER_RAIDS,
} from '@dr/shared';
import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  ButtonStyle,
  ComponentType,
} from 'discord-api-types/v10';

export const ALLIANCE_BLUE = 0x0070dd;
export const GOLD_COLOR = 0xf8b700;
export const PURPLE_EPIC = 0xa335ee;
export const GREEN_UNCOMMON = 0x1eff00;

export function buildRosterSummaryEmbed(characters: GuildCharacter[]): APIEmbed {
  const mains = characters.filter((c) => c.isMain);
  const alts = characters.filter((c) => !c.isMain);

  const roleCounts = { Tank: 0, Healer: 0, Melee: 0, Ranged: 0 };
  for (const m of mains) {
    roleCounts[m.primaryRole] = (roleCounts[m.primaryRole] ?? 0) + 1;
  }

  const classFields = WOW_CLASSES.map((wowClass) => {
    const classMains = mains.filter((c) => c.wowClass === wowClass);
    const classAlts = alts.filter((c) => c.wowClass === wowClass);
    const listText =
      classMains.length > 0
        ? classMains.map((c) => `${ROLE_ICONS[c.primaryRole]} **${c.name}** (${c.race})`).join('\n')
        : '_None_';
    return {
      name: `${CLASS_ICONS[wowClass]} ${wowClass} (${classMains.length}M / ${classAlts.length}A)`,
      value: listText,
      inline: true,
    };
  });

  return {
    title: `🦁 ${GUILD_NAME} — Alliance Roster (WoW: Forever)`,
    description: [
      `**Mains:** ${mains.length} | **Alts:** ${alts.length} | **Total Characters:** ${characters.length}`,
      `**Main Role Breakdown:** 🛡️ Tanks: **${roleCounts.Tank}** • 💚 Healers: **${roleCounts.Healer}** • ⚔️ Melee: **${roleCounts.Melee}** • 🎯 Ranged: **${roleCounts.Ranged}**`,
    ].join('\n'),
    color: ALLIANCE_BLUE,
    fields: classFields,
    footer: { text: 'World of Warcraft: Forever • Use /character register to add or update your character' },
  };
}

export function buildRaidEventMessage(
  raid: RaidEvent,
  signups: RaidSignup[]
): {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
} {
  const template = WOW_FOREVER_RAIDS[raid.templateId] ?? WOW_FOREVER_RAIDS.custom;
  const confirmed = signups.filter((s) => s.status === 'CONFIRMED');
  const bench = signups.filter((s) => s.status === 'BENCH');
  const tentative = signups.filter((s) => s.status === 'TENTATIVE');
  const absent = signups.filter((s) => s.status === 'ABSENT');

  const roleFields = RAID_ROLES.map((role) => {
    const roleSignups = confirmed.filter((s) => s.role === role);
    const target = template.recommendedRoles[role];
    const lines =
      roleSignups.length > 0
        ? roleSignups.map((s) => `${CLASS_ICONS[s.wowClass]} **${s.characterName}** (<@${s.userId}>)`).join('\n')
        : '_Open_';
    return {
      name: `${ROLE_ICONS[role]} ${role} (${roleSignups.length}/${target})`,
      value: lines,
      inline: true,
    };
  });

  const extraFields = [];
  if (bench.length > 0) {
    extraFields.push({
      name: `🪑 Bench / Standby (${bench.length})`,
      value: bench.map((s) => `${CLASS_ICONS[s.wowClass]} **${s.characterName}** (${s.role})`).join(', '),
      inline: false,
    });
  }
  if (tentative.length > 0) {
    extraFields.push({
      name: `❔ Tentative (${tentative.length})`,
      value: tentative.map((s) => `**${s.characterName}**`).join(', '),
      inline: true,
    });
  }
  if (absent.length > 0) {
    extraFields.push({
      name: `❌ Absent (${absent.length})`,
      value: absent.map((s) => `**${s.characterName}**`).join(', '),
      inline: true,
    });
  }

  const embed: APIEmbed = {
    title: `⚔️ [${raid.size}-Man] ${raid.name}`,
    description: [
      `📅 **Schedule:** ${raid.scheduledAt}`,
      `🆔 **Raid ID:** \`${raid.raidId}\` • **Status:** \`${raid.status}\``,
      `👥 **Confirmed Raiders:** **${confirmed.length} / ${raid.size}**`,
      raid.description ? `\n📝 **Notes:** ${raid.description}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    color: raid.status === 'OPEN' ? ALLIANCE_BLUE : GOLD_COLOR,
    fields: [...roleFields, ...extraFields],
    footer: {
      text: `${GUILD_NAME} • Click a button below to sign up with your Main character`,
    },
  };

  const row1: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        custom_id: `raid_signup:${raid.raidId}:MAIN`,
        label: 'Sign Up (Main Role)',
        emoji: { name: '✅' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `raid_signup:${raid.raidId}:Tank`,
        label: 'Tank',
        emoji: { name: '🛡️' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `raid_signup:${raid.raidId}:Healer`,
        label: 'Healer',
        emoji: { name: '💚' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `raid_signup:${raid.raidId}:Melee`,
        label: 'Melee',
        emoji: { name: '⚔️' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `raid_signup:${raid.raidId}:Ranged`,
        label: 'Ranged',
        emoji: { name: '🎯' },
      },
    ],
  };

  const row2: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `raid_signup:${raid.raidId}:BENCH`,
        label: 'Bench / Standby',
        emoji: { name: '🪑' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `raid_signup:${raid.raidId}:TENTATIVE`,
        label: 'Tentative',
        emoji: { name: '❔' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        custom_id: `raid_signup:${raid.raidId}:ABSENT`,
        label: 'Absent',
        emoji: { name: '✖️' },
      },
    ],
  };

  return {
    embeds: [embed],
    components: raid.status === 'OPEN' ? [row1, row2] : [],
  };
}

function formatRankBadge(rank: number): string {
  if (rank === 1) return '🥇 #1 Recommended';
  if (rank === 2) return '🥈 #2 Recommended';
  if (rank === 3) return '🥉 #3 Recommended';
  return `#${rank}`;
}

export function buildCandidateComparisonEmbed(
  title: string,
  description: string,
  summaries: CandidateLootSummary[]
): APIEmbed {
  const ranked = sortCandidatesByRecommendation(summaries);

  const fields = ranked.map((s) => {
    const charMeta = s.character
      ? `${CLASS_ICONS[s.character.wowClass]} ${s.character.wowClass} (${s.character.primaryRole}${s.character.isMain ? ' • ⭐ Main' : ' • 🔹 Alt'})`
      : 'Unregistered Character';

    const lastMsText =
      s.daysSinceLastMsAward !== undefined
        ? `${s.daysSinceLastMsAward}d ago`
        : 'Never';

    const attendanceText =
      s.totalTrackedRaids > 0
        ? `**${s.confirmedRaidSignupsCount}/${s.totalTrackedRaids}** raids (**${s.attendanceRate}%**)`
        : `**${s.confirmedRaidSignupsCount}** raids`;

    const recentGearLines =
      s.recentAwards.length > 0
        ? s.recentAwards
            .slice(0, 4)
            .map(
              (a) =>
                `• \`${a.awardedAt.slice(0, 10)}\` **[${a.itemName}]** (${a.specType}${a.raidInstance ? ` • ${a.raidInstance}` : ''})`
            )
            .join('\n')
        : '_No recorded loot in DB_';

    const rankPrefix = ranked.length > 1 ? `${formatRankBadge(s.recommendationRank)} — ` : '';

    return {
      name: `${rankPrefix}${s.characterName} — ${charMeta}`,
      value: [
        ranked.length > 1 && s.recommendationReasons.length > 0
          ? `💡 **Recommendation (Score ${s.recommendationScore}):** ${s.recommendationReasons.join(' • ')}`
          : '',
        `📅 **Raid Attendance:** ${attendanceText} • ⏱️ **Last MS Award:** ${lastMsText}`,
        `📊 **Prior Loot:** **${s.msAwardsTotal} MS** / ${s.osAwardsTotal} OS (14d MS: **${s.msAwardsLast14Days}** • 30d MS: **${s.msAwardsLast30Days}**)`,
        `**Recent Obtained Gear:**\n${recentGearLines}`,
      ]
        .filter(Boolean)
        .join('\n'),
      inline: false,
    };
  });

  if (fields.length === 0) {
    fields.push({
      name: 'No Eligible Candidates Found',
      value:
        'Specify candidate names with `candidates:` (e.g. `/loot council item:[Item] candidates:Bolvar, Magni`), sign up for a raid via `/raid create`, or register characters with `/character register`.',
      inline: false,
    });
  }

  return {
    title,
    description,
    color: PURPLE_EPIC,
    fields: fields.slice(0, 15),
    footer: {
      text: `${GUILD_NAME} Loot Council Reference • Deliberation in-game via Gargul • Ranked by Attendance & Prior Loot`,
    },
  };
}

export function buildLootCouncilRecommendationEmbed(params: {
  itemName: string;
  itemId?: number;
  raidContext?: string;
  roleFilter?: string;
  summaries: CandidateLootSummary[];
}): APIEmbed {
  const ranked = sortCandidatesByRecommendation(params.summaries);
  const topCandidate = ranked[0];

  const itemHeader = params.itemId
    ? `**[${params.itemName}]** (Item ID: \`${params.itemId}\`)`
    : `**[${params.itemName}]**`;

  const podiumLines = ranked.slice(0, 3).map((s, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
    const reasons = s.recommendationReasons.join(' • ');
    return `${medal} **#${idx + 1} ${s.characterName}** (Score: \`${s.recommendationScore}\`) — *${reasons}*`;
  });

  const description = [
    `💎 **Item:** ${itemHeader}`,
    params.raidContext ? `🏰 **Raid:** ${params.raidContext}` : '',
    params.roleFilter ? `🎯 **Role Filter:** ${params.roleFilter}` : '',
    topCandidate
      ? `\n🏆 **Recommended Recipient:** 🥇 **${topCandidate.characterName}**\n${podiumLines.join('\n')}`
      : '',
    `\n_Loot deliberation and rolls are handled in-game with **Gargul**. Recommendations below consider raid attendance and prior obtained loot._`,
  ]
    .filter(Boolean)
    .join('\n');

  return buildCandidateComparisonEmbed(
    `⚖️ Loot Council Recommendation — ${params.itemName}`,
    description,
    ranked
  );
}

export function buildLootCouncilMessage(
  session: LootCouncilSession,
  summaries: CandidateLootSummary[]
): {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
} {
  const ranked = sortCandidatesByRecommendation(summaries);
  const topCandidate = ranked[0];

  const itemHeader = session.itemId
    ? `**[${session.itemName}]** (Item ID: \`${session.itemId}\`)`
    : `**[${session.itemName}]**`;

  const description = [
    `💎 **Item Drop:** ${itemHeader}`,
    session.raidInstance
      ? `🏰 **Raid:** ${session.raidInstance}${session.boss ? ` (${session.boss})` : ''}`
      : '',
    topCandidate && session.status === 'OPEN'
      ? `\n🏆 **Top Recommended:** 🥇 **${topCandidate.characterName}** (Score: \`${topCandidate.recommendationScore}\` • ${topCandidate.recommendationReasons.join(' • ')})`
      : '',
    session.status === 'AWARDED'
      ? `\n🏆 **Awarded To:** **${session.winnerCharacterName}** (${session.awardedSpecType})`
      : `\nOfficers can review each candidate's attendance & obtained gear below, cast council votes, or finalize with \`/loot award character:<winner> item:${session.sessionId}\`.`,
  ]
    .filter(Boolean)
    .join('\n');

  const embed = buildCandidateComparisonEmbed(
    `⚖️ Loot Council Deliberation — ${session.itemName}`,
    description,
    ranked
  );
  embed.footer = {
    text: `Session ID: ${session.sessionId} • Status: ${session.status}${session.winnerCharacterName ? ` • Winner: ${session.winnerCharacterName}` : ''}`,
  };

  if (session.status !== 'OPEN') {
    return { embeds: [embed], components: [] };
  }

  const interestRow: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        custom_id: `lc_interest:${session.sessionId}:BIG_UPGRADE`,
        label: 'Main Spec / Big Upgrade',
        emoji: { name: '🔥' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `lc_interest:${session.sessionId}:MINOR_UPGRADE`,
        label: 'Minor Upgrade',
        emoji: { name: '⬆️' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `lc_interest:${session.sessionId}:OFFSPEC`,
        label: 'Off-Spec',
        emoji: { name: '🔄' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        custom_id: `lc_interest:${session.sessionId}:PASS`,
        label: 'Pass',
        emoji: { name: '⏭️' },
      },
    ],
  };

  const activeCandidates = Object.values(session.candidates)
    .filter((c) => c.interest !== 'PASS')
    .slice(0, 5);

  const components: APIActionRowComponent<APIButtonComponent>[] = [interestRow];

  if (activeCandidates.length > 0) {
    const voteRow: APIActionRowComponent<APIButtonComponent> = {
      type: ComponentType.ActionRow,
      components: activeCandidates.map((cand) => ({
        type: ComponentType.Button,
        style: ButtonStyle.Success,
        custom_id: `lc_vote:${session.sessionId}:${cand.characterName}`,
        label: `Vote: ${cand.characterName}`,
        emoji: { name: '🗳️' },
      })),
    };
    components.push(voteRow);
  }

  return { embeds: [embed], components };
}

export function buildRequestTicketMessage(ticket: GuildRequestTicket): {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
} {
  const statusEmoji =
    ticket.status === 'OPEN'
      ? '🟢 OPEN'
      : ticket.status === 'CLAIMED'
        ? '🟡 CLAIMED'
        : ticket.status === 'FULFILLED'
          ? '✅ FULFILLED'
          : '⚫ CANCELLED';

  const embed: APIEmbed = {
    title: `🛠️ [${ticket.requestType}] ${ticket.quantity}x ${ticket.itemName}`,
    description: [
      `👤 **Requester:** **${ticket.characterName}** (<@${ticket.requesterUserId}>)`,
      `📦 **Materials Provided:** ${ticket.matsProvided ? '✅ Yes' : '❌ No (Requesting from Guild Bank / Crafter)'}`,
      `📌 **Status:** **${statusEmoji}**${ticket.claimedByUserId ? ` (by <@${ticket.claimedByUserId}>)` : ''}`,
      ticket.notes ? `📝 **Notes:** ${ticket.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    color: ticket.status === 'FULFILLED' ? GREEN_UNCOMMON : GOLD_COLOR,
    footer: { text: `Ticket ID: ${ticket.requestId}` },
  };

  if (ticket.status === 'FULFILLED' || ticket.status === 'CANCELLED') {
    return { embeds: [embed], components: [] };
  }

  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        custom_id: `req_action:${ticket.requestId}:CLAIMED`,
        label: 'Claim Request',
        emoji: { name: '🙋' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Success,
        custom_id: `req_action:${ticket.requestId}:FULFILLED`,
        label: 'Mark Fulfilled',
        emoji: { name: '✅' },
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        custom_id: `req_action:${ticket.requestId}:CANCELLED`,
        label: 'Cancel',
        emoji: { name: '✖️' },
      },
    ],
  };

  return { embeds: [embed], components: [row] };
}
