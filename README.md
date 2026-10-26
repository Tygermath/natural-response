# Natural Response

英文情境回應語料庫與練習卡。A corpus of natural English replies, with practice cards.

一個情境 × 回應目的 × 溝通形式 = 一筆語料（回應 + 語塊）。
One record = situation × intention × channel → a reply and its reusable chunks.

## 使用 Usage

- 網址 URL：GitHub Pages（見 repo 右側 About / Deployments）。手機、平板、電腦都可用，可「加入主畫面」。
  Works on phone, tablet and desktop; can be added to the home screen.
- **設定 → Claude API key**：AI 產生回應用，只存在該裝置的瀏覽器。
  Used to generate replies; stored only in that device's browser.
- **設定 → 跨裝置同步**：在每台裝置填入同一個 GitHub token（只需 Gist 權限）。語料庫存在你帳號的私密 Gist，保留每次修改的版本。
  Enter the same GitHub token (Gist permission only) on each device; the corpus lives in a secret Gist with full revision history.

## 用語 Wording

| 中文 | English |
|---|---|
| 情境 / 情境說明 | Situation / Situation details |
| 回應目的 | Intention |
| 溝通形式 | Channel |
| 回應 | Reply |
| 語塊 | Chunks |
| 待審核 / 已審核 | To review / Approved |
| 熟練 | Mastered |
| 群組訊息 / 口頭對話 / 正式書信 | Group chat / Spoken / Formal writing |
| 知悉 / 讚許 / 糾正 / 責備 / 鼓勵 / 追問 | Acknowledge / Praise / Correct / Reprimand / Encourage / Follow-up |

## 開發 Development

```
node server.mjs   # http://localhost:8765
npm test
```

純前端，沒有後端；`public/` 就是整個網站。No backend: `public/` is the whole site.
