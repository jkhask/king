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

  it('registers an Alliance character, imports Gargul loot via Modal, and runs Loot Council deliberation', async () => {
    const repo = new InMemoryGuildRepository();
    const guildId = 'guild-dr';
    const userId = 'player-1';

    // 1. Register a Dwarf Shaman (new WoW: Forever Alliance combo)
    const regRes = await handleDiscordInteraction(
      {
        id: '2',
        application_id: 'app',
        type: InteractionType.ApplicationCommand,
        guild_id: guildId,
        member: { user: { id: userId } },
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

    expect(regRes.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    const char = await repo.getCharacterByName(guildId, 'Falstad');
    expect(char?.wowClass).toBe('Shaman');

    // 2. Submit Gargul Loot Import Modal
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
                  value:
                    'dateTime,player,itemID,itemName,offspec\n2026-12-10,Falstad,18803,[Finkle\'s Lava Dredger],0',
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

    // 3. Start a Loot Council session for a new drop
    const lcStartRes = await handleDiscordInteraction(
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
              name: 'council',
              options: [
                {
                  type: ApplicationCommandOptionType.String,
                  name: 'item',
                  value: '[Rejuvenating Gem]',
                },
                {
                  type: ApplicationCommandOptionType.String,
                  name: 'raid',
                  value: 'Hyjal Summit',
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

    expect(lcStartRes.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    const footerText =
      'data' in lcStartRes && lcStartRes.data && 'embeds' in lcStartRes.data
        ? lcStartRes.data.embeds?.[0]?.footer?.text ?? ''
        : '';
    const sessionMatch = footerText.match(/Session ID: (lc-[a-f0-9]+)/);
    expect(sessionMatch).toBeTruthy();
    const sessionId = sessionMatch![1];

    // 4. Player clicks "Main Spec / Big Upgrade" button on the Loot Council embed
    const btnRes = await handleDiscordInteraction(
      {
        id: '5',
        application_id: 'app',
        type: InteractionType.MessageComponent,
        guild_id: guildId,
        member: { user: { id: userId } },
        data: {
          component_type: ComponentType.Button,
          custom_id: `lc_interest:${sessionId}:BIG_UPGRADE`,
        },
        token: 'tok',
        version: 1,
      } as unknown as APIInteraction,
      repo
    );

    expect(btnRes.type).toBe(InteractionResponseType.UpdateMessage);
    const updatedEmbed =
      'data' in btnRes && btnRes.data && 'embeds' in btnRes.data
        ? btnRes.data.embeds?.[0]
        : undefined;
    expect(updatedEmbed?.fields?.[0]?.name).toContain('Falstad');
    expect(updatedEmbed?.fields?.[0]?.value).toContain("Finkle's Lava Dredger");
  });
});
