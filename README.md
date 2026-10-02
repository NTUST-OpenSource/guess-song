# 三『資』小豬 — 誰是猜歌王

猜歌遊戲的計分與手機作答系統，跑在 Cloudflare Workers。前端靜態檔（`public/`）由 Workers Static Assets 直接送，
`/api/*` 交給 Worker（`src/index.js`）。分數、歌單、作答紀錄都存在單一個 Durable Object（`Scores`）。
畫面不輪詢：每個頁面跟 DO 保持一條 WebSocket（`/api/ws`），狀態一改就推過去。
網域和 Cloudflare 帳號設定在 `wrangler.jsonc`。

## 需要的設定

### 環境變數（三個都是 secret，不要寫進 wrangler.jsonc）

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

以前用來存分數的 KV namespace（`song-kv`）已經沒有程式在用，確認不需要後可以在 Cloudflare 後台刪掉。

## 開發 / 部署

```shell
node test.mjs            # 煙霧測試
npx wrangler dev         # 本機 http://localhost:8787
npx wrangler deploy
```

## 頁面

| 路徑 | 說明 |
|---|---|
| `/` | 玩家用手機作答（名字＋組別代碼，代碼決定組別）。最上方固定顯示四組總分。發題、收卷各有一段動畫：發題是轉場和 3、2、1 倒數，收卷是 TIME'S UP、全螢幕對錯、解答與自己的得分，再捲到各組總分看名次換位和戰況短評。右下角的作答紀錄可以切換「個人」和「小組」 |
| `/scoreboard` | 投影用的全螢幕計分板，分數一變就更新，加分時數字會往上數；右上角的按鈕切換「固定四格」和「排名長條」 |
| `/login` | 後台登入；從 `/host` 被導過來的，登入後會回到 `/host` |
| `/dashboard` | 上方四組分數用 −／＋ 加減（按了就存），或直接輸入按 Enter 存；左邊選歌（「下一首」直接換到下一首）/ 發題 / 收卷，右邊作答狀況與改判；「控制台」分頁上的齒輪打開設定：組別代碼、歌單、重置所有資料 |
| `/host` | 主持人用：上方四組分數，下方大字顯示後台選到那首歌的解答（預設隱藏，按「顯示答案」才看得到），各組卡片角落是作答人數，收卷後顯示各組得分和最高分的人；可以發題 / 收卷（帳密同後台）。和 `/dashboard` 是同一頁，用上方分頁切換不會重新載入 |

## 比賽流程

1. 賽前在後台的設定（「控制台」分頁上的齒輪）設好四組的組別代碼、上傳歌單。
2. 在後台的題目選單選歌（或按「下一首」），`/host` 會立刻顯示這首的年份、歌手、歌名給主持人看（還沒發題也看得到）。
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
| `/api/ws` | GET（WebSocket） | query: `token`（選填） | 帶玩家 token 就推自己的狀態（格式同 `/api/play/state`），不帶就只推 `{"type":"scores"}`；token 失效時照樣連上，但第一則訊息帶 `rejoin: true`。客戶端每 25 秒送 `ping`，伺服器回 `pong` |
| `/api/play/state` | POST | json: `token` | 跟 WebSocket 推的是同一份：題號、是否作答中、自己的答案（不含解答）、四組總分、自己的組別；收卷後多一個 `result`（解答、縮圖、自己的得分、各組這題得分、各組最高分的人、戰況短評） |
| `/api/play/history` | POST | json: `token` | 收過卷的題目，最近收卷的在上：解答、縮圖、自己的答案與每項得分、自己這組每項拿幾分和組內最高分的人、各組這題得分。作答中的那題不會出現 |
| `/api/play/answer` | POST | json: `token`, `year`, `artist`, `title` | 作答中可重複送出，以最後一次為準 |
| `/api/admin/{state,songs,select,open,close,judge,passwords,reset}` | POST | json: `token`, ... | 後台作答管理，參數見 `src/index.js` 的 `handleAdmin` |

`group` 是 1–4 的整數，`score` 是 0–999 的整數。認證失敗回 401，參數錯回 400。

`admin/select` 記錄後台目前選到的歌（`songId`），`admin/state` 沒帶 `songId` 時就回這首，`/host` 靠這個顯示解答；發題也會把選到的歌設成那一首。

## 歌單

歌單含解答，**不能進 git**：照 `songs.example.json` 的格式寫成 `songs.json`（`songs*.json` 已 gitignore），
在後台設定的「歌單與解答」選檔上傳。解答只存在伺服器的 Durable Object，玩家端 API 只有在那一題收卷後才拿得到那一題的解答。
每首可以加 `youtube` 網址（選填，只收 http/https），後台發題時會出現播放連結；沒填就連到 YouTube 用「歌名 歌手」搜尋。
收卷後玩家手機會顯示這首的 YouTube 縮圖（沒填或不是 YouTube 網址就不顯示）；作答中不會送出任何影片資訊。
歌是用順序編號的：收過卷的歌只能原地修正解答（同一支影片，或沒有影片時歌名不變），不能刪掉或換成別首，後台會擋下來；要加歌請加在最後面。

計分：收卷時自動批改。年份精準 +3、差 3 年以內 +1；歌手、歌名答對各 +1（忽略大小寫、全半形、空白和標點）。
每組每項取組內最高分，所以一組一首歌最多 +5。收卷後在後台改判或修正歌單，總分會自動加減差額。

各組總分：收卷後手機上的各組總分，會先顯示該組這題個人得分最高的人（同分取最先送出的，看最後一次送出的時間），
再跟「第 N 組」輪流淡入淡出；整組沒拿分就只顯示組名。

戰況短評：收卷後在各組總分下面顯示最多兩句，例如「第 2 組超車成功，登上第一！」「第 1 組仍緊追不放，只差 2 分！」。
判斷條件和用詞都在 `src/notes.js`，要改文案改那裡。

## 登出

登出是純前端行為（清掉 localStorage），沒有 `/api/logout`——token 是無狀態簽章，
要強制撤銷就換 `AUTH_SECRET`。
