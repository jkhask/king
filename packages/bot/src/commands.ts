import { WOW_FOREVER_RAIDS } from '@dr/shared';
import {
  ApplicationCommandOptionType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord-api-types/v10';

const raidTemplateChoices = Object.values(WOW_FOREVER_RAIDS).map((t) => ({
  name: `${t.name} (${t.size}m)`,
  value: t.id,
}));

export const SLASH_COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  {
    name: 'raid',
    description: 'Schedule raids (Barrow Deeps 10m, Hyjal Summit 20m, Onyxia 40m) and manage signups (Council only)',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'create',
        description: 'Create an interactive Raid Signup event (Council only)',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'template',
            description: 'WoW: Forever Raid Instance template',
            required: true,
            choices: raidTemplateChoices,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'schedule',
            description: 'Raid date & time (e.g., "Wed Dec 9 @ 8:00 PM EST")',
            required: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'title',
            description: 'Optional custom raid title override',
            required: false,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'notes',
            description: 'Consumable requirements, assignments, or notes',
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'view',
        description: 'Display the live signup sheet & composition for a raid (Council only)',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'raid_id',
            description: 'Raid ID (leave blank for the most recent raid)',
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'list',
        description: 'List upcoming and recent guild raids (Council only)',
      },
    ],
  },
  {
    name: 'loot',
    description: 'Import Gargul raid loot exports and view obtained gear history',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'import-gargul',
        description: 'Open a modal to paste a Gargul CSV/TSV/JSON loot export into the database',
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'history',
        description: 'View obtained gear history for a specific character or the whole guild',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'character',
            description: 'Character name (leave blank for recent guild-wide loot history)',
            required: false,
          },
        ],
      },
    ],
  },
];

