import { subtle } from 'node:crypto';
import { InMemoryGuildRepository } from '@dr/db';
import {
  type APIInteraction,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';
import { handleDiscordInteraction, SLASH_COMMANDS, verifyDiscordSignature } from './index.js';

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
  it('exposes only /raid and /loot slash commands', () => {
    expect(SLASH_COMMANDS.map((c) => c.name)).toEqual(['raid', 'loot']);
  });

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

  it('restricts /raid commands to members with the Council role while allowing all members to sign up via buttons', async () => {
    const repo = new InMemoryGuildRepository();
    const guildId = 'guild-dr';

    // 1. Non-Council member attempts /raid create -> rejected
    const unauthorizedRes = await handleDiscordInteraction(
      {
        id: '2',
        application_id: 'app',
        type: InteractionType.ApplicationCommand,
        guild_id: guildId,
        member: {
          nick: 'Falstad',
          roles: ['Shaman'],
          user: { id: 'player-1', username: 'falstad_user' },
        },
        data: {
          id: 'cmd-raid',
          name: 'raid',
          type: ApplicationCommandType.ChatInput,
          options: [
            {
              type: ApplicationCommandOptionType.Subcommand,
              name: 'create',
              options: [
                { type: ApplicationCommandOptionType.String, name: 'template', value: 'hyjal-summit' },
                { type: ApplicationCommandOptionType.String, name: 'schedule', value: 'Wed 8:00 PM EST' },
              ],
            },
          ],
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    expect(unauthorizedRes.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    const unauthData = 'data' in unauthorizedRes ? unauthorizedRes.data : undefined;
    expect(unauthData && 'flags' in unauthData ? unauthData.flags : undefined).toBe(MessageFlags.Ephemeral);
    expect(unauthData && 'content' in unauthData ? unauthData.content : '').toContain('Council');

    // 2. Council member runs /raid create -> succeeds
    const createRes = await handleDiscordInteraction(
      {
        id: '3',
        application_id: 'app',
        type: InteractionType.ApplicationCommand,
        guild_id: guildId,
        member: {
          nick: 'Bolvar',
          roles: ['Council', 'Paladin'],
          user: { id: 'officer-1', username: 'bolvar_user' },
        },
        data: {
          id: 'cmd-raid',
          name: 'raid',
          type: ApplicationCommandType.ChatInput,
          options: [
            {
              type: ApplicationCommandOptionType.Subcommand,
              name: 'create',
              options: [
                { type: ApplicationCommandOptionType.String, name: 'template', value: 'hyjal-summit' },
                { type: ApplicationCommandOptionType.String, name: 'schedule', value: 'Wed 8:00 PM EST' },
              ],
            },
          ],
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    expect(createRes.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    const raids = await repo.listRaidEvents(guildId);
    expect(raids).toHaveLength(1);
    const raidId = raids[0].raidId;

    // 3. Non-Council member clicks Healer signup button -> signs up using Discord nick + Carl-bot class role
    const signupRes = await handleDiscordInteraction(
      {
        id: '4',
        application_id: 'app',
        type: InteractionType.MessageComponent,
        guild_id: guildId,
        member: {
          nick: 'falstad',
          roles: ['Shaman'],
          user: { id: 'player-1', username: 'falstad_user' },
        },
        data: {
          component_type: ComponentType.Button,
          custom_id: `raid_signup:${raidId}:Healer`,
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    expect(signupRes.type).toBe(InteractionResponseType.UpdateMessage);
    const signups = await repo.listRaidSignups(guildId, raidId);
    expect(signups).toHaveLength(1);
    expect(signups[0]).toMatchObject({
      userId: 'player-1',
      characterName: 'Falstad',
      wowClass: 'Shaman',
      role: 'Healer',
      status: 'CONFIRMED',
    });
  });

  it('imports Gargul loot and displays /loot history with attendance stats', async () => {
    const repo = new InMemoryGuildRepository();
    const guildId = 'guild-dr';

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
      userId: 'player-1',
      characterName: 'Falstad',
      wowClass: 'Shaman',
      role: 'Healer',
      status: 'CONFIRMED',
      updatedAt: new Date().toISOString(),
    });

    // Submit Gargul Loot Import Modal
    const todayIso = new Date().toISOString().slice(0, 10);
    const modalRes = await handleDiscordInteraction(
      {
        id: '5',
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

    // Run /loot history for Falstad
    const histRes = await handleDiscordInteraction(
      {
        id: '6',
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
});

