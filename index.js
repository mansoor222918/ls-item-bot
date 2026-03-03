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
  EmbedBuilder,
  Events,
} = require("discord.js");

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;
const OFFICER_CHANNEL_ID = process.env.OFFICER_CHANNEL_ID;

// Multiple officer roles in one env var, comma-separated
const OFFICER_ROLE_IDS = process.env.OFFICER_ROLE_IDS
  ? process.env.OFFICER_ROLE_IDS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

console.log("Starting bot...");
console.log("BOT_TOKEN set?", !!BOT_TOKEN);
console.log("GUILD_ID set?", !!GUILD_ID);
console.log("CLIENT_ID set?", !!CLIENT_ID);
console.log("SHEETS_WEBAPP_URL set?", !!SHEETS_WEBAPP_URL);
console.log("OFFICER_CHANNEL_ID set?", !!OFFICER_CHANNEL_ID);
console.log("OFFICER_ROLE_IDS:", OFFICER_ROLE_IDS.length ? `${OFFICER_ROLE_IDS.length} role(s)` : "NONE");

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID || !SHEETS_WEBAPP_URL || !OFFICER_CHANNEL_ID) {
  console.error("Missing env var(s). Check Render → Environment.");
  process.exit(1);
}

// ===== ITEMS =====
// Put your items here (value must be unique)
const ITEMS = [
  "Black Tathlum",
  "White Tathlum",
  "Ancient Torque",
  "Valhalla Body",
  "Valhalla Head",
];

// ===== HELPERS =====
function getDisplayName(interaction) {
  // This is the name as shown in the server/channel (nickname if set)
  return interaction.member?.displayName || interaction.user.username;
}

function isOfficer(interaction) {
  // If you want to force officer roles, keep this strict.
  // If OFFICER_ROLE_IDS is empty, allow nobody (safer).
  if (!OFFICER_ROLE_IDS.length) return false;

  const roles = interaction.member?.roles?.cache;
  if (!roles) return false;

  return roles.some((r) => OFFICER_ROLE_IDS.includes(r.id));
}

async function sheetsCreateRequest({ player, item }) {
  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", player, item }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sheets create failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json(); // { status:"created", id:"xxxx" }
}

async function sheetsUpdateRequest({ id, status, officer }) {
  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update", id, status, officer }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sheets update failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json(); // { status:"updated" }
}

// ===== DISCORD CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Needed to reliably use displayName / member info
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Register /request in THIS guild only
  const command = new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request an item");

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.create(command);

  console.log("Slash command registered.");
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ===== /request command (everyone) =====
    if (interaction.isChatInputCommand() && interaction.commandName === "request") {
      const embed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription("Select the item you want to request from the dropdown below.")
        .addFields(
          { name: "Status", value: "⏳ Pending selection", inline: true },
          { name: "Next", value: "Pick an item", inline: true }
        )
        .setFooter({ text: "LS Item Request System" });

      const menu = new StringSelectMenuBuilder()
        .setCustomId("request_item_select")
        .setPlaceholder("Choose an item...")
        .addOptions(
          ITEMS.map((name) => ({
            label: name,
            value: name,
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      await interaction.reply({ embeds: [embed], components: [row] });
      return;
    }

    // ===== Item dropdown selection =====
    if (interaction.isStringSelectMenu() && interaction.customId === "request_item_select") {
      const requestedItem = interaction.values[0];
      const requesterName = getDisplayName(interaction);

      // Create in Sheets
      const created = await sheetsCreateRequest({
        player: requesterName,
        item: requestedItem,
      });

      const requestId = created.id;

      // Confirm to requester (ephemeral)
      const confirmEmbed = new EmbedBuilder()
        .setTitle("✅ Request Submitted")
        .setDescription("Your request has been saved to Google Sheets.")
        .addFields(
          { name: "Item", value: requestedItem, inline: true },
          { name: "Requested By", value: requesterName, inline: true },
          { name: "Request ID", value: requestId, inline: false }
        )
        .setFooter({ text: "LS Item Request System" });

      await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });

      // Post approval card in officer-only channel (members won’t see it)
      const officerChannel = await client.channels.fetch(OFFICER_CHANNEL_ID);

      const officerEmbed = new EmbedBuilder()
        .setTitle("🛡️ Officer Approval Needed")
        .addFields(
          { name: "Item", value: requestedItem, inline: true },
          { name: "Requested By", value: requesterName, inline: true },
          { name: "Request ID", value: requestId, inline: false },
          { name: "Status", value: "Pending", inline: true }
        )
        .setFooter({ text: "Only officers can action this." });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_delivered:${requestId}`)
          .setLabel("Delivered")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`approve_denied:${requestId}`)
          .setLabel("Denied")
          .setStyle(ButtonStyle.Danger)
      );

      await officerChannel.send({ embeds: [officerEmbed], components: [buttons] });
      return;
    }

    // ===== Officer buttons =====
    if (interaction.isButton()) {
      const [action, requestId] = interaction.customId.split(":");
      if (!requestId) return;

      // Officers only
      if (!isOfficer(interaction)) {
        await interaction.reply({ content: "❌ Officers only.", ephemeral: true });
        return;
      }

      let newStatus = null;
      if (action === "approve_delivered") newStatus = "Delivered";
      if (action === "approve_denied") newStatus = "Denied";
      if (!newStatus) return;

      const officerName = getDisplayName(interaction);

      // Update Sheets
      await sheetsUpdateRequest({
        id: requestId,
        status: newStatus,
        officer: officerName,
      });

      // Update the officer message (embed + disable buttons)
      const oldEmbed = interaction.message.embeds?.[0];
      const updatedEmbed = EmbedBuilder.from(oldEmbed || new EmbedBuilder())
        .setTitle("🛡️ Officer Approval Updated")
        .setFooter({ text: `Updated by ${officerName}` });

      // Replace / set Status field
      const fields = updatedEmbed.data.fields || [];
      const newFields = fields.map((f) => {
        if (f.name === "Status") return { ...f, value: newStatus };
        return f;
      });

      // If Status field didn’t exist, add it
      if (!newFields.some((f) => f.name === "Status")) {
        newFields.push({ name: "Status", value: newStatus, inline: true });
      }

      updatedEmbed.setFields(newFields);

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_delivered:${requestId}`)
          .setLabel("Delivered")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`approve_denied:${requestId}`)
          .setLabel("Denied")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true)
      );

      await interaction.update({
        embeds: [updatedEmbed],
        components: [disabledRow],
      });

      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);

    // Best-effort response
    if (interaction.isRepliable()) {
      const msg = "⚠️ Something went wrong. Check Render logs.";
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: msg, ephemeral: true });
        } else {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      } catch {}
    }
  }
});

client.login(BOT_TOKEN);