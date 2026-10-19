import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { type LootSpecType, normalizeCharacterName } from '@dr/shared';
import { buildCandidateLootSummaries } from './summary-helper.js';
import type {
  CandidateLootSummary,
  GuildBankItem,
  GuildCharacter,
  GuildRepository,
  GuildRequestTicket,
  LootCouncilCandidateInterest,
  LootCouncilSession,
  ObtainedGearAward,
  RaidEvent,
  RaidSignup,
} from './types.js';

/**
 * Single-Table DynamoDB Layout (`DiminishingReturnsTable`):
 *
 * Partition Key: `pk` (String)
 * Sort Key: `sk` (String)
 * GSI1: `gsi1pk` (String), `gsi1sk` (String)
 *
 * Entities:
 * - Character:
 *   pk: `GUILD#<guildId>`
 *   sk: `CHAR#<charNameLower>`
 *   gsi1pk: `USER#<guildId>#<userId>`
 *   gsi1sk: `CHAR#<charNameLower>`
 *
 * - RaidEvent:
 *   pk: `GUILD#<guildId>`
 *   sk: `RAID#<raidId>`
 *   gsi1pk: `RAID_LIST#<guildId>`
 *   gsi1sk: `<createdAt>#<raidId>`
 *
 * - RaidSignup:
 *   pk: `RAID#<guildId>#<raidId>`
 *   sk: `SIGNUP#<userId>`
 *   gsi1pk: `USER_SIGNUP#<guildId>#<userId>`
 *   gsi1sk: `RAID#<raidId>`
 *
 * - ObtainedGearAward (Loot History):
 *   pk: `GUILD#<guildId>`
 *   sk: `AWARD#<charNameLower>#<awardedAt>#<awardHash>`
 *   gsi1pk: `GUILD_AWARDS#<guildId>`
 *   gsi1sk: `AWARD#<awardedAt>#<awardHash>`
 *   (Plus a deduplication sentinel at pk: `GUILD#<guildId>`, sk: `AWARD_HASH#<awardHash>`)
 *
 * - LootCouncilSession:
 *   pk: `GUILD#<guildId>`
 *   sk: `LC#<sessionId>`
 *
 * - GuildBankItem:
 *   pk: `GUILD#<guildId>`
 *   sk: `BANK#<category>#<itemNameLower>`
 *
 * - GuildRequestTicket:
 *   pk: `GUILD#<guildId>`
 *   sk: `REQ#<requestId>`
 */
export class DynamoGuildRepository implements GuildRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options?: { tableName?: string; client?: DynamoDBDocumentClient }) {
    this.tableName = options?.tableName ?? process.env.DR_TABLE_NAME ?? 'DiminishingReturnsTable';
    if (options?.client) {
      this.docClient = options.client;
    } else {
      const baseClient = new DynamoDBClient({});
      this.docClient = DynamoDBDocumentClient.from(baseClient, {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      });
    }
  }

  async upsertCharacter(char: GuildCharacter): Promise<GuildCharacter> {
    const normalizedName = normalizeCharacterName(char.name);
    const updated: GuildCharacter = {
      ...char,
      name: normalizedName,
    };

    if (updated.isMain) {
      const existingChars = await this.listUserCharacters(updated.guildId, updated.userId);
      for (const existing of existingChars) {
        if (existing.isMain && existing.name.toLowerCase() !== normalizedName.toLowerCase()) {
          await this.putCharacterItem({ ...existing, isMain: false });
        }
      }
    }

    await this.putCharacterItem(updated);
    return updated;
  }

  private async putCharacterItem(char: GuildCharacter): Promise<void> {
    const lower = char.name.toLowerCase();
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `GUILD#${char.guildId}`,
          sk: `CHAR#${lower}`,
          gsi1pk: `USER#${char.guildId}#${char.userId}`,
          gsi1sk: `CHAR#${lower}`,
          entityType: 'CHARACTER',
          ...char,
        },
      })
    );
  }

  async getCharacterByName(guildId: string, characterName: string): Promise<GuildCharacter | null> {
    const lower = characterName.trim().toLowerCase();
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `GUILD#${guildId}`,
          sk: `CHAR#${lower}`,
        },
      })
    );
    return (res.Item as GuildCharacter | undefined) ?? null;
  }

  async listUserCharacters(guildId: string, userId: string): Promise<GuildCharacter[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${guildId}#${userId}`,
          ':sk': 'CHAR#',
        },
      })
    );
    const items = (res.Items ?? []) as GuildCharacter[];
    return items.sort((a, b) => (a.isMain === b.isMain ? a.name.localeCompare(b.name) : a.isMain ? -1 : 1));
  }

  async listGuildCharacters(guildId: string): Promise<GuildCharacter[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GUILD#${guildId}`,
          ':sk': 'CHAR#',
        },
      })
    );
    const items = (res.Items ?? []) as GuildCharacter[];
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteCharacter(guildId: string, userId: string, characterName: string): Promise<boolean> {
    const existing = await this.getCharacterByName(guildId, characterName);
    if (!existing || existing.userId !== userId) return false;
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: `GUILD#${guildId}`,
          sk: `CHAR#${characterName.trim().toLowerCase()}`,
        },
      })
    );
    return true;
  }

  async createRaidEvent(raid: RaidEvent): Promise<RaidEvent> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `GUILD#${raid.guildId}`,
          sk: `RAID#${raid.raidId}`,
          gsi1pk: `RAID_LIST#${raid.guildId}`,
          gsi1sk: `${raid.createdAt}#${raid.raidId}`,
          entityType: 'RAID',
          ...raid,
        },
      })
    );
    return raid;
  }

  async getRaidEvent(guildId: string, raidId: string): Promise<RaidEvent | null> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `GUILD#${guildId}`,
          sk: `RAID#${raidId}`,
        },
      })
    );
    return (res.Item as RaidEvent | undefined) ?? null;
  }

  async listRaidEvents(guildId: string, limit = 10): Promise<RaidEvent[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `RAID_LIST#${guildId}`,
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    );
    return (res.Items ?? []) as RaidEvent[];
  }

  async updateRaidStatus(
    guildId: string,
    raidId: string,
    status: RaidEvent['status']
  ): Promise<RaidEvent | null> {
    const existing = await this.getRaidEvent(guildId, raidId);
    if (!existing) return null;
    const updated: RaidEvent = { ...existing, status };
    await this.createRaidEvent(updated);
    return updated;
  }

  async upsertRaidSignup(signup: RaidSignup): Promise<RaidSignup> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `RAID#${signup.guildId}#${signup.raidId}`,
          sk: `SIGNUP#${signup.userId}`,
          gsi1pk: `USER_SIGNUP#${signup.guildId}#${signup.userId}`,
          gsi1sk: `RAID#${signup.raidId}`,
          entityType: 'SIGNUP',
          ...signup,
        },
      })
    );
    return signup;
  }

  async listRaidSignups(guildId: string, raidId: string): Promise<RaidSignup[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `RAID#${guildId}#${raidId}`,
          ':sk': 'SIGNUP#',
        },
      })
    );
    const items = (res.Items ?? []) as RaidSignup[];
    return items.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  async listUserSignups(guildId: string, userId: string): Promise<RaidSignup[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER_SIGNUP#${guildId}#${userId}`,
          ':sk': 'RAID#',
        },
      })
    );
    return (res.Items ?? []) as RaidSignup[];
  }

  async recordLootAwards(
    awards: ObtainedGearAward[]
  ): Promise<{ inserted: number; skippedDuplicates: number }> {
    let inserted = 0;
    let skippedDuplicates = 0;

    for (const rawAward of awards) {
      const award: ObtainedGearAward = {
        ...rawAward,
        characterName: normalizeCharacterName(rawAward.characterName),
      };
      const charLower = award.characterName.toLowerCase();

      // Check deduplication sentinel item first
      const hashKey = {
        pk: `GUILD#${award.guildId}`,
        sk: `AWARD_HASH#${award.awardHash}`,
      };
      const existing = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: hashKey,
        })
      );

      if (existing.Item) {
        skippedDuplicates++;
        continue;
      }

      // Write hash sentinel and primary award record
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...hashKey,
            entityType: 'AWARD_HASH',
            awardHash: award.awardHash,
            characterName: award.characterName,
            awardedAt: award.awardedAt,
          },
        })
      );

      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: `GUILD#${award.guildId}`,
            sk: `AWARD#${charLower}#${award.awardedAt}#${award.awardHash}`,
            gsi1pk: `GUILD_AWARDS#${award.guildId}`,
            gsi1sk: `AWARD#${award.awardedAt}#${award.awardHash}`,
            entityType: 'LOOT_AWARD',
            ...award,
          },
        })
      );
      inserted++;
    }

    return { inserted, skippedDuplicates };
  }

  async listCharacterLootHistory(
    guildId: string,
    characterName: string,
    limit = 25
  ): Promise<ObtainedGearAward[]> {
    const charLower = characterName.trim().toLowerCase();
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GUILD#${guildId}`,
          ':sk': `AWARD#${charLower}#`,
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    );
    return (res.Items ?? []) as ObtainedGearAward[];
  }

  async listGuildLootHistory(guildId: string, limit = 30): Promise<ObtainedGearAward[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GUILD_AWARDS#${guildId}`,
          ':sk': 'AWARD#',
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    );
    return (res.Items ?? []) as ObtainedGearAward[];
  }

  async getCandidateLootSummaries(
    guildId: string,
    characterNames: string[]
  ): Promise<CandidateLootSummary[]> {
    return buildCandidateLootSummaries(this, guildId, characterNames);
  }

  async createLootCouncilSession(session: LootCouncilSession): Promise<LootCouncilSession> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `GUILD#${session.guildId}`,
          sk: `LC#${session.sessionId}`,
          entityType: 'LC_SESSION',
          ...session,
        },
      })
    );
    return session;
  }

  async getLootCouncilSession(
    guildId: string,
    sessionId: string
  ): Promise<LootCouncilSession | null> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `GUILD#${guildId}`,
          sk: `LC#${sessionId}`,
        },
      })
    );
    return (res.Item as LootCouncilSession | undefined) ?? null;
  }

  async upsertLootCouncilCandidate(
    guildId: string,
    sessionId: string,
    candidate: LootCouncilCandidateInterest
  ): Promise<LootCouncilSession | null> {
    const session = await this.getLootCouncilSession(guildId, sessionId);
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
    await this.createLootCouncilSession(updated);
    return updated;
  }

  async castLootCouncilVote(
    guildId: string,
    sessionId: string,
    officerUserId: string,
    candidateCharacterName: string
  ): Promise<LootCouncilSession | null> {
    const session = await this.getLootCouncilSession(guildId, sessionId);
    if (!session || session.status !== 'OPEN') return null;

    const updated: LootCouncilSession = {
      ...session,
      votes: {
        ...session.votes,
        [officerUserId]: normalizeCharacterName(candidateCharacterName),
      },
    };
    await this.createLootCouncilSession(updated);
    return updated;
  }

  async resolveLootCouncilSession(
    guildId: string,
    sessionId: string,
    winnerCharacterName: string,
    specType: LootSpecType,
    awardedByUserId: string
  ): Promise<{ session: LootCouncilSession; award: ObtainedGearAward } | null> {
    const session = await this.getLootCouncilSession(guildId, sessionId);
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
    await this.createLootCouncilSession(updated);
    return { session: updated, award };
  }

  async upsertBankItem(item: GuildBankItem): Promise<GuildBankItem> {
    const key = {
      pk: `GUILD#${item.guildId}`,
      sk: `BANK#${item.category}#${item.itemName.toLowerCase()}`,
    };
    if (item.quantity <= 0) {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: key,
        })
      );
      return { ...item, quantity: 0 };
    }
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...key,
          entityType: 'BANK_ITEM',
          ...item,
        },
      })
    );
    return item;
  }

  async listBankItems(guildId: string, searchQuery?: string): Promise<GuildBankItem[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GUILD#${guildId}`,
          ':sk': 'BANK#',
        },
      })
    );
    const queryLower = searchQuery?.trim().toLowerCase();
    const items = (res.Items ?? []) as GuildBankItem[];
    return items
      .filter((item) => {
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
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `GUILD#${ticket.guildId}`,
          sk: `REQ#${ticket.requestId}`,
          entityType: 'REQUEST_TICKET',
          ...ticket,
        },
      })
    );
    return ticket;
  }

  async getRequestTicket(guildId: string, requestId: string): Promise<GuildRequestTicket | null> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `GUILD#${guildId}`,
          sk: `REQ#${requestId}`,
        },
      })
    );
    return (res.Item as GuildRequestTicket | undefined) ?? null;
  }

  async updateRequestTicketStatus(
    guildId: string,
    requestId: string,
    status: GuildRequestTicket['status'],
    actorUserId: string
  ): Promise<GuildRequestTicket | null> {
    const existing = await this.getRequestTicket(guildId, requestId);
    if (!existing) return null;
    const updated: GuildRequestTicket = {
      ...existing,
      status,
      claimedByUserId: status === 'CLAIMED' ? actorUserId : existing.claimedByUserId,
      updatedAt: new Date().toISOString(),
    };
    await this.createRequestTicket(updated);
    return updated;
  }

  async listOpenRequestTickets(guildId: string): Promise<GuildRequestTicket[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GUILD#${guildId}`,
          ':sk': 'REQ#',
        },
      })
    );
    const items = (res.Items ?? []) as GuildRequestTicket[];
    return items
      .filter((r) => r.status === 'OPEN' || r.status === 'CLAIMED')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
