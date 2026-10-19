import { describe, expect, it } from 'vitest';
import { InMemoryGuildRepository } from './index.js';

describe('GuildRepository (InMemory)', () => {
  const guildId = 'guild-dr-alliance';

  it('registers characters and enforces a single main per user', async () => {
    const repo = new InMemoryGuildRepository();

    await repo.upsertCharacter({
      guildId,
      userId: 'user-1',
      name: 'magni',
      race: 'Dwarf',
      wowClass: 'Shaman',
      primaryRole: 'Healer',
      offspecRole: 'Melee',
      isMain: true,
      professions: ['Alchemy', 'Herbalism'],
      notableRecipes: ['Flask of the Titans'],
      createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z',
    });

    await repo.upsertCharacter({
      guildId,
      userId: 'user-1',
      name: 'aelindra',
      race: 'High Order Skyborne',
      wowClass: 'Mage',
      primaryRole: 'Ranged',
      isMain: true, // Should promote Aelindra to main and demote Magni to alt
      professions: ['Tailoring', 'Enchanting'],
      notableRecipes: ['Crusader'],
      createdAt: '2026-11-06T00:00:00Z',
      updatedAt: '2026-11-06T00:00:00Z',
    });

    const userChars = await repo.listUserCharacters(guildId, 'user-1');
    expect(userChars).toHaveLength(2);
    expect(userChars[0].name).toBe('Aelindra');
    expect(userChars[0].isMain).toBe(true);
    expect(userChars[1].name).toBe('Magni');
    expect(userChars[1].isMain).toBe(false);
  });

  it('records obtained gear, deduplicates hashes, and builds Loot Council candidate summaries', async () => {
    const repo = new InMemoryGuildRepository();

    await repo.upsertCharacter({
      guildId,
      userId: 'user-1',
      name: 'Bolvar',
      race: 'Human',
      wowClass: 'Paladin',
      primaryRole: 'Tank',
      isMain: true,
      professions: ['Blacksmithing', 'Mining'],
      notableRecipes: [],
      createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z',
    });

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();

    const importRes = await repo.recordLootAwards([
      {
        guildId,
        awardHash: 'hash-1',
        characterName: 'bolvar',
        itemName: 'Bulwark of Azzinoth',
        itemId: 19349,
        specType: 'MS',
        raidInstance: 'Hyjal Summit',
        awardedAt: threeDaysAgo,
      },
      {
        guildId,
        awardHash: 'hash-1', // duplicate
        characterName: 'Bolvar',
        itemName: 'Bulwark of Azzinoth',
        itemId: 19349,
        specType: 'MS',
        raidInstance: 'Hyjal Summit',
        awardedAt: threeDaysAgo,
      },
      {
        guildId,
        awardHash: 'hash-2',
        characterName: 'Bolvar',
        itemName: 'Helm of Wrath',
        itemId: 16963,
        specType: 'OS',
        raidInstance: "Onyxia's Lair",
        awardedAt: twentyDaysAgo,
      },
    ]);

    expect(importRes).toEqual({ inserted: 2, skippedDuplicates: 1 });

    const summaries = await repo.getCandidateLootSummaries(guildId, ['Bolvar', 'NewRecruit']);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      characterName: 'Bolvar',
      totalAwards: 2,
      msAwardsTotal: 1,
      osAwardsTotal: 1,
      msAwardsLast14Days: 1,
      msAwardsLast30Days: 1,
      daysSinceLastMsAward: 3,
    });
    expect(summaries[1]).toMatchObject({
      characterName: 'Newrecruit',
      totalAwards: 0,
      msAwardsTotal: 0,
    });
  });

  it('runs a full Loot Council deliberation session and records the winning award', async () => {
    const repo = new InMemoryGuildRepository();

    const session = await repo.createLootCouncilSession({
      guildId,
      sessionId: 'lc-101',
      itemName: 'Ashkandi, Greatsword of the Brotherhood',
      itemId: 19364,
      raidInstance: 'Hyjal Summit',
      status: 'OPEN',
      createdByUserId: 'officer-1',
      candidates: {},
      votes: {},
      createdAt: '2026-12-10T21:00:00Z',
    });

    expect(session.status).toBe('OPEN');

    await repo.upsertLootCouncilCandidate(guildId, 'lc-101', {
      userId: 'user-1',
      characterName: 'Danath',
      wowClass: 'Warrior',
      interest: 'BIG_UPGRADE',
      currentItemNote: 'Obsidian Edged Blade',
      updatedAt: '2026-12-10T21:01:00Z',
    });

    await repo.castLootCouncilVote(guildId, 'lc-101', 'officer-1', 'Danath');
    await repo.castLootCouncilVote(guildId, 'lc-101', 'officer-2', 'Danath');

    const resolved = await repo.resolveLootCouncilSession(
      guildId,
      'lc-101',
      'Danath',
      'MS',
      'officer-1'
    );

    expect(resolved?.session.status).toBe('AWARDED');
    expect(resolved?.session.winnerCharacterName).toBe('Danath');

    const history = await repo.listCharacterLootHistory(guildId, 'Danath');
    expect(history).toHaveLength(1);
    expect(history[0].itemName).toBe('Ashkandi, Greatsword of the Brotherhood');
  });
});
