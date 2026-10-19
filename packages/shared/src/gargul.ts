import { createHash } from 'node:crypto';
import { normalizeCharacterName } from './wow-forever.js';

export type LootSpecType = 'MS' | 'OS' | 'SR' | 'TMOG';

export interface ParsedLootAward {
  /** Deterministic deduplication ID derived from date + player + item */
  awardHash: string;
  characterName: string;
  itemName: string;
  itemId?: number;
  awardedAt: string; // ISO 8601 timestamp or YYYY-MM-DD
  specType: LootSpecType;
  raidInstance?: string;
  boss?: string;
  notes?: string;
}

export interface GargulParseResult {
  awards: ParsedLootAward[];
  skippedLines: number;
  errors: string[];
}

/**
 * Extracts itemId and itemName from a WoW item link like:
 * |cffa335ee|Hitem:18803:0:0:0:0:0:0:0:60|h[Finkle's Lava Dredger]|h|r
 * or [Band of Accuria]
 */
export function parseWowItemToken(raw: string): { itemId?: number; itemName: string } {
  const trimmed = raw.trim().replace(/^"|"$/g, '');

  const linkMatch = trimmed.match(/Hitem:(\d+)[^|]*\|h\[([^\]]+)\]/i);
  if (linkMatch) {
    return {
      itemId: Number.parseInt(linkMatch[1], 10),
      itemName: linkMatch[2].trim(),
    };
  }

  const bracketMatch = trimmed.match(/^\[([^\]]+)\]$/) || trimmed.match(/\[([^\]]+)\]/);
  if (bracketMatch) {
    const idPrefix = trimmed.match(/(\d{3,7})/);
    return {
      itemId: idPrefix ? Number.parseInt(idPrefix[1], 10) : undefined,
      itemName: bracketMatch[1].trim(),
    };
  }

  if (/^\d+$/.test(trimmed)) {
    const id = Number.parseInt(trimmed, 10);
    return {
      itemId: id,
      itemName: `Item #${id}`,
    };
  }

  return { itemName: trimmed };
}

function computeAwardHash(dateStr: string, characterName: string, itemKey: string): string {
  return createHash('sha256')
    .update(`${dateStr.slice(0, 16).toLowerCase()}|${characterName.toLowerCase()}|${itemKey.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
}

function normalizeDateToken(raw: string): string {
  const cleaned = raw.trim().replace(/^"|"$/g, '');
  if (!cleaned) return new Date().toISOString();
  // If unix timestamp (seconds or ms)
  if (/^\d{10}$/.test(cleaned)) {
    return new Date(Number.parseInt(cleaned, 10) * 1000).toISOString();
  }
  if (/^\d{13}$/.test(cleaned)) {
    return new Date(Number.parseInt(cleaned, 10)).toISOString();
  }
  // If YYYY-MM-DD HH:mm:ss or YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const parsed = new Date(cleaned.includes('T') ? cleaned : cleaned.replace(' ', 'T') + (cleaned.length === 10 ? 'T00:00:00Z' : 'Z'));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return cleaned;
}

function parseSpecType(raw?: string, offspecFlag?: string | boolean | number): LootSpecType {
  if (offspecFlag === true || offspecFlag === 1 || offspecFlag === '1' || String(offspecFlag).toLowerCase() === 'true') {
    return 'OS';
  }
  if (!raw) return 'MS';
  const upper = raw.trim().toUpperCase();
  if (upper.includes('OS') || upper.includes('OFF')) return 'OS';
  if (upper.includes('SR') || upper.includes('SOFT')) return 'SR';
  if (upper.includes('TMOG') || upper.includes('TRANSMOG')) return 'TMOG';
  return 'MS';
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses Gargul loot exports across common formats:
 * 1. JSON array or `{ items: [...] }` from Gargul JSON exports
 * 2. Header-based Gargul CSV/TSV (`dateTime,player,itemID,itemName,offspec,instance,boss...`)
 * 3. Headerless Gargul CSV/TSV (`YYYY-MM-DD,PlayerName,ItemID/ItemLink[,ItemName,RollType]`)
 */
export function parseGargulExport(input: string, defaultRaidInstance?: string): GargulParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { awards: [], skippedLines: 0, errors: ['Empty Gargul export input.'] };
  }

  // Strip optional markdown code fences if a user pasted ```csv ... ```
  const unfenced = trimmed
    .replace(/^```[a-zA-Z]*\r?\n/, '')
    .replace(/\r?\n```$/, '')
    .trim();

  // Check if JSON format
  if (unfenced.startsWith('[') || unfenced.startsWith('{')) {
    try {
      const parsed = JSON.parse(unfenced);
      const list: Record<string, unknown>[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.items)
          ? parsed.items
          : Array.isArray(parsed.loot)
            ? parsed.loot
            : Array.isArray(parsed.history)
              ? parsed.history
              : [];

      const awards: ParsedLootAward[] = [];
      let skippedLines = 0;

      for (const entry of list) {
        const rawPlayer = String(
          entry.player ?? entry.character ?? entry.winner ?? entry.awardedTo ?? ''
        ).split('-')[0]; // Strip realm suffix if present (e.g., Arthas-Forever)
        const characterName = normalizeCharacterName(rawPlayer);

        const rawItem = String(
          entry.itemLink ?? entry.itemName ?? entry.item ?? entry.itemID ?? entry.itemId ?? entry.item_id ?? ''
        );
        const { itemId: parsedId, itemName } = parseWowItemToken(rawItem);
        const explicitId = Number(entry.itemID ?? entry.itemId ?? entry.item_id);
        const itemId = !Number.isNaN(explicitId) && explicitId > 0 ? explicitId : parsedId;

        if (!characterName || (!itemName && !itemId)) {
          skippedLines++;
          continue;
        }

        const awardedAt = normalizeDateToken(
          String(entry.dateTime ?? entry.date ?? entry.timestamp ?? entry.time ?? new Date().toISOString())
        );
        const specType = parseSpecType(
          String(entry.rollType ?? entry.spec ?? entry.note ?? ''),
          entry.offspec as boolean | string | number | undefined
        );
        const finalItemName =
          itemName && !itemName.startsWith('Item #')
            ? itemName
            : entry.itemName
              ? String(entry.itemName)
              : itemName || `Item #${itemId}`;

        const awardHash = computeAwardHash(awardedAt, characterName, String(itemId ?? finalItemName));

        awards.push({
          awardHash,
          characterName,
          itemName: finalItemName,
          itemId,
          awardedAt,
          specType,
          raidInstance: String(entry.instance ?? entry.raid ?? defaultRaidInstance ?? '').trim() || undefined,
          boss: String(entry.boss ?? entry.source ?? '').trim() || undefined,
        });
      }

      return { awards: deduplicateAwards(awards), skippedLines, errors: [] };
    } catch (err) {
      return {
        awards: [],
        skippedLines: 0,
        errors: [`Failed to parse JSON Gargul export: ${(err as Error).message}`],
      };
    }
  }

  // Otherwise CSV / TSV / Semicolon line-based format
  const lines = unfenced
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) {
    return { awards: [], skippedLines: 0, errors: ['No loot lines found in input.'] };
  }

  // Detect delimiter from first line
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t')
    ? '\t'
    : firstLine.split(';').length > firstLine.split(',').length
      ? ';'
      : ',';

  const firstCols = splitCsvLine(firstLine, delimiter).map((c) => c.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  const hasHeader = firstCols.some((c) =>
    ['date', 'datetime', 'player', 'character', 'itemid', 'item_id', 'item', 'itemname', 'itemlink', 'winner'].includes(c)
  );

  let colMap: {
    date?: number;
    player?: number;
    itemId?: number;
    itemName?: number;
    offspec?: number;
    rollType?: number;
    instance?: number;
    boss?: number;
  } = {};

  let startIdx = 0;
  if (hasHeader) {
    startIdx = 1;
    firstCols.forEach((col, idx) => {
      if (['date', 'datetime', 'time', 'timestamp'].includes(col)) colMap.date = idx;
      else if (['player', 'playername', 'character', 'winner', 'awardedto'].includes(col)) colMap.player = idx;
      else if (['itemid', 'item_id', 'id'].includes(col)) colMap.itemId = idx;
      else if (['itemname', 'item_name', 'item', 'itemlink', 'link'].includes(col)) colMap.itemName = idx;
      else if (['offspec', 'os', 'isoffspec'].includes(col)) colMap.offspec = idx;
      else if (['rolltype', 'roll_type', 'spec', 'type', 'prio'].includes(col)) colMap.rollType = idx;
      else if (['instance', 'raid', 'zone'].includes(col)) colMap.instance = idx;
      else if (['boss', 'encounter', 'source'].includes(col)) colMap.boss = idx;
    });
  }

  const awards: ParsedLootAward[] = [];
  let skippedLines = 0;
  const errors: string[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delimiter);
    if (cols.length < 2) {
      skippedLines++;
      continue;
    }

    let rawDate = '';
    let rawPlayer = '';
    let rawItemId = '';
    let rawItemName = '';
    let rawOffspec = '';
    let rawRollType = '';
    let rawInstance = '';
    let rawBoss = '';

    if (hasHeader && colMap.player !== undefined) {
      rawDate = colMap.date !== undefined ? cols[colMap.date] ?? '' : '';
      rawPlayer = cols[colMap.player] ?? '';
      rawItemId = colMap.itemId !== undefined ? cols[colMap.itemId] ?? '' : '';
      rawItemName = colMap.itemName !== undefined ? cols[colMap.itemName] ?? '' : '';
      rawOffspec = colMap.offspec !== undefined ? cols[colMap.offspec] ?? '' : '';
      rawRollType = colMap.rollType !== undefined ? cols[colMap.rollType] ?? '' : '';
      rawInstance = colMap.instance !== undefined ? cols[colMap.instance] ?? '' : '';
      rawBoss = colMap.boss !== undefined ? cols[colMap.boss] ?? '' : '';
    } else {
      // Heuristic for headerless Gargul exports:
      // Common layout A: date, player, item_id/item_link [, item_name_or_roll_type, roll_type, instance]
      // Common layout B: player, item_id/item_link [, date]
      if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(cols[0]) || /^\d{10,13}$/.test(cols[0])) {
        rawDate = cols[0];
        rawPlayer = cols[1] ?? '';
        rawItemId = cols[2] ?? '';
        const col3 = (cols[3] ?? '').trim();
        if (/^(MS|OS|SR|TMOG|MAINSPEC|OFFSPEC|SOFTRES)$/i.test(col3)) {
          rawRollType = col3;
          rawInstance = cols[4] ?? '';
        } else {
          rawItemName = col3;
          rawRollType = cols[4] ?? '';
          rawInstance = cols[5] ?? '';
        }
      } else {
        rawPlayer = cols[0];
        rawItemId = cols[1] ?? '';
        rawItemName = cols[2] ?? '';
        rawDate = cols[3] ?? '';
      }
    }

    const cleanPlayer = normalizeCharacterName(rawPlayer.split('-')[0]);
    const idToken = parseWowItemToken(rawItemId);
    const nameToken = rawItemName ? parseWowItemToken(rawItemName) : { itemName: '' };

    const itemId = idToken.itemId ?? nameToken.itemId;
    const itemName =
      idToken.itemName && !idToken.itemName.startsWith('Item #')
        ? idToken.itemName
        : nameToken.itemName && !nameToken.itemName.startsWith('Item #')
          ? nameToken.itemName
          : idToken.itemName;

    if (!cleanPlayer || (!itemName && !itemId)) {
      skippedLines++;
      continue;
    }

    // Ignore disenchant / bank placeholder players if configured as _disenchanted
    if (['_disenchanted', 'disenchant', 'guildbank'].includes(cleanPlayer.toLowerCase())) {
      skippedLines++;
      continue;
    }

    const awardedAt = normalizeDateToken(rawDate);
    const specType = parseSpecType(rawRollType, rawOffspec);
    const awardHash = computeAwardHash(awardedAt, cleanPlayer, String(itemId ?? itemName));

    awards.push({
      awardHash,
      characterName: cleanPlayer,
      itemName: itemName || `Item #${itemId}`,
      itemId,
      awardedAt,
      specType,
      raidInstance: (rawInstance || defaultRaidInstance || '').trim() || undefined,
      boss: rawBoss.trim() || undefined,
    });
  }

  return {
    awards: deduplicateAwards(awards),
    skippedLines,
    errors,
  };
}

function deduplicateAwards(awards: ParsedLootAward[]): ParsedLootAward[] {
  const seen = new Set<string>();
  const unique: ParsedLootAward[] = [];
  for (const award of awards) {
    if (!seen.has(award.awardHash)) {
      seen.add(award.awardHash);
      unique.push(award);
    }
  }
  return unique;
}
