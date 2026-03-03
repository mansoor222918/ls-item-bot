// index.js
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  EmbedBuilder,
} = require("discord.js");

// -------- ENV --------
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;

// Optional (recommended): only officers can approve/deny/deliver
// Put OFFICER_ROLE_ID in Render env, or leave empty to allow everyone
const OFFICER_ROLE_ID = process.env.OFFICER_ROLE_ID || "";

// Safe debug (DO NOT print token)
console.log("Starting bot...");
console.log("BOT_TOKEN set?", !!BOT_TOKEN);
console.log("GUILD_ID set?", !!GUILD_ID);
console.log("CLIENT_ID set?", !!CLIENT_ID);
console.log("SHEETS_WEBAPP_URL set?", !!SHEETS_WEBAPP_URL);

if (!BOT_TOKEN || !GUILD_ID || !CLIENT_ID || !SHEETS_WEBAPP_URL) {
  console.error("Missing env var(s). Check Render > Environment.");
  process.exit(1);
}

// -------- ITEMS (edit these) --------
const ITEMS = [
  "Black Tathlum",
  "White Tathlum",
  "Ancient Torque",
  "Valhalla Body",
  "Valhalla Head",
];

// -------- DISCORD CLIENT --------
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// -------- REGISTER SLASH COMMAND (once per boot) --------
async function registerSlashCommand() {
  const guild = await client.guilds.fetch(GUILD_ID);

  const command = new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request an item");

  await guild.commands.create(command);
  console.log("Slash command registered instantly.");
}

// -------- HELPERS --------
async function sheetsCreateRequest(player, item) {
  const payload = { action: "create", player, item };

  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets create failed (${res.status}): ${text}`);
  }

  return res.json(); // expects { status: "created", id: "xxxx" }
}

async function sheetsUpdateRequest(id, status, officer) {
  const payload = { action: "update", id, status, officer };

  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets update failed (${res.status}): ${text}`);
  }

  return res.json(); // expects { status: "updated" }
}

function officerOnlyGuard(interaction) {
  if (!OFFICER_ROLE_ID) return true; // no restriction if not set
  return interaction.member?.roles?.cache?.has(OFFICER_ROLE_ID);
}

function buildRequestEmbed({ item, requestedBy, requestId, statusText }) {
  return new EmbedBuilder()
    .setTitle("✅ Request Submitted")
    .setDescription("Your request has been saved to Google Sheets.")
    .addFields(
      { name: "Item", value: item, inline: true },
      { name: "Requested By", value: requestedBy, inline: true },
      { name: "Request ID", value: requestId, inline: false },
      { name: "Status", value: statusText, inline: false }
    )
    .setFooter({ text: "LS Item Request System" });
}

function buildButtons(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deliver:${requestId}`)
      .setLabel("✅ Delivered")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`deny:${requestId}`)
      .setLabel("❌ Denied")
      .setStyle(ButtonStyle.Danger)
  );
}

function disableButtons(row) {
  const disabled = new ActionRowBuilder().addComponents(
    row.components.map((c) => ButtonBuilder.from(c).setDisabled(true))
  );
  return disabled;
}

// -------- EVENTS --------
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerSlashCommand();
});

// Slash command /request
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "request") return;

      const menu = new StringSelectMenuBuilder()
        .setCustomId("item_select")
        .setPlaceholder("Choose an item...")
        .addOptions(
          ITEMS.map((name) => ({
            label: name,
            value: name,
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      const embed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription("Select the item you want to request from the dropdown below.")
        .addFields(
          { name: "Status", value: "🕒 Pending selection", inline: true },
          { name: "Next", value: "Pick an item", inline: true }
        )
        .setFooter({ text: "LS Item Request System" });

      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true,
      });
      return;
    }

    // Dropdown selection -> create request in Sheets + show buttons
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== "item_select") return;

      const selectedItem = interaction.values[0];
      const requestedBy = interaction.user.username;

      await interaction.update({
        content: "Saving your request to Google Sheets...",
        embeds: [],
        components: [],
        ephemeral: true,
      });

      const created = await sheetsCreateRequest(requestedBy, selectedItem);
      const requestId = created.id;

      const embed = buildRequestEmbed({
        item: selectedItem,
        requestedBy,
        requestId,
        statusText: "Pending approval / delivery",
      });

      const buttons = buildButtons(requestId);

      await interaction.editReply({
        content: "",
        embeds: [embed],
        components: [buttons],
        ephemeral: true,
      });
      return;
    }

    // Button clicks -> update request in Sheets (Delivered/Denied)
    if (interaction.isButton()) {
      const [action, requestId] = interaction.customId.split(":");
      if (!requestId) return;

      if (!officerOnlyGuard(interaction)) {
        return interaction.reply({
          content: "❌ Officers only.",
          ephemeral: true,
        });
      }

      let newStatus = null;
      if (action === "deliver") newStatus = "Delivered";
      if (action === "deny") newStatus = "Denied";
      if (!newStatus) return;

      await interaction.deferReply({ ephemeral: true });

      const officer = interaction.user.username;

      await sheetsUpdateRequest(requestId, newStatus, officer);

      // Update the embed + disable the buttons
      const oldEmbed = interaction.message.embeds?.[0];
      const itemField = oldEmbed?.fields?.find((f) => f.name === "Item")?.value || "Unknown";
      const requestedByField =
        oldEmbed?.fields?.find((f) => f.name === "Requested By")?.value || "Unknown";

      const updatedEmbed = buildRequestEmbed({
        item: itemField,
        requestedBy: requestedByField,
        requestId,
        statusText: `${newStatus} (by ${officer})`,
      });

      const originalRow = interaction.message.components?.[0];
      const disabledRow = originalRow ? disableButtons(originalRow) : null;

      await interaction.message.edit({
        embeds: [updatedEmbed],
        components: disabledRow ? [disabledRow] : [],
      });

      await interaction.editReply({
        content: `✅ Updated: **${newStatus}** recorded in Google Sheets for Request ID **${requestId}**.`,
      });
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: `❌ Error: ${err.message}`,
      });
    } else {
      await interaction.reply({
        content: `❌ Error: ${err.message}`,
        ephemeral: true,
      });
    }
  }
});

// -------- START --------
client.login(BOT_TOKEN);