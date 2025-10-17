require('dotenv').config();
const { Client } = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new Client(config);

const richMenuId = process.argv[2];

if (!richMenuId) {
  console.error("Please provide a Rich Menu ID as an argument.");
  console.log("Usage: node set-default-rich-menu.js <richMenuId>");
  process.exit(1);
}

async function setDefaultRichMenu() {
  try {
    console.log(`Setting Rich Menu ${richMenuId} as the default...`);
    await client.setDefaultRichMenu(richMenuId);
    console.log("Default Rich Menu set successfully!");
    console.log("Users will now see the new menu in their chat.");
  } catch (err) {
    console.error("Error setting default Rich Menu:", err.originalError ? JSON.stringify(err.originalError.response.data) : err);
  }
}

setDefaultRichMenu();
