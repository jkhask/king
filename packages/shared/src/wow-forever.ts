/**
 * World of Warcraft: Forever — Domain Model for Diminishing Returns (Alliance)
 *
 * Launch: November 4, 2026 | Opening Raid Wave: December 9, 2026
 */

export const GUILD_NAME = 'Diminishing Returns';
export const DEFAULT_FACTION = 'Alliance' as const;

export type Faction = 'Alliance' | 'Horde';

export const ALLIANCE_RACES = [
  'Human',
  'Dwarf',
  'Night Elf',
  'Gnome',
  'High Order Skyborne',
] as const;

export const HORDE_RACES = [
  'Orc',
  'Undead',
  'Tauren',
  'Troll',
  'Windshaper Skyborne',
] as const;

export const WOW_RACES = [...ALLIANCE_RACES, ...HORDE_RACES] as const;
export type WowRace = (typeof WOW_RACES)[number];
export type AllianceRace = (typeof ALLIANCE_RACES)[number];

export const WOW_CLASSES = [
  'Warrior',
  'Paladin',
  'Hunter',
  'Rogue',
  'Priest',
  'Shaman',
  'Mage',
  'Warlock',
  'Druid',
] as const;

export type WowClass = (typeof WOW_CLASSES)[number];

export const RAID_ROLES = ['Tank', 'Healer', 'Melee', 'Ranged'] as const;
export type RaidRole = (typeof RAID_ROLES)[number];

/**
 * Valid Race + Class combinations in World of Warcraft: Forever.
 * Includes the new Forever combinations:
 * - Human Hunter
 * - Dwarf Shaman
 * - Gnome Priest
 * - High Order Skyborne (Warrior, Hunter, Rogue, Druid, Mage)
 * - Undead Paladin, Orc Mage, Troll Warlock, Windshaper Skyborne (Warrior, Hunter, Rogue, Druid, Shaman)
 */
export const VALID_RACE_CLASSES: Record<WowRace, readonly WowClass[]> = {
  // Alliance
  Human: ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Mage', 'Warlock'],
  Dwarf: ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman'],
  'Night Elf': ['Warrior', 'Hunter', 'Rogue', 'Priest', 'Druid'],
  Gnome: ['Warrior', 'Rogue', 'Priest', 'Mage', 'Warlock'],
  'High Order Skyborne': ['Warrior', 'Hunter', 'Rogue', 'Mage', 'Druid'],

  // Horde
  Orc: ['Warrior', 'Hunter', 'Rogue', 'Shaman', 'Mage', 'Warlock'],
  Undead: ['Warrior', 'Paladin', 'Rogue', 'Priest', 'Mage', 'Warlock'],
  Tauren: ['Warrior', 'Hunter', 'Shaman', 'Druid'],
  Troll: ['Warrior', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock'],
  'Windshaper Skyborne': ['Warrior', 'Hunter', 'Rogue', 'Shaman', 'Druid'],
};

/**
 * Viable raid roles per class in World of Warcraft: Forever.
 * Note: Paladins and Druids have full tank/hybrid support in Forever, and Shamans are available on Alliance via Dwarves.
 */
export const CLASS_VIABLE_ROLES: Record<WowClass, readonly RaidRole[]> = {
  Warrior: ['Tank', 'Melee'],
  Paladin: ['Tank', 'Healer', 'Melee'],
  Hunter: ['Ranged', 'Melee'],
  Rogue: ['Melee'],
  Priest: ['Healer', 'Ranged'],
  Shaman: ['Healer', 'Melee', 'Ranged'],
  Mage: ['Ranged'],
  Warlock: ['Ranged'],
  Druid: ['Tank', 'Healer', 'Melee', 'Ranged'],
};

export const CLASS_COLORS: Record<WowClass, number> = {
  Warrior: 0xc79c6e,
  Paladin: 0xf58cba,
  Hunter: 0xabd473,
  Rogue: 0xfff569,
  Priest: 0xffffff,
  Shaman: 0x0070de,
  Mage: 0x40c7eb,
  Warlock: 0x8787ed,
  Druid: 0xff7d0a,
};

export const CLASS_ICONS: Record<WowClass, string> = {
  Warrior: '⚔️',
  Paladin: '🔨',
  Hunter: '🏹',
  Rogue: '🗡️',
  Priest: '✨',
  Shaman: '⚡',
  Mage: '❄️',
  Warlock: '🔮',
  Druid: '🐾',
};

export const ROLE_ICONS: Record<RaidRole, string> = {
  Tank: '🛡️',
  Healer: '💚',
  Melee: '⚔️',
  Ranged: '🎯',
};

export const PRIMARY_PROFESSIONS = [
  'Alchemy',
  'Blacksmithing',
  'Enchanting',
  'Engineering',
  'Herbalism',
  'Leatherworking',
  'Mining',
  'Skinning',
  'Tailoring',
] as const;

export type Profession = (typeof PRIMARY_PROFESSIONS)[number];

export interface RaidTemplate {
  id: string;
  name: string;
  size: 10 | 20 | 40;
  tier: string;
  description: string;
  recommendedRoles: {
    Tank: number;
    Healer: number;
    Melee: number;
    Ranged: number;
  };
}

/**
 * World of Warcraft: Forever Opening Raid Tier (Dec 9, 2026) & Classic+ Raids
 */
export const WOW_FOREVER_RAIDS: Record<string, RaidTemplate> = {
  'barrow-deeps': {
    id: 'barrow-deeps',
    name: 'Barrow Deeps',
    size: 10,
    tier: 'Tier 1 (Forever Launch)',
    description: '10-Player raid beneath Teldrassil & Hyjal roots.',
    recommendedRoles: { Tank: 2, Healer: 2, Melee: 3, Ranged: 3 },
  },
  'hyjal-summit': {
    id: 'hyjal-summit',
    name: 'Hyjal Summit',
    size: 20,
    tier: 'Tier 1 (Forever Launch)',
    description: '20-Player core guild progression raid on Mount Hyjal.',
    recommendedRoles: { Tank: 3, Healer: 5, Melee: 6, Ranged: 6 },
  },
  'onyxia-lair': {
    id: 'onyxia-lair',
    name: "Onyxia's Lair",
    size: 40,
    tier: 'Tier 1 (Forever Launch)',
    description: '40-Player classic dragon lair in Dustwallow Marsh.',
    recommendedRoles: { Tank: 3, Healer: 8, Melee: 14, Ranged: 15 },
  },
  'molten-core': {
    id: 'molten-core',
    name: 'Molten Core',
    size: 40,
    tier: 'Tier 1',
    description: '40-Player elemental raid deep within Blackrock Mountain.',
    recommendedRoles: { Tank: 4, Healer: 9, Melee: 13, Ranged: 14 },
  },
  custom: {
    id: 'custom',
    name: 'Custom Guild Event',
    size: 20,
    tier: 'Custom',
    description: 'Custom raid, world boss, or dungeon event.',
    recommendedRoles: { Tank: 2, Healer: 4, Melee: 7, Ranged: 7 },
  },
};

export const WOW_FOREVER_DUNGEONS = [
  'Hall of Thanes (Ironforge)',
  'Ruins of Lordaeron',
  'Excavation Site: Wetlands',
  'Blackrock Depths',
  'Stratholme',
  'Scholomance',
  'Dire Maul',
  'Lower Blackrock Spire',
  'Upper Blackrock Spire',
] as const;

export function isValidRaceClass(race: WowRace, wowClass: WowClass): boolean {
  const allowed = VALID_RACE_CLASSES[race];
  return Boolean(allowed && allowed.includes(wowClass));
}

export function isValidRoleForClass(wowClass: WowClass, role: RaidRole): boolean {
  const allowed = CLASS_VIABLE_ROLES[wowClass];
  return Boolean(allowed && allowed.includes(role));
}

export function isAllianceRace(race: WowRace): race is AllianceRace {
  return (ALLIANCE_RACES as readonly string[]).includes(race);
}

export function normalizeCharacterName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}
