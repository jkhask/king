import type {
  LootSpecType,
  Profession,
  RaidRole,
  WowClass,
  WowRace,
} from '@dr/shared';

export interface GuildCharacter {
  guildId: string;
  userId: string;
  name: string;
  race: WowRace;
  wowClass: WowClass;
  primaryRole: RaidRole;
  offspecRole?: RaidRole;
  isMain: boolean;
  professions: Profession[];
  notableRecipes: string[];
  createdAt: string;
  updatedAt: string;
}

export type SignupStatus = 'CONFIRMED' | 'BENCH' | 'TENTATIVE' | 'ABSENT';

export interface RaidEvent {
  guildId: string;
  raidId: string;
  templateId: string;
  name: string;
  size: 10 | 20 | 40;
  scheduledAt: string; // ISO string or human-readable schedule
  description?: string;
  createdByUserId: string;
  channelId?: string;
  messageId?: string;
  status: 'OPEN' | 'LOCKED' | 'COMPLETED';
  createdAt: string;
}

export interface RaidSignup {
  guildId: string;
  raidId: string;
  userId: string;
  characterName: string;
  wowClass: WowClass;
  role: RaidRole;
  status: SignupStatus;
  updatedAt: string;
}

/**
 * Historical record of obtained gear in the database (imported via Gargul or awarded via Discord Loot Council).
 * Referenced by the Loot Council when deliberating on new drops.
 */
export interface ObtainedGearAward {
  guildId: string;
  awardHash: string;
  characterName: string;
  itemName: string;
  itemId?: number;
  specType: LootSpecType;
  raidInstance?: string;
  boss?: string;
  awardedByUserId?: string;
  awardedAt: string; // ISO timestamp
}

export type CandidateInterestType = 'BIG_UPGRADE' | 'MINOR_UPGRADE' | 'OFFSPEC' | 'PASS';

export interface LootCouncilCandidateInterest {
  userId: string;
  characterName: string;
  wowClass: WowClass;
  interest: CandidateInterestType;
  currentItemNote?: string;
  updatedAt: string;
}

export interface LootCouncilSession {
  guildId: string;
  sessionId: string;
  itemName: string;
  itemId?: number;
  raidInstance?: string;
  boss?: string;
  status: 'OPEN' | 'AWARDED' | 'CLOSED';
  createdByUserId: string;
  candidates: Record<string, LootCouncilCandidateInterest>; // keyed by characterName.toLowerCase()
  votes: Record<string, string>; // officerUserId -> characterName
  winnerCharacterName?: string;
  awardedSpecType?: LootSpecType;
  createdAt: string;
}

export interface CandidateLootSummary {
  characterName: string;
  character?: GuildCharacter;
  totalAwards: number;
  msAwardsTotal: number;
  osAwardsTotal: number;
  msAwardsLast14Days: number;
  msAwardsLast30Days: number;
  lastAwardedAt?: string;
  daysSinceLastMsAward?: number;
  recentAwards: ObtainedGearAward[];
  confirmedRaidSignupsCount: number;
}

export interface GuildBankItem {
  guildId: string;
  category: 'Consumable' | 'Material' | 'Recipe' | 'Equipment' | 'Other';
  itemName: string;
  quantity: number;
  updatedByUserId: string;
  updatedAt: string;
}

export interface GuildRequestTicket {
  guildId: string;
  requestId: string;
  requesterUserId: string;
  characterName: string;
  requestType: 'CRAFTING' | 'CONSUMABLE' | 'BANK_WITHDRAW';
  itemName: string;
  quantity: number;
  matsProvided: boolean;
  notes?: string;
  status: 'OPEN' | 'CLAIMED' | 'FULFILLED' | 'CANCELLED';
  claimedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GuildRepository {
  // Character & Roster
  upsertCharacter(char: GuildCharacter): Promise<GuildCharacter>;
  getCharacterByName(guildId: string, characterName: string): Promise<GuildCharacter | null>;
  listUserCharacters(guildId: string, userId: string): Promise<GuildCharacter[]>;
  listGuildCharacters(guildId: string): Promise<GuildCharacter[]>;
  deleteCharacter(guildId: string, userId: string, characterName: string): Promise<boolean>;

  // Raids & Signups
  createRaidEvent(raid: RaidEvent): Promise<RaidEvent>;
  getRaidEvent(guildId: string, raidId: string): Promise<RaidEvent | null>;
  listRaidEvents(guildId: string, limit?: number): Promise<RaidEvent[]>;
  updateRaidStatus(guildId: string, raidId: string, status: RaidEvent['status']): Promise<RaidEvent | null>;
  upsertRaidSignup(signup: RaidSignup): Promise<RaidSignup>;
  listRaidSignups(guildId: string, raidId: string): Promise<RaidSignup[]>;
  listUserSignups(guildId: string, userId: string): Promise<RaidSignup[]>;

  // Obtained Gear & Loot Council
  recordLootAwards(awards: ObtainedGearAward[]): Promise<{ inserted: number; skippedDuplicates: number }>;
  listCharacterLootHistory(guildId: string, characterName: string, limit?: number): Promise<ObtainedGearAward[]>;
  listGuildLootHistory(guildId: string, limit?: number): Promise<ObtainedGearAward[]>;
  getCandidateLootSummaries(guildId: string, characterNames: string[]): Promise<CandidateLootSummary[]>;

  createLootCouncilSession(session: LootCouncilSession): Promise<LootCouncilSession>;
  getLootCouncilSession(guildId: string, sessionId: string): Promise<LootCouncilSession | null>;
  upsertLootCouncilCandidate(
    guildId: string,
    sessionId: string,
    candidate: LootCouncilCandidateInterest
  ): Promise<LootCouncilSession | null>;
  castLootCouncilVote(
    guildId: string,
    sessionId: string,
    officerUserId: string,
    candidateCharacterName: string
  ): Promise<LootCouncilSession | null>;
  resolveLootCouncilSession(
    guildId: string,
    sessionId: string,
    winnerCharacterName: string,
    specType: LootSpecType,
    awardedByUserId: string
  ): Promise<{ session: LootCouncilSession; award: ObtainedGearAward } | null>;

  // Guild Bank & Crafting/Consumable Requests
  upsertBankItem(item: GuildBankItem): Promise<GuildBankItem>;
  listBankItems(guildId: string, searchQuery?: string): Promise<GuildBankItem[]>;
  createRequestTicket(ticket: GuildRequestTicket): Promise<GuildRequestTicket>;
  getRequestTicket(guildId: string, requestId: string): Promise<GuildRequestTicket | null>;
  updateRequestTicketStatus(
    guildId: string,
    requestId: string,
    status: GuildRequestTicket['status'],
    actorUserId: string
  ): Promise<GuildRequestTicket | null>;
  listOpenRequestTickets(guildId: string): Promise<GuildRequestTicket[]>;
}
