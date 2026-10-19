import { describe, expect, it } from 'vitest';
import {
  isAllianceRace,
  isValidRaceClass,
  isValidRoleForClass,
  normalizeCharacterName,
  parseGargulExport,
  parseWowItemToken,
  WOW_FOREVER_RAIDS,
} from './index.js';

describe('WoW: Forever Domain Model (Alliance)', () => {
  it('supports new WoW: Forever Alliance race/class combinations', () => {
    expect(isValidRaceClass('Dwarf', 'Shaman')).toBe(true);
    expect(isValidRaceClass('Human', 'Hunter')).toBe(true);
    expect(isValidRaceClass('Gnome', 'Priest')).toBe(true);
    expect(isValidRaceClass('High Order Skyborne', 'Mage')).toBe(true);
    expect(isValidRaceClass('High Order Skyborne', 'Druid')).toBe(true);
    expect(isValidRaceClass('High Order Skyborne', 'Shaman')).toBe(false); // Windshaper (Horde) exclusive
  });

  it('validates Alliance races and hybrid roles', () => {
    expect(isAllianceRace('High Order Skyborne')).toBe(true);
    expect(isAllianceRace('Windshaper Skyborne')).toBe(false);
    expect(isValidRoleForClass('Paladin', 'Tank')).toBe(true);
    expect(isValidRoleForClass('Druid', 'Tank')).toBe(true);
    expect(isValidRoleForClass('Shaman', 'Melee')).toBe(true);
  });

  it('includes opening raid tier templates (10, 20, 40)', () => {
    expect(WOW_FOREVER_RAIDS['barrow-deeps'].size).toBe(10);
    expect(WOW_FOREVER_RAIDS['hyjal-summit'].size).toBe(20);
    expect(WOW_FOREVER_RAIDS['onyxia-lair'].size).toBe(40);
  });

  it('normalizes character names properly', () => {
    expect(normalizeCharacterName('  aRTHAS ')).toBe('Arthas');
  });
});

describe('Gargul Loot Export Parser', () => {
  it('parses WoW item links and brackets', () => {
    const link = parseWowItemToken('|cffa335ee|Hitem:18803:0:0:0:0:0:0:0:60|h[Finkle\'s Lava Dredger]|h|r');
    expect(link).toEqual({ itemId: 18803, itemName: "Finkle's Lava Dredger" });

    const bracket = parseWowItemToken('[Band of Accuria]');
    expect(bracket).toEqual({ itemId: undefined, itemName: 'Band of Accuria' });
  });

  it('parses standard Gargul CSV exports with headers', () => {
    const csv = `dateTime,player,itemID,itemName,offspec,instance,boss
2026-12-10 20:15:00,magni-forever,18803,"[Finkle's Lava Dredger]",0,"Hyjal Summit","Archimonde Vanguard"
2026-12-10 20:45:00,Tyrande,19140,"Cauterizing Band",1,"Hyjal Summit","Anetheron"`;

    const res = parseGargulExport(csv);
    expect(res.errors).toHaveLength(0);
    expect(res.awards).toHaveLength(2);
    expect(res.awards[0]).toMatchObject({
      characterName: 'Magni',
      itemId: 18803,
      itemName: "Finkle's Lava Dredger",
      specType: 'MS',
      raidInstance: 'Hyjal Summit',
      boss: 'Archimonde Vanguard',
    });
    expect(res.awards[1]).toMatchObject({
      characterName: 'Tyrande',
      itemId: 19140,
      itemName: 'Cauterizing Band',
      specType: 'OS',
    });
  });

  it('parses headerless Gargul CSV lines and deduplicates identical entries', () => {
    const raw = `
2026-12-11,Bolvar,|cffa335ee|Hitem:16866:0:0:0|h[Helm of Might]|h|r,MS
2026-12-11,Bolvar,|cffa335ee|Hitem:16866:0:0:0|h[Helm of Might]|h|r,MS
2026-12-11,Jaina,16795,[Arcanist Crown],SR
`;
    const res = parseGargulExport(raw, 'Barrow Deeps');
    expect(res.awards).toHaveLength(2);
    expect(res.awards[0]).toMatchObject({
      characterName: 'Bolvar',
      itemId: 16866,
      itemName: 'Helm of Might',
      raidInstance: 'Barrow Deeps',
    });
    expect(res.awards[1]).toMatchObject({
      characterName: 'Jaina',
      itemId: 16795,
      itemName: 'Arcanist Crown',
      specType: 'SR',
    });
  });

  it('parses Gargul JSON exports', () => {
    const json = JSON.stringify([
      {
        dateTime: '2026-12-12T21:00:00Z',
        player: 'Muradin',
        itemID: 17068,
        itemName: "Deathbringer",
        offspec: false,
        instance: "Onyxia's Lair",
      },
    ]);
    const res = parseGargulExport(json);
    expect(res.awards).toHaveLength(1);
    expect(res.awards[0].characterName).toBe('Muradin');
    expect(res.awards[0].itemId).toBe(17068);
    expect(res.awards[0].itemName).toBe('Deathbringer');
  });
});
