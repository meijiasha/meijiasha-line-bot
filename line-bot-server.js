require('dotenv').config();
const axios = require('axios');
const express = require('express');
const line = require('@line/bot-sdk');
const firebase = require('firebase-admin');
const { CITIES, DISTRICTS } = require('./locations');

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
    const locationInfo = await getDistrictFromCoordinates(latitude, longitude);

    if (locationInfo) {
      const { city, district } = locationInfo;
      // Directly perform recommendation
      return performNearbyRecommendation(event.replyToken, latitude, longitude);
    } else {
      const reply = {
        type: 'text',
        text: '抱歉，我們目前尚未收錄您所在位置（或該區域）的店家資料。\n\n不過，您還是可以透過「手動選擇」來探索其他地區的美食喔！',
        quickReply: {
          items: [{
            type: 'action',
            action: { type: 'message', label: '手動選擇縣市', text: '推薦' }
          }]
        }
      };
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



    // Handle "推薦" flow - Step 1: Select City
    if (receivedText === '推薦') {
      await sessionRef.set({ stage: 'selecting_city', createdAt: new Date() });

      const cityItems = Object.values(CITIES).map(city => ({
        type: 'action',
        action: { type: 'message', label: city, text: city }
      }));

      const locationItem = {
        type: 'action',
        action: { type: 'location', label: '📍 使用目前位置推薦' }
      };

      const reply = {
        type: 'text',
        text: '請選擇您想探索的縣市，或使用您目前的位置：',
        quickReply: {
          items: [locationItem, ...cityItems].slice(0, 13)
        }
      };
      return client.replyMessage(event.replyToken, reply);
    }

    // Handle "Use current location" button (Legacy text fallback, though action should be location now)
    // If user manually types this or hits an old button
    if (receivedText === '📍 使用目前位置推薦') {
      const reply = {
        type: 'text',
        text: '請點擊下方按鈕分享您的位置：',
        quickReply: {
          items: [{
            type: 'action',
            action: { type: 'location', label: '📍 分享目前位置' }
          }]
        }
      };
      return client.replyMessage(event.replyToken, reply);
    }
    // Handle City selection - Step 2: Select District
    if (selectionState && selectionState.stage === 'selecting_city' && Object.values(CITIES).includes(receivedText)) {
      const selectedCity = receivedText;
      await sessionRef.update({ stage: 'selecting_district', city: selectedCity });

      const districts = DISTRICTS[selectedCity] || [];
      const districtItems = districts.map(district => ({
        type: 'action',
        action: { type: 'message', label: district, text: district }
      }));

      const reply = {
        type: 'text',
        text: `您選擇了${selectedCity}，請選擇行政區：`,
        quickReply: {
          items: districtItems.slice(0, 13) // Limit to 13 items for Quick Reply
        }
      };
      return client.replyMessage(event.replyToken, reply);
    }

    // Handle District selection - Step 3: Show Recommendations (Skip Category)
    if (selectionState && selectionState.stage === 'selecting_district') {
      const selectedCity = selectionState.city;
      const districts = DISTRICTS[selectedCity] || [];

      if (districts.includes(receivedText)) {
        const selectedDistrict = receivedText;

        // Directly perform recommendation without asking for category
        await sessionRef.delete(); // End of flow
        return performRecommendation(event.replyToken, selectedCity, selectedDistrict, null);
      }
    }

    // All other messages will fall through to here.
    // Guide the user to start the recommendation flow.
    const reply = { type: 'text', text: `您好！請試著傳送「推薦」，讓我為您尋找好去處！` };
    return client.replyMessage(event.replyToken, reply);
  }

  return Promise.resolve(null);
}

// Helper function to perform recommendation and reply
async function performRecommendation(replyToken, city, district, category) {
  try {
    const stores = await getRecommendations(city, district, category);
    if (!stores || stores.length === 0) {
      const reply = { type: 'text', text: `抱歉，在「${city}${district}」找不到可推薦的店家。` };
      return client.replyMessage(replyToken, reply);
    }
    const carousel = createStoreCarousel(stores, district, category);
    const disclaimer = { type: 'text', text: '* 營業時間資訊抓取自 Google Maps ，還請確認營業時間。' };
    return client.replyMessage(replyToken, [carousel, disclaimer]);
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
    const carousel = createStoreCarousel(stores, '您附近');
    const disclaimer = { type: 'text', text: '* 營業時間資訊抓取自 Google Maps ，還請確認營業時間。' };
    return client.replyMessage(replyToken, [carousel, disclaimer]);
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
      console.log('Geocoding Components:', JSON.stringify(addressComponents)); // DEBUG LOG

      // For Taiwan:
      // administrative_area_level_1 = City (e.g., 新北市, 台北市)
      // administrative_area_level_2 = District (e.g., 土城區, 大安區)
      const cityComponent = addressComponents.find(c => c.types.includes('administrative_area_level_1'));
      const districtComponent = addressComponents.find(c => c.types.includes('administrative_area_level_2'));

      if (cityComponent && districtComponent) {
        const cityName = cityComponent.long_name;
        const districtName = districtComponent.long_name;

        console.log(`Detected: City=${cityName}, District=${districtName}`); // DEBUG LOG

        // Check if the city is supported
        if (Object.values(CITIES).includes(cityName)) {
          // Check if the district is valid for that city
          if (DISTRICTS[cityName] && DISTRICTS[cityName].includes(districtName)) {
            return { city: cityName, district: districtName };
          } else {
            console.log(`District mismatch: ${districtName} not in ${cityName} list.`); // DEBUG LOG
          }
        } else {
          console.log(`City mismatch: ${cityName} not supported.`); // DEBUG LOG
        }
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

  const locationInfo = await getDistrictFromCoordinates(latitude, longitude);
  if (!locationInfo) return [];

  const { city, district } = locationInfo;

  // Query the unified 'stores' collection with city and district filters
  const snapshot = await db.collection('stores')
    .where('city', '==', city)
    .where('district', '==', district)
    .get();

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

async function getUniqueCategoriesForDistrict(city, district) {
  if (!db) throw new Error('Firestore is not initialized.');

  const snapshot = await db.collection('stores')
    .where('city', '==', city)
    .where('district', '==', district)
    .get();

  if (snapshot.empty) {
    return [];
  }
  const categories = new Set();
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.category) {
      categories.add(data.category);
    }
  });
  return [...categories];
}

async function getRecommendations(city, district, category) {
  if (!db) throw new Error('Firestore is not initialized.');

  const snapshot = await db.collection('stores')
    .where('city', '==', city)
    .where('district', '==', district)
    .get();

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
    const isOpen = isOpenNow(store.opening_hours_periods);
    let statusText = '';
    let statusColor = '#aaaaaa';

    if (isOpen === true) {
      statusText = '營業中';
      statusColor = '#1DB446'; // Green
    } else if (isOpen === false) {
      statusText = '休息中';
      statusColor = '#FF334B'; // Red
    }
    // If null, we don't show anything or show '未知'

    const bodyContents = [
      {
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '地址', color: '#aaaaaa', size: 'sm', flex: 1 },
          {
            type: 'text', text: store.address || '未提供',
            wrap: true, color: '#666666', size: 'sm', flex: 3
          }
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
          { type: 'text', text: '👍', color: '#aaaaaa', size: 'sm', flex: 1 },
          { type: 'text', text: store.dishes, wrap: true, color: '#666666', size: 'sm', flex: 3 }
        ]
      });
    }

    // Header contents with Badge
    const headerContents = [
      {
        type: 'text',
        text: store.name || '店家名稱',
        weight: 'bold',
        size: 'lg',
        wrap: true,
      },
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          {
            type: 'text',
            text: store.category || '未分類',
            size: 'md',
            color: '#666666',
            wrap: true,
            flex: 0
          }
        ]
      }
    ];

    // Add Status Badge if status is known
    if (statusText) {
      headerContents[1].contents.push({
        type: 'text',
        text: ` · ${statusText}`,
        size: 'md',
        color: statusColor,
        weight: 'bold',
        wrap: true,
        margin: 'sm',
        flex: 0
      });
    }

    return {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: headerContents
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

// Helper: Check if store is open now
function isOpenNow(periods) {
  if (!periods || !Array.isArray(periods) || periods.length === 0) {
    return null; // Unknown
  }

  // Get current time in Taipei
  const now = new Date();

  // Use toLocaleString to get the time in Taipei
  // We don't need Intl.DateTimeFormat with 'weekday: numeric' which causes a crash
  const taipeiTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' });
  const taipeiDate = new Date(taipeiTimeStr);

  // Check if date parsing was successful
  if (isNaN(taipeiDate.getTime())) {
    console.error('Failed to parse Taipei time:', taipeiTimeStr);
    return null;
  }

  const currentDay = taipeiDate.getDay(); // 0 (Sun) - 6 (Sat)
  const currentHours = taipeiDate.getHours();
  const currentMinutes = taipeiDate.getMinutes();
  const currentTime = currentHours * 100 + currentMinutes; // HHMM format as integer

  for (const period of periods) {
    if (!period.open) continue;

    const openDay = period.open.day;
    const openTime = parseInt(period.open.time);

    if (period.close) {
      const closeDay = period.close.day;
      const closeTime = parseInt(period.close.time);

      if (openDay === closeDay) {
        // Same day open/close
        if (currentDay === openDay) {
          if (currentTime >= openTime && currentTime < closeTime) {
            return true;
          }
        }
      } else {
        // Cross midnight (e.g. Open Mon 2200, Close Tue 0200)
        // Case 1: Current is Open Day (Mon)
        if (currentDay === openDay) {
          if (currentTime >= openTime) {
            return true;
          }
        }
        // Case 2: Current is Close Day (Tue)
        if (currentDay === closeDay) {
          if (currentTime < closeTime) {
            return true;
          }
        }
      }
    } else {
      // No close time usually means open 24 hours for that day? 
      if (currentDay === openDay) return true;
    }
  }

  return false;
}

// --- 8. 啟動伺服器 ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});