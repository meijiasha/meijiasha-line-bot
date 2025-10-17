const axios = require('axios');
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
  // Handle non-message events first
  if (event.type !== 'message') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const sessionRef = db.collection('user_sessions').doc(userId);

  // Handle Location Message
  if (event.message.type === 'location') {
    const { latitude, longitude } = event.message;
    const district = await getDistrictFromCoordinates(latitude, longitude);

    if (district && taipeiDistricts.includes(district)) {
      await sessionRef.set({
        stage: 'location_received',
        latitude,
        longitude,
        district,
        createdAt: new Date()
      });
      const reply = {
        type: 'text',
        text: `您目前在「${district}」，要為您推薦附近的店家嗎？`,
        quickReply: {
          items: [{
            type: 'action',
            action: { type: 'message', label: '推薦附近店家', text: '推薦附近店家' }
          }]
        }
      };
      return client.replyMessage(event.replyToken, reply);
    } else {
      const reply = { type: 'text', text: '抱歉，您目前的位置似乎不在台北市範圍內喔。' };
      return client.replyMessage(event.replyToken, reply);
    }
  }

  // Handle Text Messages
  if (event.message.type === 'text') {
    const receivedText = event.message.text.trim();
    const sessionDoc = await sessionRef.get();
    const selectionState = sessionDoc.exists ? sessionDoc.data() : null;

    // Handle "推薦附近店家" button
    if (receivedText === '推薦附近店家' && selectionState && selectionState.stage === 'location_received') {
      const { latitude, longitude } = selectionState;
      await sessionRef.delete(); // Clean up session
      return performNearbyRecommendation(event.replyToken, latitude, longitude);
    }

    // Handle "Use current location" button
    if (receivedText === '📍 使用目前位置推薦') {
        const reply = { type: 'text', text: '好的，請點擊畫面左下角的「+」號，選擇「位置資訊」，並分享您的位置給我。' };
        return client.replyMessage(event.replyToken, reply);
    }

    // Handle "推薦" flow
    if (receivedText === '推薦') {
      await sessionRef.set({ stage: 'selecting_district', createdAt: new Date() });
      
      const districtItems = taipeiDistricts.map(district => ({
          type: 'action',
          action: { type: 'message', label: district, text: district }
      }));

      const locationItem = {
          type: 'action',
          action: { type: 'message', label: '📍 使用目前位置推薦', text: '📍 使用目前位置推薦' }
      };

      const reply = {
        type: 'text',
        text: '請選擇您想探索的台北市行政區，或使用您目前的位置：',
        quickReply: {
          items: [locationItem, ...districtItems].slice(0, 13)
        }
      };
      return client.replyMessage(event.replyToken, reply);
    }

    // Handle district selection in interactive flow
    if (selectionState && selectionState.stage === 'selecting_district' && taipeiDistricts.includes(receivedText)) {
      await sessionRef.update({ stage: 'selecting_category', district: receivedText });
      const categories = ['咖啡廳', '餐廳', '景點', '所有店家'];
      const reply = {
        type: 'text',
        text: `您選了「${receivedText}」。想找什麼樣的分類呢？`,
        quickReply: {
          items: categories.map(category => ({
            type: 'action',
            action: {
              type: 'message',
              label: category,
              text: category
            }
          }))
        }
      };
      return client.replyMessage(event.replyToken, reply);
    }

    // Handle category selection and provide recommendations in interactive flow
    if (selectionState && selectionState.stage === 'selecting_category') {
      const district = selectionState.district;
      const categoryInput = receivedText;
      const validCategories = ['咖啡廳', '餐廳', '景點', '所有店家'];

      if (validCategories.includes(categoryInput)) {
        const category = categoryInput === '所有店家' ? null : categoryInput;
        await sessionRef.delete(); // End of flow
        return performRecommendation(event.replyToken, district, category);
      }
    }

    // All other messages will fall through to here.
    // Guide the user to start the recommendation flow.
    const reply = { type: 'text', text: `您好！請試著傳送「推薦」，讓我為您尋找台北市的好去處！` };
    return client.replyMessage(event.replyToken, reply);
  }

  return Promise.resolve(null);
}

// Helper function to perform recommendation and reply
async function performRecommendation(replyToken, district, category) {
  try {
    const stores = await getRecommendations(district, category);
    if (!stores || stores.length === 0) {
      const reply = { type: 'text', text: `抱歉，在「${district}」${category ? `的「${category}」分類中` : ''}找不到可推薦的店家。` };
      return client.replyMessage(replyToken, reply);
    }
    const reply = createStoreCarousel(stores, district, category);
    return client.replyMessage(replyToken, reply);
  } catch (error) {
    console.error("Recommendation Error:", error);
    const reply = { type: 'text', text: '哎呀，推薦功能好像出了一點問題，請稍後再試。' };
    return client.replyMessage(replyToken, reply);
  }
}

// New Helper: Perform nearby recommendation and reply
async function performNearbyRecommendation(replyToken, latitude, longitude) {
    try {
        const stores = await getNearbyRecommendations(latitude, longitude);
        if (!stores || stores.length === 0) {
            const reply = { type: 'text', text: `抱歉，在您附近找不到可推薦的店家。` };
            return client.replyMessage(replyToken, reply);
        }
        const reply = createStoreCarousel(stores, '您附近');
        return client.replyMessage(replyToken, reply);
    } catch (error) {
        console.error("Nearby Recommendation Error:", error);
        const reply = { type: 'text', text: '哎呀，推薦附近店家功能好像出了一點問題，請稍後再試。' };
        return client.replyMessage(replyToken, reply);
    }
}


// --- 5. 核心推薦邏輯 ---

// New Helper: Get district from coordinates using Google Geocoding API
async function getDistrictFromCoordinates(latitude, longitude) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        console.error('Google Maps API key is not set.');
        return null;
    }
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}&language=zh-TW`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status !== 'OK') {
            console.error(`Google Geocoding API returned status: ${data.status}. Response: ${JSON.stringify(data)}`);
        }

        if (data.status === 'OK' && data.results.length > 0) {
            const addressComponents = data.results[0].address_components;
            const cityComponent = addressComponents.find(c => c.types.includes('administrative_area_level_2'));
            const districtComponent = addressComponents.find(c => c.types.includes('administrative_area_level_3') || c.types.includes('sublocality_level_1'));

            if (cityComponent && cityComponent.long_name === '台北市' && districtComponent && taipeiDistricts.includes(districtComponent.long_name)) {
                return districtComponent.long_name;
            }
        }
        return null;
    } catch (error) {
        console.error('Google Geocoding API error:', error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
    }
}

// New Helper: Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    if ((lat1 == lat2) && (lon1 == lon2)) {
        return 0;
    }
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// New Helper: Get nearby recommendations
async function getNearbyRecommendations(latitude, longitude) {
    if (!db) throw new Error('Firestore is not initialized.');

    const district = await getDistrictFromCoordinates(latitude, longitude);
    if (!district) return [];

    const snapshot = await db.collection('stores_taipei').where('district', '==', district).get();
    if (snapshot.empty) {
        return [];
    }

    const storesInDistrict = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        // Assuming store data has latitude and longitude fields
        if (data.latitude && data.longitude) {
            storesInDistrict.push({ id: doc.id, ...data });
        }
    });

    if (storesInDistrict.length === 0) return [];

    // Calculate distance for each store
    const storesWithDistance = storesInDistrict.map(store => {
        const distance = calculateDistance(latitude, longitude, store.latitude, store.longitude);
        return { ...store, distance };
    });

    // Sort by distance and take the top 3
    storesWithDistance.sort((a, b) => a.distance - b.distance);
    return storesWithDistance.slice(0, 3);
}

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
                    },
                    {
                        type: 'text',
                        text: store.category || '未分類',
                        size: 'md',
                        color: '#666666',
                        wrap: true,
                        margin: 'md'
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
