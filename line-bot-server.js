const express = require('express');
const line = require('@line/bot-sdk');
const firebase = require('firebase-admin');

// --- 1. 環境變數設定 ---
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN || 'YOUR_CHANNEL_ACCESS_TOKEN',
  channelSecret: process.env.CHANNEL_SECRET || 'YOUR_CHANNEL_SECRET',
};

let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    console.warn('Firebase service account key not found. Local development might fail.');
  }
} catch (e) {
  console.error('Failed to parse Firebase service account key:', e);
}

// --- 2. 初始化服務 ---
const app = express();
const client = new line.Client(config);
let db;

if (serviceAccount) {
  firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount)
  });
  db = firebase.firestore();
  console.log('Firebase Admin SDK initialized successfully.');
} else {
  console.error('Firebase Admin SDK initialization failed.');
}

const taipeiDistricts = ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區"];

// --- 3. Webhook 路由 ---
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook Error:', err);
      res.status(500).end();
    });
});

// --- 4. 事件處理邏輯 ---
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const receivedText = event.message.text.trim();

  if (receivedText.startsWith('推薦')) {
    const parts = receivedText.substring(2).trim().split(/\s+/).filter(Boolean);
    const district = parts[0];
    const category = parts[1]; // 可選

    if (!district || !taipeiDistricts.includes(district)) {
        const reply = { type: 'text', text: '請提供一個有效的台北市行政區來進行推薦喔！\n範例：\n推薦 信義區\n推薦 大安區 咖啡廳' };
        return client.replyMessage(event.replyToken, reply);
    }

    try {
        const stores = await getRecommendations(district, category);
        if (!stores || stores.length === 0) {
            const reply = { type: 'text', text: `抱歉，在「${district}」找不到可推薦的店家。` };
            return client.replyMessage(event.replyToken, reply);
        }
        const reply = createStoreCarousel(stores, district, category);
        return client.replyMessage(event.replyToken, reply);
    } catch (error) {
        console.error("Recommendation Error:", error);
        const reply = { type: 'text', text: '哎呀，推薦功能好像出了一點問題，請稍後再試。' };
        return client.replyMessage(event.replyToken, reply);
    }
  }

  // 預設回覆或其他指令
  const reply = { type: 'text', text: `您好！試試看傳送「推薦 [行政區] [分類]」來尋找店家吧！` };
  return client.replyMessage(event.replyToken, reply);
}

// --- 5. 核心推薦邏輯 ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

async function getRecommendations(district, category) {
    if (!db) throw new Error('Firestore is not initialized.');

    const snapshot = await db.collection('stores_taipei').where('district', '==', district).get();
    if (snapshot.empty) {
        return [];
    }

    const allStoresInDistrict = [];
    snapshot.forEach(doc => allStoresInDistrict.push({ id: doc.id, ...doc.data() }));


    let randomStores = [];
    const numToRecommend = 3;

    if (category) {
        let storesInCategory = allStoresInDistrict.filter(s => s.category === category);
        let storesInOtherCategories = allStoresInDistrict.filter(s => s.category !== category);
        shuffleArray(storesInCategory);
        shuffleArray(storesInOtherCategories);

        const takeFromCategory = Math.min(storesInCategory.length, numToRecommend);
        randomStores = storesInCategory.slice(0, takeFromCategory);

        const remainingNeeded = numToRecommend - randomStores.length;
        if (remainingNeeded > 0 && storesInOtherCategories.length > 0) {
            const takeFromOthers = Math.min(remainingNeeded, storesInOtherCategories.length);
            randomStores.push(...storesInOtherCategories.slice(0, takeFromOthers));
        }
    } else {
        shuffleArray(allStoresInDistrict);
        randomStores = allStoresInDistrict.slice(0, numToRecommend);
    }

    return randomStores;
}

// --- 6. 產生 LINE Flex Message ---
function createStoreCarousel(stores, district, category) {
    const bubbles = stores.map(store => {
        const bodyContents = [
            {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                    { type: 'text', text: '分類', color: '#aaaaaa', size: 'sm', flex: 1 },
                    { type: 'text', text: store.category || '未分類', wrap: true, color: '#666666', size: 'sm', flex: 3 }
                ]
            },
            {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                    { type: 'text', text: '地址', color: '#aaaaaa', size: 'sm', flex: 1 },
                    { type: 'text', text: store.address || '未提供',
                      wrap: true, color: '#666666', size: 'sm', flex: 3 }
                ]
            }
        ];

        if (store.dishes) {
            bodyContents.push({
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                margin: 'md',
                contents: [
                    { type: 'text', text: '菜色', color: '#aaaaaa', size: 'sm', flex: 1 },
                    { type: 'text', text: store.dishes, wrap: true, color: '#666666', size: 'sm', flex: 3 }
                ]
            });
        }

        return {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'text',
                        text: store.name || '店家名稱',
                        weight: 'bold',
                        size: 'lg',
                        wrap: true,
                    }
                ]
            },
            body: {
                type: 'box',
                layout: 'vertical',
                contents: bodyContents
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                    {
                        type: 'button',
                        style: 'link',
                        height: 'sm',
                        action: {
                            type: 'uri',
                            label: '在 Google 地圖上查看',
                            uri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.address || store.name)}`
                        }
                    }
                ]
            }
        };
    });

    return {
        type: 'flex',
        altText: `為您從「${district}」推薦了 ${stores.length} 間店！`,
        contents: {
            type: 'carousel',
            contents: bubbles
        }
    };
}

// --- 7. 啟動伺服器 ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
