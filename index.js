// index.js
require('dotenv').config();

const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  Events,
} = require('discord.js');

// ---- ENV ----
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;

// Safe debug (DO NOT print token)
console.log("Starting bot...");
console.log("BOT_TOKEN set?", !!BOT_TOKEN);
console.log("GUILD_ID set?", !!GUILD_ID);
console.log("CLIENT_ID set?", !!CLIENT_ID);

if (!BOT_TOKEN || !GUILD_ID || !CLIENT_ID || !SHEETS_WEBAPP_URL) {
  console.error("Missing env var(s). Check Render > Environment.");
  process.exit(1);
}

const ITEMS = [
  "Black Tathlum",
  "White Tathlum",
  "Ancient Torque",
  "Valhalla Body",
  "Valhalla Head",
];

// ---- Discord Client ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Register command ONCE when bot starts
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);

    const command = new SlashCommandBuilder()
      .setName("request")
      .setDescription("Request an item");

    // Upsert (create if not exists, update if exists)
    await guild.commands.create(command);

    console.log("Slash command registered.");
  } catch (err) {
    console.error("Failed to register slash command:", err);
  }
});

// Handle /request
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "request") return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId("item_select")
    .setPlaceholder("Choose an item…")
    .addOptions(
      ITEMS.map((label) => ({
        label,
        value: label,
      }))
    );

  const row = new ActionRowBuilder().addComponents(menu);

  await interaction.reply({
    content: "Pick the item you want to request:",
    components: [row],
    ephemeral: true,
  });
});

// Handle dropdown selection
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "item_select") return;

  const item = interaction.values[0];

  await interaction.update({
    content: `✅ Request received: **${item}**`,
    components: [],
  });

  // (Step 3 later) Here is where we'll send to Google Sheets
});

client.login(BOT_TOKEN);