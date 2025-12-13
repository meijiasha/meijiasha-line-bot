const { CITIES, DISTRICTS } = require('./locations');

function normalizeAddressText(text) {
    if (!text) return text;
    return text.replace(/臺/g, '台');
}

function parseDistrictFromAddress(addressText) {
    if (!addressText) return null;

    addressText = normalizeAddressText(addressText);

    // Construct regex dynamically from supported cities
    const cities = Object.values(CITIES).sort((a, b) => b.length - a.length);
    const cityPattern = cities.join('|');
    const regex = new RegExp(`(?<city>${cityPattern})(?<district>.{1,4}[區鄉鎮市])`);

    const match = addressText.match(regex);

    if (match && match.groups) {
        const { city, district } = match.groups;

        // Validate against supported locations
        if (Object.values(CITIES).includes(city)) {
            if (DISTRICTS[city] && DISTRICTS[city].includes(district)) {
                return { city, district };
            }
        }
    }
    return null;
}

// Test Cases
const testCases = [
    "106台北市大安區信義路",          // Valid: Taipei Da'an
    "106臺北市大安區信義路",          // Check normalization: 臺北市 -> 台北市
    "台灣新北市土城區中央路",        // Valid: New Taipei Tucheng
    "桃園市龜山區文化一路",          // Invalid: Taoyuan not in CITIES
    "台北市不明區",                  // Invalid: District not in DISTRICTS
    "Just some random text",         // Invalid: No regex match
    "新北市板橋區",                  // Valid: New Taipei Banqiao
    "高雄市三民區",                 // Valid: Kaohsiung Sanmin
    "Some123台北市中正區Road",       // Valid: Taipei Zhongzheng
    null                             // Invalid: null
];

console.log("=== Testing parseDistrictFromAddress Logic V2 ===\n");

testCases.forEach(addr => {
    const result = parseDistrictFromAddress(addr);
    const resultStr = result ? `✅ OK: ${result.city} - ${result.district}` : "❌ Fallback (to Google API)";
    console.log(`Address: "${addr}" -> ${resultStr}`);
});
