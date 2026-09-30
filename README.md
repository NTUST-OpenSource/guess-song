# 三『資』小豬 — 誰是猜歌王

猜歌遊戲的計分與手機作答系統，跑在 Cloudflare Workers。前端靜態檔（`public/`）由 Workers Static Assets 直接送，
`/api/*` 交給 Worker（`src/index.js`）。分數、歌單、作答紀錄都存在單一個 Durable Object（`Scores`）。
網域和 Cloudflare 帳號設定在 `wrangler.jsonc`。

## 需要的設定

### 1. KV namespace（只用來搬舊分數）

分數現在存在 Durable Object，KV 只在 DO 第一次啟動時用來搬舊版的分數，之後可以拆掉。
已經建好並寫進 `wrangler.jsonc` 了。要重建的話：

```shell
npx wrangler kv namespace create song-kv
```

把印出來的 `id` 填進 `wrangler.jsonc` 的 `kv_namespaces[0].id`（`binding` 一定要是 `KV`，程式碼用的是這個名字）。

### 2. 環境變數（三個都是 secret，不要寫進 wrangler.jsonc）

| 名稱 | 用途 |
|---|---|
| `USERNAME` | 後台帳號（`/dashboard` 和 `/host` 共用） |
| `PASSWORD` | 後台密碼 |
| `AUTH_SECRET` | 簽 token 用的密鑰，隨機字串（`openssl rand -base64 32`）。換掉它 = 立刻登出所有人（包含玩家） |

正式環境：

```shell
npx wrangler secret put USERNAME
npx wrangler secret put PASSWORD
npx wrangler secret put AUTH_SECRET
```

本機開發：`cp .dev.vars.example .dev.vars` 後填值（`.dev.vars` 已 gitignore）。

## 開發 / 部署

```shell
node test.mjs            # 煙霧測試
npx wrangler dev         # 本機 http://localhost:8787
npx wrangler deploy
```

## 頁面

| 路徑 | 說明 |
|---|---|
| `/` | 玩家用手機作答（名字＋組別代碼，代碼決定組別）。最上方固定顯示四組總分；收卷後有跑馬燈，下面列出收過卷的題目：縮圖、解答、自己的答案與每項得分、各組這題得分 |
| `/scoreboard` | 投影用的大計分板，每秒更新 |
| `/login` | 後台登入；從 `/host` 被導過來的，登入後會回到 `/host` |
| `/dashboard` | 四組分數用上下箭頭加減（按了就存），或直接輸入按 Enter 存；選歌 / 發題 / 收卷、作答狀況與改判、組別代碼、歌單、重置所有資料 |
| `/host` | 主持人用：上方四組分數，下方大字顯示後台選到那首歌的解答，可以發題 / 收卷（帳密同後台） |

## 比賽流程

1. 賽前在後台設好四組的組別代碼、上傳歌單。
2. 在後台下拉選單選歌，`/host` 會立刻顯示這首的年份、歌手、歌名給主持人看（還沒發題也看得到）。
3. 在後台或 `/host` 按「發題」，玩家手機開始作答；按「收卷並計分」自動批改並加分。
4. 收卷後可以在後台「作答狀況」點分數改判，總分會自動加減差額。

## API

| 路徑 | Method | Body | 說明 |
|---|---|---|---|
| `/api/GetScore` | GET | — | 回 `{"1":0,...,"4":0}` |
| `/api/login` | POST | form: `username`, `password` | 回 `{status, msg, token}`，token 12 小時到期 |
| `/api/AddScore` | POST | json: `token`, `group`, `delta` | 加減 `delta` 分（可負，結果夾在 0–999）；沒帶 `delta` 時沿用舊的 `year`, `name`, `sing`, `dance`，每個 `true` 加 1 分 |
| `/api/SetScore` | POST | json: `token`, `group`, `score` | 直接指定分數 |
| `/api/join` | POST | json: `name`, `code` | 用組別代碼加入（不分大小寫），回 `group` 和玩家 token |
| `/api/play/state` | POST | json: `token` | 目前題號、是否作答中、自己的答案（不含解答）、收卷後的跑馬燈內容、四組總分、自己的組別、歷史版本號 `histRev` |
| `/api/play/history` | POST | json: `token` | 收過卷的題目，最近收卷的在上：解答、縮圖、自己的答案與每項得分、各組這題得分。作答中的那題不會出現；手機看到 `histRev` 變了才重抓 |
| `/api/play/answer` | POST | json: `token`, `year`, `artist`, `title` | 作答中可重複送出，以最後一次為準 |
| `/api/admin/{state,songs,select,open,close,judge,passwords,reset}` | POST | json: `token`, ... | 後台作答管理，參數見 `src/index.js` 的 `handleAdmin` |

`group` 是 1–4 的整數，`score` 是 0–999 的整數。認證失敗回 401，參數錯回 400。

`admin/select` 記錄後台目前選到的歌（`songId`），`admin/state` 沒帶 `songId` 時就回這首，`/host` 靠這個顯示解答；發題也會把選到的歌設成那一首。

## 歌單

歌單含解答，**不能進 git**：照 `songs.example.json` 的格式寫成 `songs.json`（`songs*.json` 已 gitignore），
在後台「歌單與解答」選檔上傳。解答只存在伺服器的 Durable Object，玩家端 API 只有在那一題收卷後才拿得到那一題的解答。
每首可以加 `youtube` 網址（選填，只收 http/https），後台發題時會出現播放連結；沒填就連到 YouTube 用「歌名 歌手」搜尋。
收卷後玩家手機會顯示這首的 YouTube 縮圖（沒填或不是 YouTube 網址就不顯示）；作答中不會送出任何影片資訊。
歌是用順序編號的，比賽開始後不要調換順序。

計分：收卷時自動批改。年份精準 +3、差 3 年以內 +1；歌手、歌名答對各 +1（忽略大小寫、全半形、空白和標點）。
每組每項取組內最高分，所以一組一首歌最多 +5。收卷後在後台改判或修正歌單，總分會自動加減差額。

跑馬燈：收卷後在玩家手機上每組顯示一則，例如「組1 玩家B [年份 + 歌名] 正確得 4 分」，
取該組這首個人得分最高的人，同分取最先送出的（看最後一次送出的時間）；整組沒拿分就顯示沒有人答對。

## 登出

登出是純前端行為（清掉 localStorage），沒有 `/api/logout`——token 是無狀態簽章，
要強制撤銷就換 `AUTH_SECRET`。
