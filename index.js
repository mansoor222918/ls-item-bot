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

// Multiple officer roles in one env var, comma-separated (NO spaces recommended)
const OFFICER_ROLE_IDS = process.env.OFFICER_ROLE_IDS
  ? process.env.OFFICER_ROLE_IDS.split(",").map((r) => r.trim()).filter(Boolean)
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
const ITEMS = [
  "Black Tathlum",
  "White Tathlum",
  "Ancient Torque",
  "Valhalla Body",
  "Valhalla Head",
  "Hofud ",
  "Animator +1",
  "Antares Harness",
  "Valkyrie\'s Fork",
  "Zahak\'s Mail",
  "Herald\'s Gaiters",
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // so displayName works
  ],
});

// ===== HELPERS =====
function getDisplayName(interaction) {
  // This is the server nickname / channel name (what you want)
  return interaction.member?.displayName || interaction.user.username;
}

function isOfficer(interaction) {
  if (!OFFICER_ROLE_IDS.length) return false;
  const roles = interaction.member?.roles?.cache;
  if (!roles) return false;
  return roles.some((r) => OFFICER_ROLE_IDS.includes(r.id));
}

async function createInSheets(player, item) {
  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", player, item }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Sheets create failed (${res.status}): ${t.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null);
  if (!data || data.status !== "created" || !data.id) {
    throw new Error(`Sheets create bad response: ${JSON.stringify(data)}`);
  }
  return data; // { status:"created", id:"xxxxxxxx" }
}

async function updateInSheets(id, status, officer) {
  const res = await fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update", id, status, officer }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Sheets update failed (${res.status}): ${t.slice(0, 200)}`);
  }

  return res.json().catch(() => ({}));
}

function buildOfficerButtons(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`delivered:${requestId}`)
      .setLabel("✅ Delivered")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`denied:${requestId}`)
      .setLabel("❌ Denied")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildDisabledOfficerButtons(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`delivered:${requestId}`)
      .setLabel("✅ Delivered")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`denied:${requestId}`)
      .setLabel("❌ Denied")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true)
  );
}

// ===== READY =====
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Register /request in THIS guild only (fast updates)
  const command = new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request an item");

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.create(command);

  console.log("Slash command registered.");
});

// ===== INTERACTIONS =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // 1) /request — show PRIVATE dropdown (only requester sees)
    if (interaction.isChatInputCommand() && interaction.commandName === "request") {
      const ownerId = interaction.user.id;

      const embed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription("Select the item you want to request from the dropdown.")
        .setFooter({ text: "Only you can see this menu." });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`request_select:${ownerId}`) // lock to requester
        .setPlaceholder("Choose an item...")
        .addOptions(ITEMS.map((item) => ({ label: item, value: item })));

      const row = new ActionRowBuilder().addComponents(menu);

      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true, // ✅ only requester sees
      });
      return;
    }

    // 2) Dropdown selection — only the owner can use it
    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith("request_select:")) return;

      const ownerId = interaction.customId.split(":")[1];

      // If someone else tries clicking it
      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: "❌ This dropdown is not for you. Run `/request` to open your own.",
          ephemeral: true,
        });
      }

      // Prevent “This interaction failed”
      await interaction.deferUpdate();

      const selectedItem = interaction.values[0];
      const playerName = getDisplayName(interaction);

      // Create request in Sheets
      const created = await createInSheets(playerName, selectedItem);
      const requestId = created.id;

      // PRIVATE confirmation (requester only)
      const confirmEmbed = new EmbedBuilder()
        .setTitle("✅ Request Submitted")
        .addFields(
          { name: "Item", value: selectedItem, inline: true },
          { name: "Requested By", value: playerName, inline: true },
          { name: "Request ID", value: `\`${requestId}\`` }
        )
        .setFooter({ text: "Sent to officers for approval." });

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [],
      });

      // PUBLIC message in the channel for everyone (NO buttons)
      const publicEmbed = new EmbedBuilder()
        .setTitle("📌 New Item Request")
        .addFields(
          { name: "Member", value: playerName, inline: true },
          { name: "Item", value: selectedItem, inline: true },
          { name: "Status", value: "🕒 Pending", inline: true }
        )
        .setFooter({ text: `Request ID: ${requestId}` });

      await interaction.channel.send({ embeds: [publicEmbed] });

      // OFFICER channel message WITH buttons (officers only can see that channel)
      const officerChannel = await client.channels.fetch(OFFICER_CHANNEL_ID);

      const officerEmbed = new EmbedBuilder()
        .setTitle("🛡 Officer Approval Needed")
        .addFields(
          { name: "Member", value: playerName, inline: true },
          { name: "Item", value: selectedItem, inline: true },
          { name: "Request ID", value: `\`${requestId}\`` },
          { name: "Status", value: "Pending" }
        )
        .setFooter({ text: "Only officers can click buttons." });

      await officerChannel.send({
        embeds: [officerEmbed],
        components: [buildOfficerButtons(requestId)],
      });

      return;
    }

    // 3) Officer buttons — only officers can click
    if (interaction.isButton()) {
      const [action, requestId] = interaction.customId.split(":");
      if (!requestId) return;

      if (!isOfficer(interaction)) {
        return interaction.reply({ content: "❌ Officers only.", ephemeral: true });
      }

      await interaction.deferUpdate();

      const officerName = getDisplayName(interaction);
      const newStatus = action === "delivered" ? "Delivered" : "Denied";

      await updateInSheets(requestId, newStatus, officerName);

      // Update officer message and disable buttons
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]);

      // Replace Status field value
      const oldFields = updatedEmbed.data.fields || [];
      const newFields = oldFields.map((f) =>
        f.name === "Status" ? { ...f, value: newStatus } : f
      );

      // Add an Updated By field (optional)
      newFields.push({ name: "Updated By", value: officerName, inline: true });

      updatedEmbed.setFields(newFields);

      await interaction.editReply({
        embeds: [updatedEmbed],
        components: [buildDisabledOfficerButtons(requestId)],
      });

      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);

    // Best effort reply if something goes wrong
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "❌ Error occurred. Check Render logs.", ephemeral: true });
      } else {
        await interaction.reply({ content: "❌ Error occurred. Check Render logs.", ephemeral: true });
      }
    } catch {}
  }
});

client.login(BOT_TOKEN);