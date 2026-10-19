# Diminishing Returns (Alliance) — World of Warcraft: Forever Guild Logistics Bot

Serverless Discord Bot, Gargul Loot History Database, and AWS CDK Stack built for **Diminishing Returns (Alliance)** in **World of Warcraft: Forever**.

## Architecture

- **`packages/shared` (`@dr/shared`)**:
  - *World of Warcraft: Forever* Alliance domain constants (Human, Dwarf, Night Elf, Gnome, **High Order Skyborne**, plus new race/class combinations like **Dwarf Shaman**, **Human Hunter**, **Gnome Priest**, and **Skyborne Mage/Druid**).
  - Opening Raid Tier templates: **Barrow Deeps (10m)**, **Hyjal Summit (20m)**, **Onyxia's Lair (40m)**.
  - **Gargul Loot Parser**: Parses CSV, TSV, WoW item links (`|Hitem:...|h[Name]|h`), and JSON exports from the Gargul addon with deterministic deduplication hashes.
- **`packages/db` (`@dr/db`)**:
  - Single-table **Amazon DynamoDB** repository (`DynamoGuildRepository`) + `InMemoryGuildRepository` for fast unit testing.
  - Stores **Characters**, **Raids & Signups**, **Obtained Gear Awards**, **Loot Council Deliberation Sessions**, **Guild Bank Inventory**, and **Crafting/Consumable Requests**.
- **`packages/bot` (`@dr/bot`)**:
  - Serverless Discord HTTP Interactions handler (`POST /interactions`) with Ed25519 Web Crypto signature verification, interactive buttons, and modals.
- **`packages/infra` (`@dr/infra`)**:
  - **AWS CDK Stack** (`DiminishingReturnsStack`) provisioning DynamoDB (`PAY_PER_REQUEST` + `gsi1`), AWS Lambda (`Node.js 22 ARM64` bundled via `esbuild`), Amazon API Gateway HTTP API, and AWS SSM Parameter Store keys.

---

## Multi-Computer Setup & Deployment

Because all state lives in AWS DynamoDB and credentials live in AWS SSM Parameter Store, you can work from any computer with Node 22+, `pnpm`, and AWS CLI credentials:

### 1. Install & Test
```bash
pnpm install
pnpm build
pnpm test
```

### 2. Deploy the AWS CDK Stack
```bash
# First-time only in your AWS account/region:
npx cdk bootstrap

# Deploy the stack:
pnpm cdk:deploy
```
When `pnpm cdk:deploy` completes, it outputs:
- `InteractionsEndpointUrl`: e.g. `https://<api-id>.execute-api.us-east-1.amazonaws.com/interactions`
- `DynamoTableName`: Your DynamoDB table name
- `DiscordPublicKeyParameterName`: `/dr/discord/public-key`

### 3. Store Your Discord Credentials in AWS SSM Parameter Store (Once)
Set your Discord Application credentials in SSM so any computer you use can deploy and register commands without copying `.env` files:
```bash
aws ssm put-parameter --name "/dr/discord/public-key" --value "<YOUR_DISCORD_PUBLIC_KEY>" --type String --overwrite
aws ssm put-parameter --name "/dr/discord/app-id" --value "<YOUR_DISCORD_APP_ID>" --type String --overwrite
aws ssm put-parameter --name "/dr/discord/bot-token" --value "<YOUR_DISCORD_BOT_TOKEN>" --type SecureString --overwrite
```

### 4. Connect Discord Developer Portal & Register Slash Commands
1. In the [Discord Developer Portal](https://discord.com/developers/applications) -> **General Information**, paste the `InteractionsEndpointUrl` from CDK output into **Interactions Endpoint URL** and click **Save Changes** (our Lambda automatically verifies the Ed25519 signature and responds with `PONG`).
2. Register the slash commands (reads from env vars or `/dr/discord/*` in SSM):
```bash
pnpm register-commands
```

---

## Discord Slash Commands Overview

- **`/character register | list | delete`**: Register your Main and Alt Alliance characters, roles, professions, and notable recipes.
- **`/roster summary | crafters`**: View class/role breakdown across the guild or search crafters by profession/recipe.
- **`/raid create | view | list`**: Schedule 10m (*Barrow Deeps*), 20m (*Hyjal Summit*), or 40m (*Onyxia's Lair*) raids with one-click signup buttons.
- **`/loot import-gargul | history`**:
  - Paste a **Gargul** export string (CSV/TSV/JSON) via modal to log obtained gear into DynamoDB.
  - View obtained gear history for a specific character or recent guild-wide drops (full loot/DB explorer planned for the companion web app).
- **`/request create | list`**: Manage interactive crafting and consumable request tickets.
- **`/setup discord | sync-members`**: Provision hoisted WoW Class Roles, post the Welcome Registration Card, and sync member nicknames/roles.
