// ponytail: 一個檔案的煙霧測試，跑 `node test.mjs`。沒有測試框架。
import assert from "node:assert/strict";
import worker, { Scores } from "./src/index.js";
import { notes } from "./src/notes.js";

// 假的 WebSocket：記下 DO 推過來的訊息；who 是 serializeAttachment 存的身分（null = 只收總分的連線）
const sockets = [];
const fakeSocket = (who) => {
    const ws = { sent: [], send: (m) => ws.sent.push(JSON.parse(m)), deserializeAttachment: () => who };
    sockets.push(ws);
    return ws;
};

const mockCtx = () => {
    const store = new Map();
    return {
        storage: {
            get: async (k) => store.get(k),
            put: async (k, v) => store.set(k, v),
            deleteAll: async () => store.clear(),
        },
        getWebSockets: () => sockets,
    };
};

const env = {
    USERNAME: "admin",
    PASSWORD: "pw",
    AUTH_SECRET: "secret",
};
const scoresDo = new Scores(mockCtx(), env);
env.SCORES = { getByName: () => scoresDo };

const call = (path, init) => worker.fetch(new Request("https://x" + path, init), env);

const post = (path, body) =>
    call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const login = (username, password) => {
    const form = new FormData();
    form.append("username", username);
    form.append("password", password);
    return call("/api/login", { method: "POST", body: form });
};

const scores = async () => (await call("/api/GetScore")).json();

// 未初始化時回傳全 0
assert.deepEqual(await scores(), { 1: 0, 2: 0, 3: 0, 4: 0 });

// 密碼錯誤 -> 401
assert.equal((await login("admin", "wrong")).status, 401);

const { token } = await (await login("admin", "pw")).json();
assert.ok(token, "登入成功應該拿到 token");

// 沒有 token / 假 token 都要被擋
assert.equal((await post("/api/AddScore", { group: 1, year: true })).status, 401);
assert.equal((await post("/api/AddScore", { token: "1893456000.aaaa", group: 1, year: true })).status, 401);

// 加分：四個都勾 = +4（唱、跳分開算）
assert.equal(
    (await post("/api/AddScore", { token, group: 3, year: true, name: true, sing: true, dance: true })).status,
    200,
);
assert.equal((await scores())["3"], 4);

// 只勾一個 = +1，且累加
await post("/api/AddScore", { token, group: 3, name: true });
assert.equal((await scores())["3"], 5);

// 只唱沒跳 = +1
await post("/api/AddScore", { token, group: 3, sing: true });
assert.equal((await scores())["3"], 6);

// 組別越界要擋（原本 Flask 版允許 group=0，會寫出 NaN）
for (const group of [0, 5, "3", 1.5]) {
    assert.equal((await post("/api/AddScore", { token, group, year: true })).status, 400, `group=${group}`);
}

// 直接設定分數
assert.equal((await post("/api/SetScore", { token, group: 3, score: 10 })).status, 200);
assert.equal((await scores())["3"], 10);

// 分數越界要擋
for (const score of [-1, 1000, "10", null]) {
    assert.equal((await post("/api/SetScore", { token, group: 3, score })).status, 400, `score=${score}`);
}

// SetScore 也要驗 token（原本 Flask 版沒驗）
assert.equal((await post("/api/SetScore", { group: 3, score: 99 })).status, 401);

// 後台上下箭頭：delta 可正可負，分數夾在 0–999
await post("/api/SetScore", { token, group: 4, score: 1 });
assert.equal((await post("/api/AddScore", { token, group: 4, delta: -1 })).status, 200);
assert.equal((await scores())["4"], 0);
await post("/api/AddScore", { token, group: 4, delta: -1 }); // 不會扣到負的
assert.equal((await scores())["4"], 0);
await post("/api/AddScore", { token, group: 4, delta: 1 });
assert.equal((await scores())["4"], 1);
await post("/api/SetScore", { token, group: 4, score: 999 });
await post("/api/AddScore", { token, group: 4, delta: 1 }); // 不會超過上限
assert.equal((await scores())["4"], 999);
for (const delta of [1.5, "1", 1000, -1000]) {
    assert.equal((await post("/api/AddScore", { token, group: 4, delta })).status, 400, `delta=${delta}`);
}
assert.equal((await post("/api/AddScore", { group: 4, delta: 1 })).status, 401);
await post("/api/SetScore", { token, group: 4, score: 0 });

// 壞掉的 JSON
assert.equal((await call("/api/AddScore", { method: "POST", body: "{" })).status, 400);

// 改 group 2 不能動到 group 1（舊版 KV read-modify-write 互蓋的 regression）
{
    const other = new Scores(mockCtx(), env);
    await other.set(1, 7);
    await other.set(2, 5);
    assert.deepEqual(await other.read(), { 1: 7, 2: 5, 3: 0, 4: 0 });
}


// ===== 手機作答 =====
let clock = Date.now();
Date.now = () => (clock += 1000); // 每次呼叫前進 1 秒，讓「最先答對」的先後可預測

const admin = (action, body = {}) => post(`/api/admin/${action}`, { token, ...body });
const join = async (name, code) => post("/api/join", { name, code });
const joinToken = async (...args) => (await (await join(...args)).json()).token;
const answer = (t, a) => post("/api/play/answer", { token: t, ...a });
const playState = async (t) => (await post("/api/play/state", { token: t })).json();
const history = async (t) => (await (await post("/api/play/history", { token: t })).json()).history;
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
// 作答 key 是「組別:隨機 id」，改判時用名字從後台資料找出 key
const playerKey = async (name, songId) =>
    (await (await admin("state", { songId })).json()).answers.find((a) => a.name === name).player;
const judge = async (name, field, value, songId = 0) =>
    admin("judge", { songId, player: await playerKey(name, songId), field, value });

// 後台 API 都要驗 token
assert.equal((await post("/api/admin/state", {})).status, 401);

// 還沒設代碼時誰都不能加入
assert.equal((await join("小明", "")).status, 401);

// 代碼不能重複（不分大小寫），重複時整批不存
assert.equal((await admin("passwords", { passwords: { 1: "Red", 2: " red ", 3: "", 4: "" } })).status, 400);
await admin("passwords", { passwords: { 1: "Red", 2: "blue", 3: "", 4: "" } });
assert.equal((await join("小明", "green")).status, 401);
assert.equal((await join("小明", "")).status, 401); // 空代碼 = 該組不開放
assert.equal((await join("", "Red")).status, 400);
const ming = await joinToken("小明", "Red");
const hua = await joinToken("小華", " red "); // 手機自動大寫、多打空白也能進
const mei = await joinToken("小美", "BLUE");
assert.equal((await (await join("小王", "blue")).json()).group, 2); // 回傳組別給前端顯示
const quiet = await joinToken("阿靜", "blue"); // 加入但都不作答

// 玩家 token 不能當後台 token，反之亦然
assert.equal((await post("/api/admin/state", { token: ming })).status, 401);
assert.equal((await post("/api/play/state", { token })).status, 401);
assert.equal((await post("/api/play/history", { token })).status, 401);

// 歌單格式要驗
assert.equal((await admin("songs", { songs: [{ year: "2003", artist: "周杰倫", title: "晴天" }] })).status, 400);
const songs = [
    { year: 2003, artist: ["周杰倫", "Jay Chou"], title: "晴天", youtube: "https://youtu.be/abcDEF12_-x?si=share" },
    { year: 2010, artist: "五月天", title: "倔強" },
    { year: 2007, artist: "蔡依林", title: "日不落", youtube: "https://www.youtube.com/watch?v=0123456789A&t=30s" },
];
// youtube 可省略；有填就要是 http(s) 網址
const badLink = [{ ...songs[1], youtube: "javascript:alert(1)" }];
assert.equal((await admin("songs", { songs: badLink })).status, 400);
assert.equal((await admin("songs", { songs })).status, 200);
{
    const saved = (await (await admin("state")).json()).songs;
    assert.equal(saved[0].youtube, "https://youtu.be/abcDEF12_-x?si=share");
    assert.equal("youtube" in saved[1], false);
}

// 還沒發題不能作答
assert.equal((await answer(ming, { year: 2003 })).status, 400);

// 後台選歌：/host 不帶 songId 就看選到的那首（還沒發題也看得到解答）
assert.equal((await post("/api/admin/select", { songId: 1 })).status, 401);
assert.equal((await admin("select", { songId: 99 })).status, 400);
assert.equal((await admin("select", { songId: 1 })).status, 200);
{
    const host = await (await admin("state")).json();
    assert.equal(host.songId, 1);
    assert.equal(host.songs[1].title[0], songs[1].title);
}

// WebSocket 推播：玩家的連線拿到自己的狀態，計分板、後台的連線只拿總分
const idOf = (t) => JSON.parse(Buffer.from(t.split(".")[0], "base64url")).id;
const watchWs = fakeSocket(null);
const mingWs = fakeSocket({ g: 1, id: idOf(ming) });
const lastState = () => mingWs.sent.at(-1);

assert.equal((await admin("open", { songId: 0 })).status, 200);
assert.equal(lastState().type, "state");
assert.deepEqual(lastState().round, { no: 1, open: true }); // 發題就推給手機
assert.ok(!JSON.stringify(mingWs.sent).includes("周杰倫")); // 推播一樣不能漏解答
assert.deepEqual(watchWs.sent.at(-1), { type: "scores", scores: await scores() });
assert.equal((await admin("open", { songId: 1 })).status, 400); // 要先收卷
assert.equal((await (await admin("state")).json()).songId, 0); // 發題會把選歌帶到這首
assert.equal((await admin("songs", { songs: [] })).status, 400); // 作答中不能改歌單

// 玩家看得到題號，看不到解答；作答中沒有 result
let st = await playState(ming);
assert.deepEqual(st.round, { no: 1, open: true });
assert.equal(st.result, null);
assert.ok(!JSON.stringify(st).includes("周杰倫"));
assert.ok(!JSON.stringify(st).includes("abcDEF12")); // 影片 id 也不能漏

// 狀態裡帶四組總分和自己的組別；還沒收過卷就沒有歷史
assert.deepEqual(st.scores, await scores());
assert.equal(st.group, 1);
assert.deepEqual(await history(ming), []);

const [pushed, watched] = [mingWs.sent.length, watchWs.sent.length];
await answer(ming, { year: 2001, artist: "ＪＡＹ chou", title: "" }); // 年份差 2 → +1
await answer(hua, { year: 2003, artist: "", title: "晴 天" }); // 年份精準 → +3
await answer(mei, { year: 2007, artist: "", title: "" });
await answer(mei, { year: 2006, artist: "周杰倫", title: "晴天" }); // 以最後一次為準；年份差 3 → +1
assert.equal((await playState(mei)).answer.title, "晴天");
// 有人作答只通知後台（只收總分的連線），不重推每支手機
assert.equal(mingWs.sent.length, pushed);
assert.equal(watchWs.sent.length, watched + 4);

let before = await scores();
assert.equal((await admin("close")).status, 200);
assert.equal((await answer(ming, { year: 2003 })).status, 400); // 收卷後不能作答
let after = await scores();
// 每組每項取組內最高分：第 1 組 年份 3 + 歌手 1 + 歌名 1；第 2 組 1 + 1 + 1
assert.equal(after[1] - before[1], 5);
assert.equal(after[2] - before[2], 3);

// 收卷就推給手機：解答、自己的得分、各組這題得分、戰況短評；跟 HTTP 拿到的是同一份
{
    const { status, msg, ...view } = await playState(ming);
    assert.deepEqual(lastState(), view);
    const { result } = view;
    assert.deepEqual([result.no, result.year, result.artist, result.title], [1, 2003, "周杰倫", "晴天"]);
    assert.equal(result.thumb, thumb("abcDEF12_-x"));
    assert.deepEqual(result.mine, { year: 2001, artist: "ＪＡＹ chou", title: "", points: { year: 1, artist: 1, title: 0 } });
    assert.deepEqual(result.groups, { 1: 5, 2: 3, 3: 0, 4: 0 });
    assert.deepEqual(result.notes, ["第 1 組這題拿下滿分！", "第 1 組年份一年不差！"]);
    assert.equal((await playState(quiet)).result.mine, null); // 沒作答
}

// 每組個人得分最高的人（小明 年份+歌手 2 分、小華 年份+歌名 4 分 → 取小華），手機的各組總分會輪流顯示他的名字
st = await playState(ming);
assert.equal(st.round.open, false);
assert.deepEqual(st.result.best, [
    { group: 1, name: "小華", fields: ["year", "title"], points: 4 },
    { group: 2, name: "小美", fields: ["year", "artist", "title"], points: 3 },
    { group: 3, name: null, fields: [], points: 0 }, // 沒人作答
    { group: 4, name: null, fields: [], points: 0 },
]);

// 收卷後玩家看得到：解答（第一種寫法）、縮圖、自己的答案與每項得分、
// 自己這組每項拿幾分和組內最高分的人、各組這題得分
assert.deepEqual(await history(ming), [
    {
        no: 1,
        year: 2003,
        artist: "周杰倫",
        title: "晴天",
        thumb: thumb("abcDEF12_-x"),
        groups: { 1: 5, 2: 3, 3: 0, 4: 0 },
        mine: { year: 2001, artist: "ＪＡＹ chou", title: "", points: { year: 1, artist: 1, title: 0 } },
        team: { points: { year: 3, artist: 1, title: 1 }, best: "小華" },
    },
]);
assert.deepEqual((await history(mei))[0].mine.points, { year: 1, artist: 1, title: 1 });
assert.equal((await history(quiet))[0].mine, null); // 沒作答
assert.deepEqual((await history(quiet))[0].team, { points: { year: 1, artist: 1, title: 1 }, best: "小美" }); // 組員看得到隊友拿的分

// 人工改判：年份可以改成 3 / 1 / 0，還原後總分跟著回來
await judge("小美", "year", 3);
assert.equal((await scores())[2] - before[2], 5);
await judge("小美", "year", null);
assert.equal((await scores())[2] - before[2], 3);
await judge("小明", "artist", 0);
assert.equal((await scores())[1] - before[1], 4);
await judge("小明", "artist", null);
assert.equal((await scores())[1] - before[1], 5);
// 同組兩人都答對同一項只算一次
await judge("小華", "artist", 1);
assert.equal((await scores())[1] - before[1], 5);
await judge("小華", "artist", null);
assert.equal((await judge("小明", "sing", 1)).status, 400);
assert.equal((await judge("小明", "year", 2)).status, 400);
assert.equal((await judge("小明", "artist", 3)).status, 400);

const { answers } = await (await admin("state", { songId: 0 })).json();
assert.equal(answers.length, 3);
assert.ok(answers.every((a) => !a.player.includes(a.name))); // key 不含名字

// 同組同名的兩個人各自有自己的答案，不會互相覆蓋
{
    await admin("open", { songId: 0 });
    // 收過卷又重開的題目，作答中要從歷史拿掉，不能漏解答
    assert.deepEqual(await history(ming), []);
    const twinA = await joinToken("阿明", "Red");
    const twinB = await joinToken("阿明", "Red");
    await answer(twinA, { year: 2003, artist: "", title: "" });
    await answer(twinB, { year: null, artist: "", title: "晴天" });
    assert.equal((await playState(twinA)).answer.year, 2003);
    assert.equal((await playState(twinB)).answer.title, "晴天");
    const both = (await (await admin("state", { songId: 0 })).json()).answers.filter((a) => a.name === "阿明");
    assert.equal(both.length, 2);
    await admin("close");
}

// 第 2 首：小華這組沒拿分的人不會被選中
await admin("open", { songId: 1 });
await answer(ming, { year: 2013, artist: "", title: "倔強" }); // 差 3 → +1
await answer(mei, { year: 2014, artist: "", title: "倔強" }); // 差 4 → 0
await answer(hua, { year: null, artist: "", title: "" });
before = await scores();
await admin("close");
after = await scores();
assert.equal(after[1] - before[1], 2);
assert.equal(after[2] - before[2], 1);
assert.deepEqual((await playState(hua)).result.best.slice(0, 2), [
    { group: 1, name: "小明", fields: ["year", "title"], points: 2 },
    { group: 2, name: "小美", fields: ["title"], points: 1 },
]);

// 第 3 首：同組同分取最先送出的；整組都沒拿分就顯示沒人答對
await admin("open", { songId: 2 });
await answer(hua, { year: 2007, artist: "", title: "日不落" });
await answer(ming, { year: 2007, artist: "", title: "日不落" });
await answer(mei, { year: 1990, artist: "", title: "" });
await admin("close");
assert.deepEqual((await playState(mei)).result.best.slice(0, 2), [
    { group: 1, name: "小華", fields: ["year", "title"], points: 4 },
    { group: 2, name: null, fields: [], points: 0 },
]);

// 歷史新的在上；沒填 youtube 就沒有縮圖
{
    const h = await history(mei);
    assert.deepEqual(h.map((x) => x.no), [3, 2, 1]);
    assert.deepEqual(h.map((x) => x.thumb), [thumb("0123456789A"), null, thumb("abcDEF12_-x")]);
}

// 人工改判後各組最高分的人跟著更新，也會推給手機
const beforeJudge = mingWs.sent.length;
await judge("小美", "title", 1, 2);
assert.deepEqual((await playState(mei)).result.best[1], { group: 2, name: "小美", fields: ["title"], points: 1 });
assert.equal(mingWs.sent.length, beforeJudge + 1);
// 歷史也跟著更新
assert.equal((await history(mei))[0].mine.points.title, 1);
assert.equal((await history(mei))[0].groups[2], 1);

// 收卷後修正歌單會重新批改：第 2 首年份改成 2014，小美變精準 +3
before = await scores();
await admin("songs", { songs: songs.map((s, i) => (i === 1 ? { ...s, year: 2014 } : s)) });
after = await scores();
assert.equal(after[2] - before[2], 3);
assert.equal(after[1] - before[1], 0); // 小明 2013 仍在 ±3 內

// 縮圖只認 YouTube 的網址格式
for (const [link, id] of [
    ["https://www.youtube.com/shorts/ZYXwvu98765", "ZYXwvu98765"],
    ["https://m.youtube.com/watch?feature=share&v=ZYXwvu98765", "ZYXwvu98765"],
    ["https://www.youtube.com/embed/ZYXwvu98765?start=10", "ZYXwvu98765"],
    ["https://music.youtube.com/watch?v=ZYXwvu98765&list=x", "ZYXwvu98765"],
    ["https://example.com/watch?v=ZYXwvu98765", null],
    ["https://youtu.be/short", null],
]) {
    await admin("songs", { songs: songs.map((s, i) => (i === 1 ? { ...s, youtube: link } : s)) });
    assert.equal((await history(mei)).find((h) => h.no === 2).thumb, id && thumb(id), link);
}

// 歷史照收卷順序排，不是照題號：第 1 首重開再收卷，就排到最上面（手機上放大顯示的是剛收卷的那首）
await admin("open", { songId: 0 });
await admin("close");
assert.deepEqual((await history(mei)).map((x) => x.no), [1, 3, 2]);
// 改歌單、改判只重算分數，不改順序
await admin("songs", { songs });
await judge("小美", "year", 3, 1);
assert.deepEqual((await history(mei)).map((x) => x.no), [1, 3, 2]);

// A played song can only be corrected in place: same video, or same title when either side has no video
{
    const corrected = [{ ...songs[0], title: ["晴天 Sunny Day"] }, songs[1], { ...songs[2], year: 2008 }];
    const stranger = { year: 1999, artist: "新歌手", title: "沒播過的歌" };
    before = await scores();
    const replaced = await admin("songs", { songs: [corrected[0], stranger, corrected[2]] });
    assert.equal(replaced.status, 400);
    assert.equal((await replaced.json()).msg, "第 2 首已經收卷，只能修正解答，不能刪掉或換成別首歌");
    assert.equal((await admin("songs", { songs: corrected.slice(0, 2) })).status, 400);
    assert.equal((await admin("songs", { songs: [] })).status, 400);
    const otherVideo = { ...songs[2], youtube: "https://youtu.be/ZYXwvu98765" };
    assert.equal((await admin("songs", { songs: [corrected[0], corrected[1], otherVideo] })).status, 400);
    assert.deepEqual(await scores(), before);
    assert.ok(!JSON.stringify(await history(mei)).includes("沒播過的歌"));

    // New songs go at the end
    assert.equal((await admin("songs", { songs: [...corrected, stranger] })).status, 200);
    assert.deepEqual(
        (await history(mei)).map((x) => [x.no, x.year, x.title]),
        [
            [1, 2003, "晴天 Sunny Day"],
            [3, 2008, "日不落"],
            [2, 2010, "倔強"],
        ],
    );
}

// ===== 戰況短評 =====
{
    const g4 = (a, b, c, d) => ({ 1: a, 2: b, 3: c, 4: d });
    // 第一題就有人領先：搶得頭香；拿滿分另外講
    assert.deepEqual(notes([g4(5, 3, 0, 1)], g4(5, 3, 0, 1)), ["第 1 組搶得頭香，暫居第一！", "第 1 組這題拿下滿分！"]);
    // 超車，被超的那組只差 1 分
    assert.deepEqual(notes([g4(3, 0, 0, 0), g4(0, 4, 0, 0)], g4(3, 4, 0, 0)), [
        "第 2 組超車成功，登上第一！",
        "第 1 組仍緊追不放，只差 1 分！",
    ]);
    // 四組都沒分
    assert.equal(notes([g4(1, 0, 0, 0), g4(0, 0, 0, 0)], g4(1, 0, 0, 0))[0], "怎麼沒人答對，出題在搞！");
    // 連續滿分比連續得分優先
    const hot = [g4(1, 1, 0, 0), g4(2, 0, 0, 0), g4(1, 0, 0, 0), g4(5, 0, 1, 0), g4(5, 0, 0, 1)];
    assert.deepEqual(notes(hot, g4(14, 1, 1, 1)), ["第 1 組連續 2 題滿分，書卷了吧...", "第 1 組連續 5 題得分，好電！"]);
    // 同分並列第一；連兩題沒分的組終於拿分
    assert.deepEqual(notes([g4(2, 0, 0, 0), g4(0, 0, 0, 0), g4(0, 2, 0, 0)], g4(2, 2, 0, 0)), [
        "第 1、2 組並列第一！",
        "第 2 組終於開張！",
    ]);
    // 中段爬升
    assert.deepEqual(notes([g4(5, 3, 2, 0), g4(0, 0, 0, 4)], g4(5, 3, 2, 4)), [
        "第 4 組大躍進，從第 4 名衝到第 2 名！",
        "第 4 組仍緊追不放，只差 1 分！",
    ]);
    // 開賽時四組同分都算第 1 名，第一題拿分不算爬升
    assert.ok(!notes([g4(5, 0, 0, 2)], g4(5, 0, 0, 2)).some((n) => n.includes("大躍進")));
    assert.deepEqual(notes([], g4(0, 0, 0, 0)), []);
}

// ===== 重置整個資料庫 =====
assert.equal((await post("/api/admin/reset", {})).status, 401); // 要後台 token
assert.equal((await admin("reset")).status, 200);
assert.deepEqual(await scores(), { 1: 0, 2: 0, 3: 0, 4: 0 });
{
    const st = await (await admin("state")).json();
    assert.deepEqual([st.songs, st.round, st.groupPw, st.answers], [[], null, {}, []]);
    assert.equal(st.songId, null); // 選歌也清掉
}
assert.equal((await join("小明", "Red")).status, 401); // 組別代碼也清掉了
assert.equal((await playState(ming)).round, null); // 舊玩家看到的是尚未發題
assert.deepEqual((await playState(ming)).scores, { 1: 0, 2: 0, 3: 0, 4: 0 });
assert.deepEqual(await history(ming), []);

assert.equal(lastState().round, null); // 重置也推給手機

console.log("ok");
