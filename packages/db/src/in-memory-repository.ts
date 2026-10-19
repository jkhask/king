import { createHash } from 'node:crypto';
import { type LootSpecType, normalizeCharacterName } from '@dr/shared';
import { buildCandidateLootSummaries } from './summary-helper.js';
import type {
  CandidateLootSummary,
  GuildBankItem,
  GuildCharacter,
  GuildConfig,
  GuildRepository,
  GuildRequestTicket,
  LootCouncilCandidateInterest,
  LootCouncilSession,
  ObtainedGearAward,
  RaidEvent,
  RaidSignup,
} from './types.js';

export class InMemoryGuildRepository implements GuildRepository {
  private guildConfigs = new Map<string, GuildConfig>(); // `${guildId}`
  private characters = new Map<string, GuildCharacter>(); // `${guildId}#${nameLower}`
  private raids = new Map<string, RaidEvent>(); // `${guildId}#${raidId}`
  private signups = new Map<string, RaidSignup>(); // `${guildId}#${raidId}#${userId}`
  private awards = new Map<string, ObtainedGearAward>(); // `${guildId}#${awardHash}`
  private lcSessions = new Map<string, LootCouncilSession>(); // `${guildId}#${sessionId}`
  private bankItems = new Map<string, GuildBankItem>(); // `${guildId}#${category}#${itemLower}`
  private requests = new Map<string, GuildRequestTicket>(); // `${guildId}#${requestId}`

  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    return this.guildConfigs.get(guildId) ?? null;
  }

  async upsertGuildConfig(config: GuildConfig): Promise<GuildConfig> {
    this.guildConfigs.set(config.guildId, config);
    return config;
  }

  async listConfiguredGuilds(): Promise<GuildConfig[]> {
    return Array.from(this.guildConfigs.values());
  }

  async upsertCharacter(char: GuildCharacter): Promise<GuildCharacter> {
    const normalizedName = normalizeCharacterName(char.name);
    const updated: GuildCharacter = {
      ...char,
      name: normalizedName,
    };

    // If marked as main, demote other mains for this user in the same guild
    if (updated.isMain) {
      for (const [key, existing] of this.characters.entries()) {
        if (
          existing.guildId === updated.guildId &&
          existing.userId === updated.userId &&
          existing.name.toLowerCase() !== normalizedName.toLowerCase() &&
          existing.isMain
        ) {
          this.characters.set(key, { ...existing, isMain: false });
        }
      }
    }

    const key = `${updated.guildId}#${normalizedName.toLowerCase()}`;
    this.characters.set(key, updated);
    return updated;
  }

  async getCharacterByName(guildId: string, characterName: string): Promise<GuildCharacter | null> {
    const key = `${guildId}#${characterName.trim().toLowerCase()}`;
    return this.characters.get(key) ?? null;
  }

  async listUserCharacters(guildId: string, userId: string): Promise<GuildCharacter[]> {
    return Array.from(this.characters.values())
      .filter((c) => c.guildId === guildId && c.userId === userId)
      .sort((a, b) => (a.isMain === b.isMain ? a.name.localeCompare(b.name) : a.isMain ? -1 : 1));
  }

  async listGuildCharacters(guildId: string): Promise<GuildCharacter[]> {
    return Array.from(this.characters.values())
      .filter((c) => c.guildId === guildId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteCharacter(guildId: string, userId: string, characterName: string): Promise<boolean> {
    const key = `${guildId}#${characterName.trim().toLowerCase()}`;
    const existing = this.characters.get(key);
    if (!existing || existing.userId !== userId) return false;
    return this.characters.delete(key);
  }

  async createRaidEvent(raid: RaidEvent): Promise<RaidEvent> {
    this.raids.set(`${raid.guildId}#${raid.raidId}`, raid);
    return raid;
  }

  async getRaidEvent(guildId: string, raidId: string): Promise<RaidEvent | null> {
    return this.raids.get(`${guildId}#${raidId}`) ?? null;
  }

  async listRaidEvents(guildId: string, limit = 10): Promise<RaidEvent[]> {
    return Array.from(this.raids.values())
      .filter((r) => r.guildId === guildId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async updateRaidStatus(
    guildId: string,
    raidId: string,
    status: RaidEvent['status']
  ): Promise<RaidEvent | null> {
    const key = `${guildId}#${raidId}`;
    const existing = this.raids.get(key);
    if (!existing) return null;
    const updated: RaidEvent = { ...existing, status };
    this.raids.set(key, updated);
    return updated;
  }

  async upsertRaidSignup(signup: RaidSignup): Promise<RaidSignup> {
    const key = `${signup.guildId}#${signup.raidId}#${signup.userId}`;
    this.signups.set(key, signup);
    return signup;
  }

  async listRaidSignups(guildId: string, raidId: string): Promise<RaidSignup[]> {
    return Array.from(this.signups.values())
      .filter((s) => s.guildId === guildId && s.raidId === raidId)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  async listUserSignups(guildId: string, userId: string): Promise<RaidSignup[]> {
    return Array.from(this.signups.values()).filter(
      (s) => s.guildId === guildId && s.userId === userId
    );
  }

  async recordLootAwards(
    awards: ObtainedGearAward[]
  ): Promise<{ inserted: number; skippedDuplicates: number }> {
    let inserted = 0;
    let skippedDuplicates = 0;
    for (const award of awards) {
      const normalized: ObtainedGearAward = {
        ...award,
        characterName: normalizeCharacterName(award.characterName),
      };
      const key = `${normalized.guildId}#${normalized.awardHash}`;
      if (this.awards.has(key)) {
        skippedDuplicates++;
      } else {
        this.awards.set(key, normalized);
        inserted++;
      }
    }
    return { inserted, skippedDuplicates };
  }

  async listCharacterLootHistory(
    guildId: string,
    characterName: string,
    limit = 25
  ): Promise<ObtainedGearAward[]> {
    const targetLower = characterName.trim().toLowerCase();
    return Array.from(this.awards.values())
      .filter((a) => a.guildId === guildId && a.characterName.toLowerCase() === targetLower)
      .sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))
      .slice(0, limit);
  }

  async listGuildLootHistory(guildId: string, limit = 30): Promise<ObtainedGearAward[]> {
    return Array.from(this.awards.values())
      .filter((a) => a.guildId === guildId)
      .sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))
      .slice(0, limit);
  }

  async getCandidateLootSummaries(
    guildId: string,
    characterNames: string[]
  ): Promise<CandidateLootSummary[]> {
    return buildCandidateLootSummaries(this, guildId, characterNames);
  }

  async createLootCouncilSession(session: LootCouncilSession): Promise<LootCouncilSession> {
    this.lcSessions.set(`${session.guildId}#${session.sessionId}`, session);
    return session;
  }

  async getLootCouncilSession(
    guildId: string,
    sessionId: string
  ): Promise<LootCouncilSession | null> {
    return this.lcSessions.get(`${guildId}#${sessionId}`) ?? null;
  }

  async upsertLootCouncilCandidate(
    guildId: string,
    sessionId: string,
    candidate: LootCouncilCandidateInterest
  ): Promise<LootCouncilSession | null> {
    const key = `${guildId}#${sessionId}`;
    const session = this.lcSessions.get(key);
    if (!session || session.status !== 'OPEN') return null;

    const updated: LootCouncilSession = {
      ...session,
      candidates: {
        ...session.candidates,
        [candidate.characterName.toLowerCase()]: {
          ...candidate,
          characterName: normalizeCharacterName(candidate.characterName),
        },
      },
    };
    this.lcSessions.set(key, updated);
    return updated;
  }

  async castLootCouncilVote(
    guildId: string,
    sessionId: string,
    officerUserId: string,
    candidateCharacterName: string
  ): Promise<LootCouncilSession | null> {
    const key = `${guildId}#${sessionId}`;
    const session = this.lcSessions.get(key);
    if (!session || session.status !== 'OPEN') return null;

    const updated: LootCouncilSession = {
      ...session,
      votes: {
        ...session.votes,
        [officerUserId]: normalizeCharacterName(candidateCharacterName),
      },
    };
    this.lcSessions.set(key, updated);
    return updated;
  }

  async resolveLootCouncilSession(
    guildId: string,
    sessionId: string,
    winnerCharacterName: string,
    specType: LootSpecType,
    awardedByUserId: string
  ): Promise<{ session: LootCouncilSession; award: ObtainedGearAward } | null> {
    const key = `${guildId}#${sessionId}`;
    const session = this.lcSessions.get(key);
    if (!session) return null;

    const cleanWinner = normalizeCharacterName(winnerCharacterName);
    const awardedAt = new Date().toISOString();
    const awardHash = createHash('sha256')
      .update(`lc|${sessionId}|${cleanWinner.toLowerCase()}|${session.itemName.toLowerCase()}`)
      .digest('hex')
      .slice(0, 16);

    const award: ObtainedGearAward = {
      guildId,
      awardHash,
      characterName: cleanWinner,
      itemName: session.itemName,
      itemId: session.itemId,
      specType,
      raidInstance: session.raidInstance,
      boss: session.boss,
      awardedByUserId,
      awardedAt,
    };

    await this.recordLootAwards([award]);

    const updated: LootCouncilSession = {
      ...session,
      status: 'AWARDED',
      winnerCharacterName: cleanWinner,
      awardedSpecType: specType,
    };
    this.lcSessions.set(key, updated);
    return { session: updated, award };
  }

  async upsertBankItem(item: GuildBankItem): Promise<GuildBankItem> {
    const key = `${item.guildId}#${item.category}#${item.itemName.toLowerCase()}`;
    if (item.quantity <= 0) {
      this.bankItems.delete(key);
      return { ...item, quantity: 0 };
    }
    this.bankItems.set(key, item);
    return item;
  }

  async listBankItems(guildId: string, searchQuery?: string): Promise<GuildBankItem[]> {
    const queryLower = searchQuery?.trim().toLowerCase();
    return Array.from(this.bankItems.values())
      .filter((item) => {
        if (item.guildId !== guildId) return false;
        if (!queryLower) return true;
        return (
          item.itemName.toLowerCase().includes(queryLower) ||
          item.category.toLowerCase().includes(queryLower)
        );
      })
      .sort((a, b) =>
        a.category === b.category
          ? a.itemName.localeCompare(b.itemName)
          : a.category.localeCompare(b.category)
      );
  }

  async createRequestTicket(ticket: GuildRequestTicket): Promise<GuildRequestTicket> {
    this.requests.set(`${ticket.guildId}#${ticket.requestId}`, ticket);
    return ticket;
  }

  async getRequestTicket(guildId: string, requestId: string): Promise<GuildRequestTicket | null> {
    return this.requests.get(`${guildId}#${requestId}`) ?? null;
  }

  async updateRequestTicketStatus(
    guildId: string,
    requestId: string,
    status: GuildRequestTicket['status'],
    actorUserId: string
  ): Promise<GuildRequestTicket | null> {
    const key = `${guildId}#${requestId}`;
    const existing = this.requests.get(key);
    if (!existing) return null;
    const updated: GuildRequestTicket = {
      ...existing,
      status,
      claimedByUserId: status === 'CLAIMED' ? actorUserId : existing.claimedByUserId,
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(key, updated);
    return updated;
  }

  async listOpenRequestTickets(guildId: string): Promise<GuildRequestTicket[]> {
    return Array.from(this.requests.values())
      .filter((r) => r.guildId === guildId && (r.status === 'OPEN' || r.status === 'CLAIMED'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
