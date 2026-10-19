import { normalizeCharacterName } from '@dr/shared';
import type {
  CandidateLootSummary,
  GuildCharacter,
  GuildRepository,
} from './types.js';

export function compareCandidatePriority(a: CandidateLootSummary, b: CandidateLootSummary): number {
  if (b.recommendationScore !== a.recommendationScore) {
    return b.recommendationScore - a.recommendationScore;
  }
  if (b.confirmedRaidSignupsCount !== a.confirmedRaidSignupsCount) {
    return b.confirmedRaidSignupsCount - a.confirmedRaidSignupsCount;
  }
  if (a.msAwardsLast14Days !== b.msAwardsLast14Days) {
    return a.msAwardsLast14Days - b.msAwardsLast14Days;
  }
  if (a.msAwardsLast30Days !== b.msAwardsLast30Days) {
    return a.msAwardsLast30Days - b.msAwardsLast30Days;
  }
  if (a.msAwardsTotal !== b.msAwardsTotal) {
    return a.msAwardsTotal - b.msAwardsTotal;
  }
  const aDays = a.daysSinceLastMsAward ?? Number.POSITIVE_INFINITY;
  const bDays = b.daysSinceLastMsAward ?? Number.POSITIVE_INFINITY;
  if (bDays !== aDays) {
    return bDays - aDays;
  }
  return a.characterName.localeCompare(b.characterName);
}

export function sortCandidatesByRecommendation(
  summaries: CandidateLootSummary[]
): CandidateLootSummary[] {
  return [...summaries].sort(compareCandidatePriority).map((s, idx) => ({
    ...s,
    recommendationRank: idx + 1,
  }));
}

export async function buildCandidateLootSummaries(
  repo: GuildRepository,
  guildId: string,
  characterNames: string[],
  now: Date = new Date()
): Promise<CandidateLootSummary[]> {
  const allCharacters = await repo.listGuildCharacters(guildId);
  const charByLower = new Map<string, GuildCharacter>();
  for (const c of allCharacters) {
    charByLower.set(c.name.toLowerCase(), c);
  }

  const allRaids = await repo.listRaidEvents(guildId, 25);
  const totalTrackedRaids = allRaids.length;
  const signupCountByChar = new Map<string, number>();
  const signupCountByUser = new Map<string, number>();

  for (const raid of allRaids) {
    const signups = await repo.listRaidSignups(guildId, raid.raidId);
    for (const s of signups) {
      if (s.status === 'CONFIRMED' || s.status === 'BENCH') {
        const key = s.characterName.toLowerCase();
        signupCountByChar.set(key, (signupCountByChar.get(key) ?? 0) + 1);
        signupCountByUser.set(s.userId, (signupCountByUser.get(s.userId) ?? 0) + 1);
      }
    }
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const nowMs = now.getTime();
  const summaries: CandidateLootSummary[] = [];

  for (const rawName of characterNames) {
    const cleanName = normalizeCharacterName(rawName);
    if (!cleanName) continue;

    const lower = cleanName.toLowerCase();
    const character = charByLower.get(lower);

    const awards = await repo.listCharacterLootHistory(guildId, cleanName, 50);
    const msAwards = awards.filter((a) => a.specType === 'MS' || a.specType === 'SR');
    const osAwards = awards.filter((a) => a.specType === 'OS' || a.specType === 'TMOG');

    let msAwardsLast14Days = 0;
    let msAwardsLast30Days = 0;
    let latestMsTimestamp: number | undefined;

    for (const award of msAwards) {
      const ts = new Date(award.awardedAt).getTime();
      if (!Number.isNaN(ts)) {
        const diffDays = (nowMs - ts) / msPerDay;
        if (diffDays <= 14) msAwardsLast14Days++;
        if (diffDays <= 30) msAwardsLast30Days++;
        if (latestMsTimestamp === undefined || ts > latestMsTimestamp) {
          latestMsTimestamp = ts;
        }
      }
    }

    const daysSinceLastMsAward =
      latestMsTimestamp !== undefined
        ? Math.max(0, Math.floor((nowMs - latestMsTimestamp) / msPerDay))
        : undefined;

    const charSignups = signupCountByChar.get(lower) ?? 0;
    const userSignups = character ? signupCountByUser.get(character.userId) ?? 0 : 0;
    const confirmedRaidSignupsCount = Math.max(charSignups, userSignups);

    const attendanceRate =
      totalTrackedRaids > 0
        ? Math.min(100, Math.round((confirmedRaidSignupsCount / totalTrackedRaids) * 100))
        : 0;

    // Recommendation score weighing raid attendance and prior MS loot:
    // - Base: 100
    // - Attendance: +20 per raid attended + up to +25 for attendance %
    // - Main status: +15 for registered Main character
    // - Prior MS loot: -35 per MS item in last 14d, -20 per MS item in 15-30d window, -10 per total MS item, -2 per OS item
    // - Loot drought bonus: +25 if 0 prior MS awards, or +1 per day since last MS award (up to +30)
    const recent15To30DaysMs = Math.max(0, msAwardsLast30Days - msAwardsLast14Days);
    const droughtBonus =
      msAwards.length === 0
        ? 25
        : Math.min(30, daysSinceLastMsAward ?? 0);

    const recommendationScore =
      100 +
      confirmedRaidSignupsCount * 20 +
      Math.round(attendanceRate * 0.25) +
      (character?.isMain ? 15 : 0) +
      droughtBonus -
      msAwardsLast14Days * 35 -
      recent15To30DaysMs * 20 -
      msAwards.length * 10 -
      osAwards.length * 2;

    const recommendationReasons: string[] = [];
    if (totalTrackedRaids > 0) {
      recommendationReasons.push(
        `${confirmedRaidSignupsCount}/${totalTrackedRaids} raids attended (${attendanceRate}%)`
      );
    } else if (confirmedRaidSignupsCount > 0) {
      recommendationReasons.push(`${confirmedRaidSignupsCount} raids attended`);
    }

    if (msAwards.length === 0) {
      recommendationReasons.push('No prior MS loot received');
    } else {
      if (msAwardsLast14Days === 0) {
        recommendationReasons.push('0 MS drops in last 14d');
      } else {
        recommendationReasons.push(`${msAwardsLast14Days} MS drop(s) in last 14d`);
      }
      if (daysSinceLastMsAward !== undefined) {
        recommendationReasons.push(`Last MS award ${daysSinceLastMsAward}d ago`);
      }
    }

    if (character?.isMain) {
      recommendationReasons.push('Registered Main');
    } else if (character && !character.isMain) {
      recommendationReasons.push('Registered Alt');
    }

    summaries.push({
      characterName: cleanName,
      character,
      totalAwards: awards.length,
      msAwardsTotal: msAwards.length,
      osAwardsTotal: osAwards.length,
      msAwardsLast14Days,
      msAwardsLast30Days,
      lastAwardedAt: awards[0]?.awardedAt,
      daysSinceLastMsAward,
      recentAwards: awards.slice(0, 5),
      confirmedRaidSignupsCount,
      totalTrackedRaids,
      attendanceRate,
      recommendationScore,
      recommendationRank: 1,
      recommendationReasons,
    });
  }

  // Assign ranks based on priority order while preserving input array order
  const sorted = [...summaries].sort(compareCandidatePriority);
  const rankByLower = new Map<string, number>();
  sorted.forEach((s, index) => {
    rankByLower.set(s.characterName.toLowerCase(), index + 1);
  });

  for (const s of summaries) {
    s.recommendationRank = rankByLower.get(s.characterName.toLowerCase()) ?? 1;
  }

  return summaries;
}

