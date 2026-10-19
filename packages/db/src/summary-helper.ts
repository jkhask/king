import { normalizeCharacterName } from '@dr/shared';
import type {
  CandidateLootSummary,
  GuildCharacter,
  GuildRepository,
  ObtainedGearAward,
} from './types.js';

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
  const signupCountByChar = new Map<string, number>();
  for (const raid of allRaids) {
    const signups = await repo.listRaidSignups(guildId, raid.raidId);
    for (const s of signups) {
      if (s.status === 'CONFIRMED' || s.status === 'BENCH') {
        const key = s.characterName.toLowerCase();
        signupCountByChar.set(key, (signupCountByChar.get(key) ?? 0) + 1);
      }
    }
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const nowMs = now.getTime();
  const summaries: CandidateLootSummary[] = [];

  for (const rawName of characterNames) {
    const cleanName = normalizeCharacterName(rawName);
    if (!cleanName) continue;

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

    summaries.push({
      characterName: cleanName,
      character: charByLower.get(cleanName.toLowerCase()),
      totalAwards: awards.length,
      msAwardsTotal: msAwards.length,
      osAwardsTotal: osAwards.length,
      msAwardsLast14Days,
      msAwardsLast30Days,
      lastAwardedAt: awards[0]?.awardedAt,
      daysSinceLastMsAward,
      recentAwards: awards.slice(0, 5),
      confirmedRaidSignupsCount: signupCountByChar.get(cleanName.toLowerCase()) ?? 0,
    });
  }

  return summaries;
}
