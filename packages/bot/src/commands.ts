import {
  ALLIANCE_RACES,
  PRIMARY_PROFESSIONS,
  RAID_ROLES,
  WOW_CLASSES,
  WOW_FOREVER_RAIDS,
} from '@dr/shared';
import {
  ApplicationCommandOptionType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord-api-types/v10';

const raceChoices = ALLIANCE_RACES.map((r) => ({ name: r, value: r }));
const classChoices = WOW_CLASSES.map((c) => ({ name: c, value: c }));
const roleChoices = RAID_ROLES.map((r) => ({ name: r, value: r }));
const professionChoices = PRIMARY_PROFESSIONS.map((p) => ({ name: p, value: p }));
const raidTemplateChoices = Object.values(WOW_FOREVER_RAIDS).map((t) => ({
  name: `${t.name} (${t.size}m)`,
  value: t.id,
}));

export const SLASH_COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  {
    name: 'character',
    description: 'Manage your Diminishing Returns (Alliance) characters in WoW: Forever',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'register',
        description: 'Register or update one of your characters',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'name',
            description: 'Character name in World of Warcraft: Forever',
            required: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'race',
            description: 'Alliance Race (including High Order Skyborne)',
            required: true,
            choices: raceChoices,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'class',
            description: 'Character Class (supports Forever combos like Dwarf Shaman & Human Hunter)',
            required: true,
            choices: classChoices,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'role',
            description: 'Primary Raid Role',
            required: true,
            choices: roleChoices,
          },
          {
            type: ApplicationCommandOptionType.Boolean,
            name: 'main',
            description: 'Is this your Main character? (Defaults to true)',
            required: false,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'offspec',
            description: 'Optional Off-Spec Raid Role',
            required: false,
            choices: roleChoices,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'profession1',
            description: 'Primary Profession 1',
            required: false,
            choices: professionChoices,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'profession2',
            description: 'Primary Profession 2',
            required: false,
            choices: professionChoices,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'recipes',
            description: 'Comma-separated notable recipes or enchants (e.g. Crusader, Flask of Titans)',
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'list',
        description: 'List your registered characters (or another member’s)',
        options: [
          {
            type: ApplicationCommandOptionType.User,
            name: 'user',
            description: 'Optional Discord member to inspect',
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'delete',
        description: 'Remove one of your registered characters',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'name',
            description: 'Character name to remove',
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: 'roster',
    description: 'View the Diminishing Returns guild roster and profession directory',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'summary',
        description: 'Display full guild class & role distribution for Mains and Alts',
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'crafters',
        description: 'Search guild crafters by profession or notable recipe',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'profession',
            description: 'Filter by profession',
            required: false,
            choices: professionChoices,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'recipe',
            description: 'Search for a specific recipe or enchant keyword',
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: 'raid',
    description: 'Schedule raids (Barrow Deeps 10m, Hyjal Summit 20m, Onyxia 40m) and manage signups',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'create',
        description: 'Create an interactive Raid Signup event',
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
        description: 'Display the live signup sheet & composition for a raid',
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
        description: 'List upcoming and recent guild raids',
      },
    ],
  },
  {
    name: 'loot',
    description: 'Gargul loot imports, obtained gear history, and Loot Council recommendations',
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
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'compare',
        description: 'Compare obtained gear history and attendance across multiple characters',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'characters',
            description: 'Comma-separated character names to compare (e.g. "Bolvar, Magni, Tyrande")',
            required: true,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'council',
        description: 'Show ranked recommendations on who should obtain an item based on raid attendance and prior loot',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'item',
            description: 'Item name or WoW item link',
            required: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'candidates',
            description: 'Comma-separated character names rolling in Gargul (leave blank for active raid/roster)',
            required: false,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'role',
            description: 'Filter eligible candidates by Raid Role (Tank, Healer, Melee, Ranged)',
            required: false,
            choices: roleChoices,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'raid',
            description: 'Raid instance name or Raid ID (e.g. Hyjal Summit, Barrow Deeps)',
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'award',
        description: 'Manually record a loot award in the guild database',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'character',
            description: 'Winning character name',
            required: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'item',
            description: 'Item name or WoW item link',
            required: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'spec',
            description: 'Award spec type (MS, OS, SR)',
            required: false,
            choices: [
              { name: 'Main Spec (MS)', value: 'MS' },
              { name: 'Off Spec (OS)', value: 'OS' },
              { name: 'Soft Reserve (SR)', value: 'SR' },
            ],
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'raid',
            description: 'Optional raid instance',
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: 'bank',
    description: 'Manage and search Diminishing Returns Guild Bank inventory',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'search',
        description: 'Search Guild Bank inventory by item name or category',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'query',
            description: 'Search keyword (leave blank to list all stock)',
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'set',
        description: 'Update the quantity of an item in the Guild Bank (set 0 to remove)',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'item',
            description: 'Item name',
            required: true,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'quantity',
            description: 'New total quantity in Guild Bank (0 removes item)',
            required: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'category',
            description: 'Bank category',
            required: false,
            choices: [
              { name: 'Consumable', value: 'Consumable' },
              { name: 'Material', value: 'Material' },
              { name: 'Recipe', value: 'Recipe' },
              { name: 'Equipment', value: 'Equipment' },
              { name: 'Other', value: 'Other' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'request',
    description: 'Submit or view guild crafting & consumable requests',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'create',
        description: 'Create an interactive crafting or consumable request ticket',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'type',
            description: 'Request category',
            required: true,
            choices: [
              { name: 'Crafting / Enchanting Request', value: 'CRAFTING' },
              { name: 'Raid Consumable Request', value: 'CONSUMABLE' },
              { name: 'Guild Bank Withdrawal', value: 'BANK_WITHDRAW' },
            ],
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'item',
            description: 'Requested item or enchant name',
            required: true,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'quantity',
            description: 'Quantity needed (default 1)',
            required: false,
          },
          {
            type: ApplicationCommandOptionType.Boolean,
            name: 'mats_provided',
            description: 'Do you already have the materials ready?',
            required: false,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'character',
            description: 'Character to receive the item (defaults to your Main)',
            required: false,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'notes',
            description: 'Additional notes',
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'list',
        description: 'List all open guild crafting and consumable requests',
      },
    ],
  },
  {
    name: 'setup',
    description: 'Configure Discord Class Roles, Welcome Onboarding Card, and Member Nickname Sync',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'discord',
        description: 'Create/update hoisted WoW Class Roles on Discord and post the Welcome Registration Card',
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'sync-members',
        description: 'Sync all registered guild members’ Discord nicknames and Class Roles now',
      },
    ],
  },
];
