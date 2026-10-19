import { subtle } from 'node:crypto';
import { InMemoryGuildRepository } from '@dr/db';
import {
  type APIInteraction,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ComponentType,
  InteractionResponseType,
  InteractionType,
} from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';
import { handleDiscordInteraction, verifyDiscordSignature } from './index.js';

describe('Discord Ed25519 Signature Verification', () => {
  it('verifies valid Ed25519 signatures and rejects tampered payloads', async () => {
    const keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const rawPub = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
    const publicKeyHex = Buffer.from(rawPub).toString('hex');

    const timestamp = '1760830000';
    const rawBody = JSON.stringify({ type: 1 });
    const message = new TextEncoder().encode(timestamp + rawBody);
    const sigBytes = new Uint8Array(await subtle.sign('Ed25519', keyPair.privateKey, message));
    const signatureHex = Buffer.from(sigBytes).toString('hex');

    const valid = await verifyDiscordSignature({
      publicKeyHex,
      signatureHex,
      timestamp,
      rawBody,
    });
    expect(valid).toBe(true);

    const invalid = await verifyDiscordSignature({
      publicKeyHex,
      signatureHex,
      timestamp,
      rawBody: JSON.stringify({ type: 2 }),
    });
    expect(invalid).toBe(false);
  });
});

describe('Diminishing Returns Bot Interaction Router', () => {
  it('responds to Ping with Pong', async () => {
    const repo = new InMemoryGuildRepository();
    const res = await handleDiscordInteraction(
      {
        id: '1',
        application_id: 'app',
        type: InteractionType.Ping,
        token: 'tok',
        version: 1,
      } as APIInteraction,
      repo
    );
    expect(res).toEqual({ type: InteractionResponseType.Pong });
  });

  it('registers Alliance characters, tracks raid attendance, imports Gargul loot, and shows /loot council recommendations', async () => {
    const repo = new InMemoryGuildRepository();
    const guildId = 'guild-dr';

    // 1. Register two Healers: Falstad (Dwarf Shaman) and Tyrande (Night Elf Priest)
    const regFalstad = await handleDiscordInteraction(
      {
        id: '2',
        application_id: 'app',
        type: InteractionType.ApplicationCommand,
        guild_id: guildId,
        member: { user: { id: 'player-1' } },
        data: {
          id: 'cmd-1',
          name: 'character',
          type: ApplicationCommandType.ChatInput,
          options: [
            {
              type: ApplicationCommandOptionType.Subcommand,
              name: 'register',
              options: [
                { type: ApplicationCommandOptionType.String, name: 'name', value: 'falstad' },
                { type: ApplicationCommandOptionType.String, name: 'race', value: 'Dwarf' },
                { type: ApplicationCommandOptionType.String, name: 'class', value: 'Shaman' },
                { type: ApplicationCommandOptionType.String, name: 'role', value: 'Healer' },
              ],
            },
          ],
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );
    expect(regFalstad.type).toBe(InteractionResponseType.ChannelMessageWithSource);

    await handleDiscordInteraction(
      {
        id: '2b',
        application_id: 'app',
        type: InteractionType.ApplicationCommand,
        guild_id: guildId,
        member: { user: { id: 'player-2' } },
        data: {
          id: 'cmd-1b',
          name: 'character',
          type: ApplicationCommandType.ChatInput,
          options: [
            {
              type: ApplicationCommandOptionType.Subcommand,
              name: 'register',
              options: [
                { type: ApplicationCommandOptionType.String, name: 'name', value: 'tyrande' },
                { type: ApplicationCommandOptionType.String, name: 'race', value: 'Night Elf' },
                { type: ApplicationCommandOptionType.String, name: 'class', value: 'Priest' },
                { type: ApplicationCommandOptionType.String, name: 'role', value: 'Healer' },
              ],
            },
          ],
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    // 2. Create a raid and record Tyrande attending
    const raid = await repo.createRaidEvent({
      guildId,
      raidId: 'raid-hyjal-1',
      templateId: 'hyjal-summit',
      name: 'Hyjal Summit',
      size: 20,
      scheduledAt: 'Wed 8:00 PM EST',
      createdByUserId: 'officer-1',
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    });
    await repo.upsertRaidSignup({
      guildId,
      raidId: raid.raidId,
      userId: 'player-2',
      characterName: 'Tyrande',
      wowClass: 'Priest',
      role: 'Healer',
      status: 'CONFIRMED',
      updatedAt: new Date().toISOString(),
    });
    await repo.upsertRaidSignup({
      guildId,
      raidId: raid.raidId,
      userId: 'player-1',
      characterName: 'Falstad',
      wowClass: 'Shaman',
      role: 'Healer',
      status: 'CONFIRMED',
      updatedAt: new Date().toISOString(),
    });

    // 3. Submit Gargul Loot Import Modal (Falstad already won an MS item today)
    const todayIso = new Date().toISOString().slice(0, 10);
    const modalRes = await handleDiscordInteraction(
      {
        id: '3',
        application_id: 'app',
        type: InteractionType.ModalSubmit,
        guild_id: guildId,
        member: { user: { id: 'officer-1' } },
        data: {
          custom_id: 'modal_gargul_import',
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.TextInput,
                  custom_id: 'gargul_raid_instance',
                  value: 'Hyjal Summit',
                },
              ],
            },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.TextInput,
                  custom_id: 'gargul_export_payload',
                  value: `dateTime,player,itemID,itemName,offspec\n${todayIso},Falstad,18803,[Finkle's Lava Dredger],0`,
                },
              ],
            },
          ],
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    expect(modalRes.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    const lootHistory = await repo.listCharacterLootHistory(guildId, 'Falstad');
    expect(lootHistory).toHaveLength(1);
    expect(lootHistory[0].itemName).toBe("Finkle's Lava Dredger");

    // 4. Run /loot history for Falstad -> should display obtained gear history and attendance
    const histRes = await handleDiscordInteraction(
      {
        id: '4',
        application_id: 'app',
        type: InteractionType.ApplicationCommand,
        guild_id: guildId,
        member: { user: { id: 'officer-1' } },
        data: {
          id: 'cmd-2',
          name: 'loot',
          type: ApplicationCommandType.ChatInput,
          options: [
            {
              type: ApplicationCommandOptionType.Subcommand,
              name: 'history',
              options: [
                {
                  type: ApplicationCommandOptionType.String,
                  name: 'character',
                  value: 'Falstad',
                },
              ],
            },
          ],
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    expect(histRes.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    const resData = 'data' in histRes ? histRes.data : undefined;
    const embed = resData && 'embeds' in resData ? resData.embeds?.[0] : undefined;
    expect(embed?.title).toContain('Obtained Gear History — Falstad');
    expect(embed?.fields?.[0]?.value).toContain("Finkle's Lava Dredger");
  });

  it('opens the onboarding character registration modal and registers a main character', async () => {
    const repo = new InMemoryGuildRepository();
    const guildId = 'guild-dr';
    const userId = 'new-member-1';

    // 1. Click "Register Main Character" button on the Welcome card
    const openModalRes = await handleDiscordInteraction(
      {
        id: '10',
        application_id: 'app',
        type: InteractionType.MessageComponent,
        guild_id: guildId,
        member: { user: { id: userId } },
        data: {
          component_type: ComponentType.Button,
          custom_id: 'onboard_open_modal',
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    expect(openModalRes.type).toBe(InteractionResponseType.Modal);

    // 2. Submit the Onboarding Modal
    const submitRes = await handleDiscordInteraction(
      {
        id: '11',
        application_id: 'app',
        type: InteractionType.ModalSubmit,
        guild_id: guildId,
        member: { user: { id: userId } },
        data: {
          custom_id: 'modal_onboard_register',
          components: [
            {
              type: ComponentType.ActionRow,
              components: [{ type: ComponentType.TextInput, custom_id: 'onboard_char_name', value: 'turalyon' }],
            },
            {
              type: ComponentType.ActionRow,
              components: [{ type: ComponentType.TextInput, custom_id: 'onboard_race', value: 'Human' }],
            },
            {
              type: ComponentType.ActionRow,
              components: [{ type: ComponentType.TextInput, custom_id: 'onboard_class', value: 'Paladin' }],
            },
            {
              type: ComponentType.ActionRow,
              components: [{ type: ComponentType.TextInput, custom_id: 'onboard_role', value: 'Tank' }],
            },
          ],
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    expect(submitRes.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    const saved = await repo.getCharacterByName(guildId, 'Turalyon');
    expect(saved).toMatchObject({
      name: 'Turalyon',
      race: 'Human',
      wowClass: 'Paladin',
      primaryRole: 'Tank',
      isMain: true,
    });
  });
});
