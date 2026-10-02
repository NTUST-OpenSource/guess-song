<div align="center">
<a href="https://song.ntust.org">
  <img width="2000" src=".github/assets/banner.png" alt="誰是猜歌王 Banner"/>
</a>
<br>

[![License](https://img.shields.io/github/license/NTUST-OpenSource/guess-song?style=for-the-badge)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![JavaScript](https://img.shields.io/badge/Vanilla-JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)

 **繁體中文** | [English](README-en.md)

</div>

## 總覽

<a href="https://song.ntust.org/">

<img align="right" width="260" alt="玩家手機的收卷畫面" src=".github/assets/hero.png" />

</a>

三『資』小豬・誰是猜歌王是一套猜歌遊戲的計分與手機作答系統

主持人放歌，玩家用手機回答年份、歌手和歌名。收卷後系統自動批改、加分，投影的計分板同步更新

### **頁面**
- **玩家手機**（`/`）— 輸入名字和組別代碼加入，作答後看對錯、得分和各組排名
- **投影計分板**（`/scoreboard`）— 全螢幕顯示各組總分，可以切換固定格或排名長條
- **後台控制台**（`/dashboard`）— 選歌、發題、收卷，查看作答狀況、改判、調整分數
- **主持人**（`/host`）— 用大字顯示解答，以及各組這題的得分和最高分的人

### **特色**
- **即時同步** — 每一頁都用 WebSocket 接收更新，不用重新整理
- **自動批改** — 年份精準 +3、差 3 年以內 +1；歌手、歌名各 +1，同音字和小錯字也算對；每組每項取組內最高分
- **比賽動畫** — 發題時倒數，收卷時揭曉對錯、名次換位，並自動產生戰況短評
- **四組或五組** — 一個設定就能切換，第五組是青色星形
- **免費方案就夠** — 一場約 40 人、70 首歌的活動，估算只用到 Workers 免費方案每日請求額度的三成多

<br clear="right"/>

## Demo

<a href=".github/assets/demo.mp4">
  <img width="2000" src=".github/assets/demo.webp" alt="誰是猜歌王 Demo：控制台、計分板與玩家手機同步更新" />
</a>

用假資料打兩題：
- 發題後所有手機同時倒數，答案即時出現在後台。
- 收卷後計分板分數往上跳，名次跟著換位。

點圖片可以看[完整影片](.github/assets/demo.mp4)（1 分 43 秒）

<br/>

## 快速開始

### 需求

- Node 22 以上（執行 wrangler 和測試）
- Cloudflare 帳號（部署時需要）

### 本機開發

```bash
git clone https://github.com/NTUST-OpenSource/guess-song.git
cd guess-song

npm ci                           # 安裝 wrangler 和 pinyin-pro
cp .dev.vars.example .dev.vars   # 填入後台帳密和 AUTH_SECRET
npm test                         # 測試
npm run dev                      # 本機伺服器
```

開啟 <http://localhost:8787>，後台從 `/login` 登入。

> [!NOTE]
> 專案沒有 build 步驟，`public/` 裡的靜態檔直接上線；npm 只用來安裝 wrangler，以及比對同音字用的 pinyin-pro（部署時由 wrangler 打包進 Worker）

### 環境變數

| 名稱 | 用途 |
|---|---|
| `USERNAME` | 後台帳號，控制台和主持人共用 |
| `PASSWORD` | 後台密碼 |
| `AUTH_SECRET` | 簽 token 用的隨機字串（`openssl rand -base64 32`）。換掉會立刻登出所有人，包含玩家 |
| `FIVE_GROUPS` | 選填。設成 `1`、`true` 或 `True` 時有第五組，每一頁和網站圖示都會變成五組；其他值或不設定就是四組 |

本機開發寫在 `.dev.vars`。正式環境四個都用 secret 設定：

```bash
npx wrangler secret put USERNAME
npx wrangler secret put PASSWORD
npx wrangler secret put AUTH_SECRET
npx wrangler secret put FIVE_GROUPS   # 要五組時才設
```

> [!IMPORTANT]
> `FIVE_GROUPS` 不是機密，但也要用 secret 設定。在 Cloudflare 後台設定的一般變數，會在下次部署時被清掉

### 部署

`main` 合併後，Workers Builds 會自動部署到 <https://song.ntust.org>。網域和帳號設定在 `wrangler.jsonc`，要手動部署就執行 `npm run deploy`

<br/>

## 比賽流程

1. 賽前在控制台按齒輪，設定各組的組別代碼，並上傳歌單
2. 選歌（或按「下一首」），主持人頁會顯示這首的解答
3. 按「發題」，所有手機同時倒數並開始作答；按「收卷並計分」就會自動批改並加分
4. 收卷後可以在「作答狀況」點分數改判，總分會自動加減差額

### 歌單

歌單含有解答，不要放進 git。照 `songs.example.json` 的格式寫成 `songs.json`（`songs*.json` 已加入 gitignore），再到控制台設定的「歌單與解答」上傳

```json
[
    {
        "year": 2000,
        "artist": ["範例歌手", "Example Artist"],
        "title": "範例歌名",
        "youtube": "https://www.youtube.com/watch?v=xxxxxxxxxxx"
    },
    { "year": 2010, "artist": "另一位歌手", "title": ["另一首歌", "別名"] }
]
```

- `artist` 和 `title` 可以是字串或陣列，陣列裡的每種寫法都算對
- `youtube` 選填，只接受 http 和 https 網址
  - 有填：控制台會出現播放連結，收卷後玩家手機會顯示影片縮圖
  - 沒填：連結改成到 YouTube 搜尋這首歌
- 歌依照順序編號。收過卷的歌只能原地修正解答，要加歌請加在最後面
- 解答只存在伺服器，玩家要等那一題收卷後才拿得到

### 計分

- 年份精準 +3、差 3 年以內 +1；歌手、歌名答對各 +1。比對時忽略大小寫、全形半形、空白、標點和重音符號
  - 中文同音字算對，簡體字、「妳」和「你」也算；zh/z、ch/c、sh/s、-ng/-n 視為同音。多一個字、少一個字或換成別的字都不算，常見的簡稱要自己加進歌單
  - 英文和數字容許拼錯：不算空白和標點，4 個字元以內要完全一樣，5 到 8 個可以錯 1 個，9 個以上可以錯 2 個，相鄰兩個字母對調算錯 1 個；數字一定要對
  - 只跟該題的解答比，比對規則在 `src/match.js`
- 每組每一項取組內最高分，所以一組一題最多 +5
- 收卷後改判或修正歌單，總分會自動加減差額
- 戰況短評的判斷條件和用詞在 `src/notes.js`

<br/>

## 技術棧

| 項目 | 選用 |
|---|---|
| 後端 | Cloudflare Workers；分數、歌單、作答都存在一個 Durable Object（`Scores`） |
| 即時同步 | WebSocket（Durable Object hibernation），每頁一條連線，不輪詢 |
| 前端 | 純 HTML、CSS、JavaScript，沒有框架也沒有 build |
| 靜態檔 | Workers Static Assets |
| 部署 | Workers Builds，`main` 自動部署 |
| 測試 | `npm test`（Node 內建的 test runner 和 assert） |
| CI | GitHub Actions 跑測試並試打包 Worker；Dependabot 每週更新 wrangler 和 Actions |

### 專案結構

```
src/index.js              Worker 與 Durable Object：API、WebSocket、批改與計分
src/match.js              比對歌手和歌名：正規化、同音字和拼錯
src/notes.js              收卷後的戰況短評
public/index.html         玩家手機
public/scoreboard.html    投影計分板
public/dashboard.html     控制台與主持人（同一頁的兩個畫面，/host 會轉到這裡）
public/login.html         後台登入
public/css/               base（共用）、play、admin、scoreboard
public/js/                各頁的腳本；live.js 負責 WebSocket，scores.js 負責更新分數
public/five/              五組時的網站圖示
test/                     API 與計分的測試
.github/                  CI、Dependabot 與 README 圖片
package.json              wrangler 版本與 npm 指令
wrangler.jsonc            Worker、網域、Durable Object 與靜態檔設定
```

<br/>

## API

<details>
<summary>端點一覽</summary>

POST 的參數都是 JSON，只有登入用表單

| 端點 | 參數 | 說明 |
|---|---|---|
| `GET /api/GetScore` | — | 回 `{"1":0,...,"4":0}`，五組時多一個 `"5"` |
| `GET /api/groups.js` | — | 一行 JS，把組數標在 `<html data-groups>`；每一頁都在 `<head>` 先載入它 |
| `POST /api/login` | `username`、`password` | 回 `{status, msg, token}`，token 12 小時後到期 |
| `POST /api/AddScore` | `token`、`group`、`delta` | 加減 `delta` 分（可以是負數，結果限制在 0–999） |
| `POST /api/SetScore` | `token`、`group`、`score` | 直接指定分數 |
| `POST /api/join` | `name`、`code` | 用組別代碼加入（不分大小寫），回傳 `group` 和玩家 token |
| `GET /api/ws` | `token`（query，選填） | WebSocket。帶玩家 token 時推送自己的狀態，不帶時只推送總分；token 失效時第一則訊息會帶 `rejoin: true` |
| `POST /api/play/state` | `token` | 跟 WebSocket 推送的內容相同；收卷後多一個 `result` |
| `POST /api/play/history` | `token` | 收過卷的題目，最近的在最上面 |
| `POST /api/play/answer` | `token`、`year`、`artist`、`title` | 作答中可以重複送出，以最後一次為準 |
| `POST /api/admin/<action>` | `token` 等 | 後台管理。`action` 是 `state`、`songs`、`select`、`open`、`close`、`judge`、`passwords`、`reset`，參數見 `src/index.js` 的 `handleAdmin` |

- `group` 是 1–4 的整數，五組時是 1–5；`score` 是 0–999 的整數
- 認證失敗回 401，參數錯誤回 400
- 登出只會清掉瀏覽器裡的 token。token 是無狀態簽章，要強制撤銷就換 `AUTH_SECRET`

</details>

<br/>

## 貢獻

歡迎開 [Issue](https://github.com/NTUST-OpenSource/guess-song/issues) 回報問題，或發 Pull Request

PR 送出前請確認

1. UI 文案和文件一律用繁體中文；程式碼註解一律用英文
2. commit 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hant/v1.0.0/)
3. 分支命名為 `feat/your-feature` 或 `fix/your-fix`
4. `npm test` 通過
5. 不使用 Emoji

<br/>

## 授權

Copyright (C) 2026 xinshoutw

本專案採用 **GNU Affero General Public License v3.0** 授權，完整條款見 [LICENSE](LICENSE)

<br/>

## 免責聲明

本專案與國立臺灣科技大學沒有官方關聯
