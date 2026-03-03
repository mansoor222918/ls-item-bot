require('dotenv').config();

console.log("Starting bot...");
console.log("BOT_TOKEN set?", !!process.env.BOT_TOKEN);
console.log("GUILD_ID:", process.env.GUILD_ID);
const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder 
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

// PUT YOUR SERVER ID HERE
const GUILD_ID = "1254129968158343259";

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const command = new SlashCommandBuilder()
    .setName('request')
    .setDescription('Request an item');

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.create(command);

  console.log("Slash command registered instantly.");
});

// 🔥 DEBUG: log ALL interactions
client.on('interactionCreate', async interaction => {
  console.log("Interaction received:", interaction.type);

  if (interaction.isChatInputCommand()) {
    console.log("Slash command triggered!");

    await interaction.reply({
      content: "Slash command works ✅",
      ephemeral: true
    });
  }
});

client.login(process.env.BOT_TOKEN);