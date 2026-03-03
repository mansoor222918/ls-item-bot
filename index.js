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

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;
const OFFICER_CHANNEL_ID = process.env.OFFICER_CHANNEL_ID;

const OFFICER_ROLE_IDS = process.env.OFFICER_ROLE_IDS
  ? process.env.OFFICER_ROLE_IDS.split(",").map((r) => r.trim())
  : [];

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID || !SHEETS_WEBAPP_URL) {
  console.error("Missing environment variables.");
  process.exit(1);
}

const ITEMS = [
  "Black Tathlum",
  "White Tathlum",
  "Ancient Torque",
  "Valhalla Body",
  "Valhalla Head",
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

function getDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user.username;
}

function isOfficer(interaction) {
  if (!OFFICER_ROLE_IDS.length) return false;
  return interaction.member.roles.cache.some((r) =>
    OFFICER_ROLE_IDS.includes(r.id)
  );
}

async function createInSheets(player, item) {
  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create",
      player,
      item,
    }),
  });

  return res.json();
}

async function updateInSheets(id, status, officer) {
  await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "update",
      id,
      status,
      officer,
    }),
  });
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const command = new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request an item");

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.create(command);

  console.log("Slash command registered.");
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ========================
    // /request command
    // ========================
    if (interaction.isChatInputCommand()) {
      const ownerId = interaction.user.id;

      const embed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription("Select the item you want to request.")
        .setFooter({ text: "LS Item Request System" });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`request_select:${ownerId}`)
        .setPlaceholder("Choose an item...")
        .addOptions(
          ITEMS.map((item) => ({
            label: item,
            value: item,
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);

      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true, // ONLY visible to requester
      });

      return;
    }

    // ========================
    // Dropdown selection
    // ========================
    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith("request_select:")) return;

      const ownerId = interaction.customId.split(":")[1];

      // Block others
      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: "❌ This dropdown is not for you.",
          ephemeral: true,
        });
      }

      await interaction.deferUpdate();

      const selectedItem = interaction.values[0];
      const playerName = getDisplayName(interaction);

      const created = await createInSheets(playerName, selectedItem);
      const requestId = created.id;

      // Confirm to requester
      const confirmEmbed = new EmbedBuilder()
        .setTitle("✅ Request Submitted")
        .addFields(
          { name: "Item", value: selectedItem, inline: true },
          { name: "Requested By", value: playerName, inline: true },
          { name: "Request ID", value: requestId }
        )
        .setFooter({ text: "Pending approval / delivery" });

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [],
      });

      // Send to officer channel
      const officerChannel = await client.channels.fetch(
        OFFICER_CHANNEL_ID
      );

      const officerEmbed = new EmbedBuilder()
        .setTitle("🛡 Officer Approval Needed")
        .addFields(
          { name: "Item", value: selectedItem, inline: true },
          { name: "Requested By", value: playerName, inline: true },
          { name: "Request ID", value: requestId },
          { name: "Status", value: "Pending" }
        );

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

    // ========================
    // Officer buttons
    // ========================
    if (interaction.isButton()) {
      const [action, requestId] = interaction.customId.split(":");

      if (!isOfficer(interaction)) {
        return interaction.reply({
          content: "❌ Officers only.",
          ephemeral: true,
        });
      }

      await interaction.deferUpdate();

      const officerName = getDisplayName(interaction);
      const newStatus = action === "delivered" ? "Delivered" : "Denied";

      await updateInSheets(requestId, newStatus, officerName);

      const updatedEmbed = EmbedBuilder.from(
        interaction.message.embeds[0]
      ).setFields(
        interaction.message.embeds[0].fields.map((f) =>
          f.name === "Status"
            ? { ...f, value: newStatus }
            : f
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
    console.error(err);
  }
});

client.login(BOT_TOKEN);