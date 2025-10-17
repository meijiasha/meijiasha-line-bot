require('dotenv').config();
const { Client } = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new Client(config);

const richMenu = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: "DefaultMenuV2", // Use a new name to avoid conflicts
  chatBarText: "開啟選單",
  areas: [
    {
      bounds: { x: 0, y: 0, width: 2500, height: 843 },
      action: { type: "message", text: "推薦" },
    },
  ],
};

async function createRichMenu() {
  try {
    console.log("Creating Rich Menu structure...");
    const richMenuId = await client.createRichMenu(richMenu);
    console.log("\nRich Menu structure created successfully!");
    console.log("==================================================================");
    console.log("Your Rich Menu ID is:");
    console.log(richMenuId);
    console.log("==================================================================");
    console.log("\nNext, upload your image using this ID.");
  } catch (err) {
    console.error("Error creating Rich Menu:", err.originalError ? JSON.stringify(err.originalError.response.data) : err);
  }
}

createRichMenu();
