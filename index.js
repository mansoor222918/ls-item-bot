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

const OFFICER_ROLE_IDS = process.env.OFFICER_ROLE_IDS
  ? process.env.OFFICER_ROLE_IDS.split(",").map((r) => r.trim()).filter(Boolean)
  : [];

console.log("Starting bot...");
console.log("BOT_TOKEN set?", !!BOT_TOKEN);
console.log("CLIENT_ID set?", !!CLIENT_ID);
console.log("GUILD_ID set?", !!GUILD_ID);
console.log("SHEETS_WEBAPP_URL set?", !!SHEETS_WEBAPP_URL);
console.log("OFFICER_CHANNEL_ID set?", !!OFFICER_CHANNEL_ID);
console.log("OFFICER_ROLE_IDS:", OFFICER_ROLE_IDS.length);

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID || !SHEETS_WEBAPP_URL || !OFFICER_CHANNEL_ID) {
  console.error("Missing environment variables.");
  process.exit(1);
}

// ===== ITEMS =====
const ITEMS = [
  "Black Tathlum",
  "White Tathlum",
  "Ancient Torque",
  "Valhalla Body",
  "Valhalla Head",
  "Hofud",
  "Animator +1",
  "Antares Harness",
  "Valkyrie's Fork",
  "Zahak's Mail",
  "Herald's Gaiters"
];

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ===== HELPERS =====
function getDisplayName(member, user) {
  return member?.displayName || user?.globalName || user?.username || "Unknown";
}

function isOfficer(member) {
  if (!member) return false;

  if (member.permissions?.has("Administrator")) return true;

  if (!OFFICER_ROLE_IDS || OFFICER_ROLE_IDS.length === 0) return false;

  return member.roles.cache.some(role => OFFICER_ROLE_IDS.includes(role.id));
}

async function createInSheets(player, item) {
  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "create",
      player,
      item,
    }),
  });

  return res.json();
}

async function updateInSheets(id, status, officer) {
  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "update",
      id,
      status,
      officer,
    }),
  });

  return res.json();
}

// ===== REGISTER COMMAND =====
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID);

  const command = new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request an item");

  const existing = await guild.commands.fetch();
  const old = existing.find(c => c.name === "request");

  if (old) {
    await guild.commands.edit(old.id, command);
  } else {
    await guild.commands.create(command);
  }

  console.log("Slash command registered.");
});

// ===== INTERACTIONS =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // =========================
    // /request command
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === "request") {
      await interaction.deferReply({ ephemeral: true });

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const displayName = getDisplayName(member, interaction.user);

      // Public message in the channel
      const publicEmbed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription(`**${displayName}** started an item request.`)
        .setColor(0x57F287);

      await interaction.channel.send({ embeds: [publicEmbed] });

      // Private dropdown for requester only
      const embed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription("Select the item you want to request from the dropdown below.")
        .addFields(
          { name: "Status", value: "⏳ Pending selection", inline: true },
          { name: "Requested By", value: displayName, inline: true }
        )
        .setFooter({ text: "LS Item Request System" });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`request_select:${interaction.user.id}`)
        .setPlaceholder("Choose an item...")
        .addOptions(
          ITEMS.map(item => ({
            label: item,
            value: item,
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      return;
    }

    // =========================
    // dropdown select
    // =========================
    if (interaction.isStringSelectMenu()) {
      const [prefix, ownerId] = interaction.customId.split(":");
      if (prefix !== "request_select") return;

      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: "❌ This dropdown is only for the requester.",
          ephemeral: true,
        });
      }

      await interaction.deferUpdate();

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const displayName = getDisplayName(member, interaction.user);
      const selectedItem = interaction.values[0];

      const created = await createInSheets(displayName, selectedItem);
      const requestId = created.id;

      // Private confirmation
      const confirmEmbed = new EmbedBuilder()
        .setTitle("✅ Request Submitted")
        .setDescription("Your request has been saved to Google Sheets.")
        .addFields(
          { name: "Item", value: selectedItem, inline: true },
          { name: "Requested By", value: displayName, inline: true },
          { name: "Request ID", value: requestId, inline: false },
          { name: "Status", value: "Pending approval / delivery", inline: false }
        )
        .setColor(0x57F287)
        .setFooter({ text: "LS Item Request System" });

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [],
      });

      // Officer channel message
      const officerChannel = await interaction.guild.channels.fetch(OFFICER_CHANNEL_ID);

      const officerEmbed = new EmbedBuilder()
        .setTitle("🛡️ Officer Approval Needed")
        .setDescription("A new item request needs officer action.")
        .addFields(
          { name: "Item", value: selectedItem, inline: true },
          { name: "Requested By", value: displayName, inline: true },
          { name: "Request ID", value: requestId, inline: false },
          { name: "Status", value: "Pending", inline: false }
        )
        .setColor(0xFEE75C);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`delivered:${requestId}`)
          .setLabel("Delivered")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`denied:${requestId}`)
          .setLabel("Denied")
          .setStyle(ButtonStyle.Danger)
      );

      await officerChannel.send({
        embeds: [officerEmbed],
        components: [buttons],
      });

      return;
    }

    // =========================
    // buttons
    // =========================
    if (interaction.isButton()) {
      const [action, requestId] = interaction.customId.split(":");

      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (!isOfficer(member)) {
        return interaction.reply({
          content: "❌ Officers only.",
          ephemeral: true,
        });
      }

      await interaction.deferUpdate();

      const officerName = getDisplayName(member, interaction.user);
      const newStatus = action === "delivered" ? "Delivered" : "Denied";

      await updateInSheets(requestId, newStatus, officerName);

      const oldEmbed = interaction.message.embeds[0];

      const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
        oldEmbed.fields.map(field =>
          field.name === "Status"
            ? { ...field, value: newStatus }
            : field
        )
      );

      const disabledButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`delivered:${requestId}`)
          .setLabel("Delivered")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`denied:${requestId}`)
          .setLabel("Denied")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true)
      );

      await interaction.editReply({
        embeds: [updatedEmbed],
        components: [disabledButtons],
      });

      return;
    }

  } catch (err) {
    console.error("Interaction error:", err);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "❌ Error occurred. Check Render logs.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "❌ Error occurred. Check Render logs.",
          ephemeral: true,
        });
      }
    } catch (e) {
      console.error("Failed sending error reply:", e);
    }
  }
});

client.login(BOT_TOKEN);