# Task: Optimize LINE Bot Location Handling for Cost Reduction

## 1. Context & Objective
**Goal:** Reduce Google Maps Geocoding API costs in the LINE Bot backend.

**Current Behavior:**
In `line-bot-server.js`, the `handleEvent` function triggers a Google Maps Geocoding API call (`getDistrictFromCoordinates`) *every time* a user sends a location message.

**Target Behavior:**
The LINE Messaging API's `location` event payload already includes an `address` text field (e.g., "106台北市大安區..."). We should prioritize parsing this text string to extract the City and District. We should only fallback to the paid Google API if text parsing fails or returns an invalid location.

## 2. Target Files
- `line-bot-server.js` (Main logic modification)
- `locations.js` (Reference for validation logic, already imported)

## 3. Implementation Steps

### Step 1: Create Helper Function `parseDistrictFromAddress`
Add a new function in `line-bot-server.js` to parse the address string.

* **Input:** `addressText` (string)
* **Logic:**
    1.  Use a Regular Expression to extract the City (縣/市) and District (區/鄉/鎮/市).
    2.  **Regex Suggestion:** `/(?<city>.{2,3}[縣市])(?<district>.{1,4}[區鄉鎮市])/`
    3.  **Validation:**
        * Check if the extracted `city` exists in the `CITIES` values (from `locations.js`).
        * Check if the extracted `district` exists in the `DISTRICTS[city]` array.
* **Output:** Return an object `{ city, district }` if valid, otherwise return `null`.

### Step 2: Modify `handleEvent` Logic
Locate the block handling `event.message.type === 'location'`.

* **Destructure:** Extract `address` along with `latitude` and `longitude` from `event.message`.
* **Flow Update:**
    1.  Call `const parsedLocation = parseDistrictFromAddress(address);`
    2.  **IF `parsedLocation` is valid:**
        * Use `parsedLocation.city` and `parsedLocation.district` directly.
        * Log a message: `[Optimization] Location parsed from text: ${city} ${district}`.
        * Proceed to `performNearbyRecommendation`.
    3.  **ELSE (Fallback):**
        * Call the existing `getDistrictFromCoordinates(latitude, longitude)`.
        * Log a message: `[Fallback] Parsing failed for "${address}", using Google API`.

## 4. Code Snippets for Reference

### Existing `locations.js` Export Structure
```javascript
// locations.js
module.exports = {
  CITIES: {
    Taipei: "台北市",
    NewTaipei: "新北市",
    // ...
  },
  DISTRICTS: {
    "台北市": ["中正區", "大同區", ...],
    // ...
  }
};
```

### Current `handleEvent` Implementation (To be changed)
```javascript
// line-bot-server.js
if (event.message.type === 'location') {
  const { latitude, longitude } = event.message; // Missing 'address'
  const locationInfo = await getDistrictFromCoordinates(latitude, longitude);
  
  if (locationInfo) {
    // ... logic ...
  }
  // ...
}
```

## 5. Acceptance Criteria
1.  **Regex Accuracy:** The regex must correctly handle standard Taiwan address formats (e.g., "106台北市大安區...", "台灣新北市土城區...").
2.  **Validation:** The parsed city/district must match the allowed list in `locations.js`.
3.  **Fallback Safety:** If the user is in an unsupported area (e.g., "Taoyuan City") or the address format is weird, the system must gracefully fall back to the existing Google API or error handling flow.
4.  **Zero Cost Path:** If a valid Taipei/New Taipei address is sent, no Google API request should be made.