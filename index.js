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

// =====================================================
// ENVIRONMENT VARIABLES
// =====================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL;
const OFFICER_CHANNEL_ID = process.env.OFFICER_CHANNEL_ID;

const OFFICER_ROLE_IDS = process.env.OFFICER_ROLE_IDS
  ? process.env.OFFICER_ROLE_IDS
      .split(",")
      .map((roleId) => roleId.trim())
      .filter(Boolean)
  : [];

console.log("Starting bot...");
console.log("BOT_TOKEN set?", !!BOT_TOKEN);
console.log("CLIENT_ID set?", !!CLIENT_ID);
console.log("GUILD_ID set?", !!GUILD_ID);
console.log("SHEETS_WEBAPP_URL set?", !!SHEETS_WEBAPP_URL);
console.log("OFFICER_CHANNEL_ID set?", !!OFFICER_CHANNEL_ID);
console.log("OFFICER_ROLE_IDS:", OFFICER_ROLE_IDS.length);

if (
  !BOT_TOKEN ||
  !CLIENT_ID ||
  !GUILD_ID ||
  !SHEETS_WEBAPP_URL ||
  !OFFICER_CHANNEL_ID
) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

// =====================================================
// REQUESTABLE ITEMS
// =====================================================
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
  "Herald's Gaiters",
  "Avalon Breastplate",
];

// =====================================================
// DISCORD CLIENT
// =====================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// =====================================================
// HELPERS
// =====================================================
function getDisplayName(member, user) {
  return (
    member?.displayName ||
    user?.globalName ||
    user?.username ||
    "Unknown"
  );
}

function isOfficer(member) {
  if (!member) {
    return false;
  }

  if (member.permissions?.has("Administrator")) {
    return true;
  }

  if (OFFICER_ROLE_IDS.length === 0) {
    return false;
  }

  return member.roles.cache.some((role) =>
    OFFICER_ROLE_IDS.includes(role.id)
  );
}

async function readJsonResponse(response) {
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Google Apps Script returned HTTP ${response.status}: ${responseText}`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Google Apps Script did not return valid JSON: ${responseText}`
    );
  }
}

async function createInSheets(player, item) {
  const response = await fetch(SHEETS_WEBAPP_URL, {
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

  const result = await readJsonResponse(response);

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}

async function updateInSheets(id, status, officer) {
  const response = await fetch(SHEETS_WEBAPP_URL, {
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

  const result = await readJsonResponse(response);

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}

function buildNextQueueText(nextQueue) {
  if (!Array.isArray(nextQueue) || nextQueue.length === 0) {
    return "No members are currently waiting for this item.";
  }

  return nextQueue
    .slice(0, 3)
    .map((entry, index) => {
      const memberName =
        typeof entry === "string"
          ? entry
          : entry?.member || "Unknown";

      return `**${index + 1}.** ${memberName}`;
    })
    .join("\n");
}

function findEmbedFieldValue(embed, fieldName) {
  const field = embed?.fields?.find(
    (existingField) => existingField.name === fieldName
  );

  return field?.value || "Unknown";
}

// =====================================================
// REGISTER /REQUEST
// =====================================================
client.once(Events.ClientReady, async () => {
  try {
    console.log(`Logged in as ${client.user.tag}`);

    const guild = await client.guilds.fetch(GUILD_ID);

    const requestCommand = new SlashCommandBuilder()
      .setName("request")
      .setDescription("Request an item");

    const existingCommands = await guild.commands.fetch();
    const existingRequestCommand = existingCommands.find(
      (command) => command.name === "request"
    );

    if (existingRequestCommand) {
      await guild.commands.edit(
        existingRequestCommand.id,
        requestCommand
      );
    } else {
      await guild.commands.create(requestCommand);
    }

    console.log("Slash command registered.");
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

// =====================================================
// INTERACTIONS
// =====================================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // =================================================
    // /request
    // =================================================
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "request"
    ) {
      await interaction.deferReply({
        ephemeral: true,
      });

      const member = await interaction.guild.members.fetch(
        interaction.user.id
      );

      const displayName = getDisplayName(
        member,
        interaction.user
      );

      const publicEmbed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription(
          `**${displayName}** started an item request.`
        )
        .setColor(0x57f287);

      await interaction.channel.send({
        embeds: [publicEmbed],
      });

      const privateEmbed = new EmbedBuilder()
        .setTitle("📦 Item Request")
        .setDescription(
          "Select the item you want to request from the dropdown below."
        )
        .addFields(
          {
            name: "Status",
            value: "⏳ Pending selection",
            inline: true,
          },
          {
            name: "Requested By",
            value: displayName,
            inline: true,
          }
        )
        .setFooter({
          text: "LS Item Request System",
        });

      const itemMenu = new StringSelectMenuBuilder()
        .setCustomId(
          `request_select:${interaction.user.id}`
        )
        .setPlaceholder("Choose an item...")
        .addOptions(
          ITEMS.map((item) => ({
            label: item,
            value: item,
          }))
        );

      const menuRow = new ActionRowBuilder().addComponents(
        itemMenu
      );

      await interaction.editReply({
        embeds: [privateEmbed],
        components: [menuRow],
      });

      return;
    }

    // =================================================
    // ITEM DROPDOWN
    // =================================================
    if (interaction.isStringSelectMenu()) {
      const [prefix, ownerId] =
        interaction.customId.split(":");

      if (prefix !== "request_select") {
        return;
      }

      if (interaction.user.id !== ownerId) {
        await interaction.reply({
          content:
            "❌ This dropdown is only for the requester.",
          ephemeral: true,
        });

        return;
      }

      await interaction.deferUpdate();

      const member = await interaction.guild.members.fetch(
        interaction.user.id
      );

      const displayName = getDisplayName(
        member,
        interaction.user
      );

      const selectedItem = interaction.values[0];

      const createdRequest = await createInSheets(
        displayName,
        selectedItem
      );

      const requestId = createdRequest.id;

      if (!requestId) {
        throw new Error(
          "Google Sheets did not return a request ID."
        );
      }

      const confirmationEmbed = new EmbedBuilder()
        .setTitle("✅ Request Submitted")
        .setDescription(
          "Your request has been saved successfully."
        )
        .addFields(
          {
            name: "Item",
            value: selectedItem,
            inline: true,
          },
          {
            name: "Requested By",
            value: displayName,
            inline: true,
          },
          {
            name: "Request ID",
            value: requestId,
            inline: false,
          },
          {
            name: "Status",
            value: "Pending approval / delivery",
            inline: false,
          }
        )
        .setColor(0x57f287)
        .setFooter({
          text: "LS Item Request System",
        });

      await interaction.editReply({
        embeds: [confirmationEmbed],
        components: [],
      });

      const officerChannel =
        await interaction.guild.channels.fetch(
          OFFICER_CHANNEL_ID
        );

      if (!officerChannel?.isTextBased()) {
        throw new Error(
          "The officer channel is missing or is not a text channel."
        );
      }

      const officerEmbed = new EmbedBuilder()
        .setTitle("🛡️ Officer Approval Needed")
        .setDescription(
          "A new item request needs officer action."
        )
        .addFields(
          {
            name: "Item",
            value: selectedItem,
            inline: true,
          },
          {
            name: "Requested By",
            value: displayName,
            inline: true,
          },
          {
            name: "Request ID",
            value: requestId,
            inline: false,
          },
          {
            name: "Status",
            value: "Pending",
            inline: false,
          }
        )
        .setColor(0xfee75c)
        .setFooter({
          text: "LS Item Request System",
        });

      const officerButtons =
        new ActionRowBuilder().addComponents(
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
        components: [officerButtons],
      });

      return;
    }

    // =================================================
    // DELIVERED / DENIED BUTTONS
    // =================================================
    if (interaction.isButton()) {
      const [action, requestId] =
        interaction.customId.split(":");

      if (
        action !== "delivered" &&
        action !== "denied"
      ) {
        return;
      }

      const officerMember =
        await interaction.guild.members.fetch(
          interaction.user.id
        );

      if (!isOfficer(officerMember)) {
        await interaction.reply({
          content: "❌ Officers only.",
          ephemeral: true,
        });

        return;
      }

      await interaction.deferUpdate();

      const officerName = getDisplayName(
        officerMember,
        interaction.user
      );

      const newStatus =
        action === "delivered"
          ? "Delivered"
          : "Denied";

      const updateResult = await updateInSheets(
        requestId,
        newStatus,
        officerName
      );

      const oldEmbed = interaction.message.embeds[0];

      const itemName =
        updateResult.item ||
        findEmbedFieldValue(oldEmbed, "Item");

      const requestedBy = findEmbedFieldValue(
        oldEmbed,
        "Requested By"
      );

      const nextQueueText = buildNextQueueText(
        updateResult.nextQueue
      );

      const completedEmbed =
        new EmbedBuilder()
          .setTitle(
            newStatus === "Delivered"
              ? "✅ Item Delivered"
              : "❌ Item Request Denied"
          )
          .setDescription(
            newStatus === "Delivered"
              ? "The request has been marked as delivered."
              : "The request has been denied."
          )
          .addFields(
            {
              name: "Item",
              value: itemName,
              inline: true,
            },
            {
              name:
                newStatus === "Delivered"
                  ? "Delivered To"
                  : "Requested By",
              value: requestedBy,
              inline: true,
            },
            {
              name:
                newStatus === "Delivered"
                  ? "Delivered By"
                  : "Denied By",
              value: officerName,
              inline: false,
            },
            {
              name: "Request ID",
              value: requestId,
              inline: false,
            },
            {
              name: "Next in Queue",
              value: nextQueueText,
              inline: false,
            }
          )
          .setColor(
            newStatus === "Delivered"
              ? 0x57f287
              : 0xed4245
          )
          .setTimestamp()
          .setFooter({
            text: "LS Item Request System",
          });

      await interaction.editReply({
        embeds: [completedEmbed],
        components: [],
      });

      return;
    }
  } catch (error) {
    console.error("Interaction error:", error);

    try {
      const errorMessage =
        "❌ An error occurred. Please check the Render logs.";

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: errorMessage,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          ephemeral: true,
        });
      }
    } catch (replyError) {
      console.error(
        "Failed sending interaction error reply:",
        replyError
      );
    }
  }
});

// =====================================================
// LOGIN
// =====================================================
client.login(BOT_TOKEN);
