// index.js
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  Events,
} = require("discord.js");

// ---- ENV ----
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;

// Safe debug (DON'T print secrets)
console.log("Starting bot...");
console.log("BOT_TOKEN set?", !!BOT_TOKEN);
console.log("GUILD_ID set?", !!GUILD_ID);
console.log("CLIENT_ID set?", !!CLIENT_ID);
console.log("SHEETS_WEBAPP_URL set?", !!SHEETS_WEBAPP_URL);

if (!BOT_TOKEN || !GUILD_ID || !CLIENT_ID || !SHEETS_WEBAPP_URL) {
  console.error("Missing env var(s). Check Render > Environment.");
  process.exit(1);
}

// ---- ITEMS (edit this list) ----
const ITEMS = [
  "Black Tathlum",
  "White Tathlum",
  "Ancient Torque",
  "Valhalla Body",
  "Valhalla Head",
];

// ---- DISCORD CLIENT ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Register slash command ONCE on startup
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const command = new SlashCommandBuilder()
      .setName("request")
      .setDescription("Request an item");

    const guild = await client.guilds.fetch(GUILD_ID);

    // This creates/overwrites the command in that guild (instant)
    await guild.commands.create(command);

    console.log("Slash command registered instantly.");
  } catch (err) {
    console.error("Failed to register slash command:", err);
  }
});

// /request interaction
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash command
    if (interaction.isChatInputCommand() && interaction.commandName === "request") {
      const embed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription("Select the item you want to request from the dropdown below.")
        .addFields(
          { name: "Status", value: "🕒 Pending selection", inline: true },
          { name: "Next", value: "Pick an item", inline: true }
        )
        .setFooter({ text: "LS Item Request System" });

      const select = new StringSelectMenuBuilder()
        .setCustomId("item_request_select")
        .setPlaceholder("Choose an item...")
        .addOptions(
          ITEMS.map((name) => ({
            label: name,
            value: name,
          }))
        );

      const row = new ActionRowBuilder().addComponents(select);

      // IMPORTANT: must reply within 3 seconds
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // Select menu
    if (interaction.isStringSelectMenu() && interaction.customId === "item_request_select") {
      await interaction.deferReply({ ephemeral: true });

      const item = interaction.values[0];
      const player = interaction.user.username;

      // Call Google Apps Script Web App
      const res = await fetch(SHEETS_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          player,
          item,
        }),
      });

      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.error("Non-JSON response from Sheets:", text);
        return interaction.editReply(
          "❌ Google Sheets API returned a non-JSON response. Check Apps Script deployment + permissions."
        );
      }

      if (!res.ok) {
        console.error("Sheets error:", res.status, data);
        return interaction.editReply(`❌ Sheets API error (${res.status}). Check logs.`);
      }

      if (data.status !== "created") {
        console.error("Unexpected Sheets response:", data);
        return interaction.editReply("❌ Unexpected response from Sheets API.");
      }

      const requestId = data.id;

      const doneEmbed = new EmbedBuilder()
        .setTitle("✅ Request Submitted")
        .setDescription("Your request has been saved to Google Sheets.")
        .addFields(
          { name: "Item", value: `**${item}**`, inline: true },
          { name: "Requested By", value: `**${player}**`, inline: true },
          { name: "Request ID", value: `\`${requestId}\``, inline: false }
        )
        .setFooter({ text: "LS Item Request System" });

      await interaction.editReply({ embeds: [doneEmbed] });
      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);

    // If we can still reply
    if (interaction.deferred) {
      await interaction.editReply("❌ Something crashed. Check Render logs.");
    } else if (!interaction.replied) {
      await interaction.reply({ content: "❌ Something crashed. Check Render logs.", ephemeral: true });
    }
  }
});

client.login(BOT_TOKEN);