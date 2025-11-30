# 任務清單

## 多縣市支援更新 (Multi-City Support Update)
- [x] **設定檔**: 建立 `locations.js`，集中管理縣市與行政區定義
- [x] **資料庫遷移**: 更新 Firestore 查詢以使用統一的 `stores` 集合
- [x] **縣市過濾**: 在所有查詢中加入 `city` 欄位過濾
- [x] **推薦流程**: 更新 Line Bot 互動流程，新增「選擇縣市」步驟
- [x] **地理編碼**: 優化座標定位邏輯，支援跨縣市識別
- [x] **驗證**: 完成邏輯測試驗證

## 營業狀態標示 (Open Status Badge)
- [x] **邏輯實作**: 新增 `isOpenNow` 函式，支援跨日營業判斷
- [x] **UI 更新**: 在推薦卡片中顯示「營業中」或「休息中」標示
- [x] **Bug 修復**: 修正 `Intl.DateTimeFormat` 參數導致的崩潰問題
- [x] **UX 優化**: 改進位置服務範圍外的錯誤訊息，加入手動選擇引導
- [x] **流程簡化**: 移除分類選擇步驟，選完行政區直接推薦 <!-- id: 15 -->
- [x] **位置除錯**: 加入詳細 Log 以排查土城區無法識別的問題 <!-- id: 16 -->
- [x] **Bug 修復**: 修正 Google Geocoding API 行政區層級對應錯誤 (Level 1=City, Level 2=District)
- [x] **UI 優化**: 將「菜色」標籤改為「👍 招牌菜」 <!-- id: 17 -->
- [x] **免責聲明**: 推薦時顯示「營業時間資訊抓取自 Google Maps」提示 <!-- id: 18 -->
- [x] **UI 微調**: 將「👍 招牌菜」簡化為「👍」 <!-- id: 19 -->
- [x] **流程優化**: 收到位置訊息後直接推薦，移除確認步驟 <!-- id: 20 -->

## 流程優化 (Flow Optimization)
- [x] **位置推薦優化**: 改用 Quick Reply Location Action 直接開啟位置分享

## 圖文選單更新 (Rich Menu Update)
- [x] **示意圖**: 生成三欄式選單示意圖 (已由使用者提供圖片)
- [x] **程式修改**: 更新 `create-rich-menu.js` 定義三個點擊區域 (附近、縣市、官網)
- [x] **後端更新**: 在 `line-bot-server.js` 新增「選擇縣市」指令處理
- [x] **圖片上傳**: 建立 `upload-rich-menu-image.js` 腳本 (已完成)
- [x] **部署**: 建立、上傳並套用新選單

## 其他研究 (Other Research)
- [x] **聊天室背景**: 確認 Messaging API 不支援自動更改背景

## Maintenance
- [x] Git History Cleanup (Unified author to meijiasha.tw@gmail.com)
