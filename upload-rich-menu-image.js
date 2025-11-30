require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const channelAccessToken = process.env.CHANNEL_ACCESS_TOKEN;
const richMenuId = process.argv[2];
const imagePath = process.argv[3];

if (!richMenuId || !imagePath) {
    console.error("Usage: node upload-rich-menu-image.js <richMenuId> <imagePath>");
    process.exit(1);
}

if (!fs.existsSync(imagePath)) {
    console.error(`Image file not found at: ${imagePath}`);
    process.exit(1);
}

async function uploadRichMenuImage() {
    try {
        const imageBuffer = fs.readFileSync(imagePath);
        const contentType = path.extname(imagePath) === '.png' ? 'image/png' : 'image/jpeg';

        console.log(`Uploading image to Rich Menu ${richMenuId}...`);

        await axios({
            method: 'post',
            url: `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
            headers: {
                'Authorization': `Bearer ${channelAccessToken}`,
                'Content-Type': contentType,
            },
            data: imageBuffer,
        });

        console.log("Image uploaded successfully!");
    } catch (error) {
        console.error("Error uploading image:", error.response ? error.response.data : error.message);
    }
}

uploadRichMenuImage();
