// Smoke test of the Worker and the Durable Object, top to bottom: run `npm test`.
import assert from "node:assert/strict";
import worker, { Scores } from "../src/index.js";
import { notes } from "../src/notes.js";

// Fake WebSocket that records pushed messages; who is the serialized attachment (null for totals-only sockets).
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

// Scores start at zero.
assert.deepEqual(await scores(), { 1: 0, 2: 0, 3: 0, 4: 0 });

// Wrong password.
assert.equal((await login("admin", "wrong")).status, 401);

const { token } = await (await login("admin", "pw")).json();
assert.ok(token, "登入成功應該拿到 token");

// Missing or forged admin token.
assert.equal((await post("/api/AddScore", { group: 1, year: true })).status, 401);
assert.equal((await post("/api/AddScore", { token: "1893456000.aaaa", group: 1, year: true })).status, 401);

// Without delta, each true field adds 1.
assert.equal(
    (await post("/api/AddScore", { token, group: 3, year: true, name: true, sing: true, dance: true })).status,
    200,
);
assert.equal((await scores())["3"], 4);

// Points accumulate.
await post("/api/AddScore", { token, group: 3, name: true });
assert.equal((await scores())["3"], 5);

await post("/api/AddScore", { token, group: 3, sing: true });
assert.equal((await scores())["3"], 6);

// Out-of-range groups are rejected.
for (const group of [0, 5, "3", 1.5]) {
    assert.equal((await post("/api/AddScore", { token, group, year: true })).status, 400, `group=${group}`);
}

// SetScore writes the value directly.
assert.equal((await post("/api/SetScore", { token, group: 3, score: 10 })).status, 200);
assert.equal((await scores())["3"], 10);

// Out-of-range scores are rejected.
for (const score of [-1, 1000, "10", null]) {
    assert.equal((await post("/api/SetScore", { token, group: 3, score })).status, 400, `score=${score}`);
}

// SetScore requires a token.
assert.equal((await post("/api/SetScore", { group: 3, score: 99 })).status, 401);

// delta may be negative; totals are clamped to 0–999.
await post("/api/SetScore", { token, group: 4, score: 1 });
assert.equal((await post("/api/AddScore", { token, group: 4, delta: -1 })).status, 200);
assert.equal((await scores())["4"], 0);
await post("/api/AddScore", { token, group: 4, delta: -1 });
assert.equal((await scores())["4"], 0);
await post("/api/AddScore", { token, group: 4, delta: 1 });
assert.equal((await scores())["4"], 1);
await post("/api/SetScore", { token, group: 4, score: 999 });
await post("/api/AddScore", { token, group: 4, delta: 1 });
assert.equal((await scores())["4"], 999);
for (const delta of [1.5, "1", 1000, -1000]) {
    assert.equal((await post("/api/AddScore", { token, group: 4, delta })).status, 400, `delta=${delta}`);
}
assert.equal((await post("/api/AddScore", { group: 4, delta: 1 })).status, 401);
await post("/api/SetScore", { token, group: 4, score: 0 });

// Malformed JSON.
assert.equal((await call("/api/AddScore", { method: "POST", body: "{" })).status, 400);

// Writing one group leaves the others untouched.
{
    const other = new Scores(mockCtx(), env);
    await other.set(1, 7);
    await other.set(2, 5);
    assert.deepEqual(await other.read(), { 1: 7, 2: 5, 3: 0, 4: 0 });
}


// ===== Rounds =====
let clock = Date.now();
// Every call advances one second so the order of answers is deterministic.
Date.now = () => (clock += 1000);

const admin = (action, body = {}) => post(`/api/admin/${action}`, { token, ...body });
const join = async (name, code) => post("/api/join", { name, code });
const joinToken = async (...args) => (await (await join(...args)).json()).token;
const answer = (t, a) => post("/api/play/answer", { token: t, ...a });
const playState = async (t) => (await post("/api/play/state", { token: t })).json();
const history = async (t) => (await (await post("/api/play/history", { token: t })).json()).history;
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
// Answers are keyed by "group:random id", so judging looks the key up by name.
const playerKey = async (name, songId) =>
    (await (await admin("state", { songId })).json()).answers.find((a) => a.name === name).player;
const judge = async (name, field, value, songId = 0) =>
    admin("judge", { songId, player: await playerKey(name, songId), field, value });

// Admin endpoints require a token.
assert.equal((await post("/api/admin/state", {})).status, 401);

// Nobody can join before codes are set.
assert.equal((await join("小明", "")).status, 401);

// Codes must be unique ignoring case; a duplicate rejects the whole batch.
assert.equal((await admin("passwords", { passwords: { 1: "Red", 2: " red ", 3: "", 4: "" } })).status, 400);
await admin("passwords", { passwords: { 1: "Red", 2: "blue", 3: "", 4: "" } });
assert.equal((await join("小明", "green")).status, 401);
// An empty code keeps that group closed.
assert.equal((await join("小明", "")).status, 401);
assert.equal((await join("", "Red")).status, 400);
const ming = await joinToken("小明", "Red");
// Codes ignore case and surrounding spaces.
const hua = await joinToken("小華", " red ");
const mei = await joinToken("小美", "BLUE");
assert.equal((await (await join("小王", "blue")).json()).group, 2);
// Joins but never answers.
const quiet = await joinToken("阿靜", "blue");

// Player and admin tokens are not interchangeable.
assert.equal((await post("/api/admin/state", { token: ming })).status, 401);
assert.equal((await post("/api/play/state", { token })).status, 401);
assert.equal((await post("/api/play/history", { token })).status, 401);

// Song lists are validated.
assert.equal((await admin("songs", { songs: [{ year: "2003", artist: "周杰倫", title: "晴天" }] })).status, 400);
const songs = [
    { year: 2003, artist: ["周杰倫", "Jay Chou"], title: "晴天", youtube: "https://youtu.be/abcDEF12_-x?si=share" },
    { year: 2010, artist: "五月天", title: "倔強" },
    { year: 2007, artist: "蔡依林", title: "日不落", youtube: "https://www.youtube.com/watch?v=0123456789A&t=30s" },
];
// youtube is optional but must be an http(s) URL.
const badLink = [{ ...songs[1], youtube: "javascript:alert(1)" }];
assert.equal((await admin("songs", { songs: badLink })).status, 400);
assert.equal((await admin("songs", { songs })).status, 200);
{
    const saved = (await (await admin("state")).json()).songs;
    assert.equal(saved[0].youtube, "https://youtu.be/abcDEF12_-x?si=share");
    assert.equal("youtube" in saved[1], false);
}

// No answers before a round opens.
assert.equal((await answer(ming, { year: 2003 })).status, 400);

// /host follows the selected song, even before it is opened.
assert.equal((await post("/api/admin/select", { songId: 1 })).status, 401);
assert.equal((await admin("select", { songId: 99 })).status, 400);
assert.equal((await admin("select", { songId: 1 })).status, 200);
{
    const host = await (await admin("state")).json();
    assert.equal(host.songId, 1);
    assert.equal(host.songs[1].title[0], songs[1].title);
}

// Player sockets get their own state; other sockets get totals only.
const idOf = (t) => JSON.parse(Buffer.from(t.split(".")[0], "base64url")).id;
const watchWs = fakeSocket(null);
const mingWs = fakeSocket({ g: 1, id: idOf(ming) });
const lastState = () => mingWs.sent.at(-1);

assert.equal((await admin("open", { songId: 0 })).status, 200);
assert.equal(lastState().type, "state");
assert.deepEqual(lastState().round, { no: 1, open: true });
// Pushes must not leak the answer key either.
assert.ok(!JSON.stringify(mingWs.sent).includes("周杰倫"));
assert.deepEqual(watchWs.sent.at(-1), { type: "scores", scores: await scores() });
// Close the current round before opening another.
assert.equal((await admin("open", { songId: 1 })).status, 400);
// Opening a round selects its song.
assert.equal((await (await admin("state")).json()).songId, 0);
// The song list is locked while a round is open.
assert.equal((await admin("songs", { songs: [] })).status, 400);

// Players see the round number but no answer key while it is open.
let st = await playState(ming);
assert.deepEqual(st.round, { no: 1, open: true });
assert.equal(st.result, null);
assert.ok(!JSON.stringify(st).includes("周杰倫"));
// Not even the video id.
assert.ok(!JSON.stringify(st).includes("abcDEF12"));

// State carries the totals and the player's group; history stays empty until a round closes.
assert.deepEqual(st.scores, await scores());
assert.equal(st.group, 1);
assert.deepEqual(await history(ming), []);

const [pushed, watched] = [mingWs.sent.length, watchWs.sent.length];
// Year off by 2: +1.
await answer(ming, { year: 2001, artist: "ＪＡＹ chou", title: "" });
// Exact year: +3.
await answer(hua, { year: 2003, artist: "", title: "晴 天" });
await answer(mei, { year: 2007, artist: "", title: "" });
// The last answer counts; year off by 3: +1.
await answer(mei, { year: 2006, artist: "周杰倫", title: "晴天" });
assert.equal((await playState(mei)).answer.title, "晴天");
// Answers only notify totals-only sockets, not every phone.
assert.equal(mingWs.sent.length, pushed);
assert.equal(watchWs.sent.length, watched + 4);

let before = await scores();
assert.equal((await admin("close")).status, 200);
// No answers after close.
assert.equal((await answer(ming, { year: 2003 })).status, 400);
let after = await scores();
// Best per field within each group: group 1 gets 3 + 1 + 1, group 2 gets 1 + 1 + 1.
assert.equal(after[1] - before[1], 5);
assert.equal(after[2] - before[2], 3);

// Closing pushes the result to phones; the HTTP state returns the same payload.
{
    const { status, msg, ...view } = await playState(ming);
    assert.deepEqual(lastState(), view);
    const { result } = view;
    assert.deepEqual([result.no, result.year, result.artist, result.title], [1, 2003, "周杰倫", "晴天"]);
    assert.equal(result.thumb, thumb("abcDEF12_-x"));
    assert.deepEqual(result.mine, { year: 2001, artist: "ＪＡＹ chou", title: "", points: { year: 1, artist: 1, title: 0 } });
    assert.deepEqual(result.groups, { 1: 5, 2: 3, 3: 0, 4: 0 });
    assert.deepEqual(result.notes, ["第 1 組這題拿下滿分！", "第 1 組年份一年不差！"]);
    assert.equal((await playState(quiet)).result.mine, null);
}

// Top scorer per group: the member with 4 points beats the one with 2.
st = await playState(ming);
assert.equal(st.round.open, false);
assert.deepEqual(st.result.best, [
    { group: 1, name: "小華", fields: ["year", "title"], points: 4 },
    { group: 2, name: "小美", fields: ["year", "artist", "title"], points: 3 },
    { group: 3, name: null, fields: [], points: 0 },
    { group: 4, name: null, fields: [], points: 0 },
]);

// History after close: answer key, thumbnail, own answer with points per field,
// the group's points per field with its top scorer, and every group's points.
assert.deepEqual(await history(ming), [
    {
        no: 1,
        year: 2003,
        artist: "周杰倫",
        title: "晴天",
        thumb: thumb("abcDEF12_-x"),
        groups: { 1: 5, 2: 3, 3: 0, 4: 0 },
        mine: { year: 2001, artist: "ＪＡＹ chou", title: "", points: { year: 1, artist: 1, title: 0 } },
        team: { year: 2003, artist: "ＪＡＹ chou", title: "晴 天", points: { year: 3, artist: 1, title: 1 }, best: "小華" },
    },
]);
assert.deepEqual((await history(mei))[0].mine.points, { year: 1, artist: 1, title: 1 });
assert.equal((await history(quiet))[0].mine, null);
// Teammates see what the group earned and the answers that earned it.
assert.deepEqual((await history(quiet))[0].team, {
    year: 2006,
    artist: "周杰倫",
    title: "晴天",
    points: { year: 1, artist: 1, title: 1 },
    best: "小美",
});

// Manual judging: year can be set to 3, 1 or 0, and clearing it restores the total.
await judge("小美", "year", 3);
assert.equal((await scores())[2] - before[2], 5);
await judge("小美", "year", null);
assert.equal((await scores())[2] - before[2], 3);
await judge("小明", "artist", 0);
assert.equal((await scores())[1] - before[1], 4);
await judge("小明", "artist", null);
assert.equal((await scores())[1] - before[1], 5);
// A field answered correctly by two members counts once.
await judge("小華", "artist", 1);
assert.equal((await scores())[1] - before[1], 5);
await judge("小華", "artist", null);
assert.equal((await judge("小明", "sing", 1)).status, 400);
assert.equal((await judge("小明", "year", 2)).status, 400);
assert.equal((await judge("小明", "artist", 3)).status, 400);

const { answers } = await (await admin("state", { songId: 0 })).json();
assert.equal(answers.length, 3);
// Answer keys do not contain names.
assert.ok(answers.every((a) => !a.player.includes(a.name)));

// Two players with the same name in one group keep separate answers.
{
    await admin("open", { songId: 0 });
    // A reopened round leaves the history while it is open.
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

// Song 2: a member who scored nothing is never the top scorer.
await admin("open", { songId: 1 });
// Off by 3: +1.
await answer(ming, { year: 2013, artist: "", title: "倔強" });
// Off by 4: 0.
await answer(mei, { year: 2014, artist: "", title: "倔強" });
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

// Song 3: ties go to the earliest submission; a group without points has no top scorer.
await admin("open", { songId: 2 });
await answer(hua, { year: 2007, artist: "", title: "日不落" });
await answer(ming, { year: 2007, artist: "", title: "日不落" });
await answer(mei, { year: 1990, artist: "", title: "" });
await admin("close");
assert.deepEqual((await playState(mei)).result.best.slice(0, 2), [
    { group: 1, name: "小華", fields: ["year", "title"], points: 4 },
    { group: 2, name: null, fields: [], points: 0 },
]);

// History lists the latest first; songs without youtube have no thumbnail.
{
    const h = await history(mei);
    assert.deepEqual(h.map((x) => x.no), [3, 2, 1]);
    assert.deepEqual(h.map((x) => x.thumb), [thumb("0123456789A"), null, thumb("abcDEF12_-x")]);
    // Fields nobody in the group scored carry no answer.
    assert.deepEqual(h[0].team, { year: null, artist: null, title: null, points: { year: 0, artist: 0, title: 0 }, best: null });
    assert.deepEqual((await history(ming))[1].team, {
        year: 2013,
        artist: null,
        title: "倔強",
        points: { year: 1, artist: 0, title: 1 },
        best: "小明",
    });
}

// Judging updates the top scorers and pushes to phones.
const beforeJudge = mingWs.sent.length;
await judge("小美", "title", 1, 2);
assert.deepEqual((await playState(mei)).result.best[1], { group: 2, name: "小美", fields: ["title"], points: 1 });
assert.equal(mingWs.sent.length, beforeJudge + 1);
// History follows judging too.
assert.equal((await history(mei))[0].mine.points.title, 1);
assert.equal((await history(mei))[0].groups[2], 1);

// Correcting the list regrades closed rounds: with song 2 moved to 2014, an answer of 2014 becomes exact (+3).
before = await scores();
await admin("songs", { songs: songs.map((s, i) => (i === 1 ? { ...s, year: 2014 } : s)) });
after = await scores();
assert.equal(after[2] - before[2], 3);
// An answer of 2013 is still within 3 years.
assert.equal(after[1] - before[1], 0);

// Thumbnails only come from YouTube URLs.
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

// History follows close order, not song order: song 1 closed again moves to the top.
await admin("open", { songId: 0 });
await admin("close");
assert.deepEqual((await history(mei)).map((x) => x.no), [1, 3, 2]);
// Editing the list or judging keeps that order.
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

// ===== Commentary =====
{
    const g4 = (a, b, c, d) => ({ 1: a, 2: b, 3: c, 4: d });
    // A lead after the first round, plus full marks.
    assert.deepEqual(notes([g4(5, 3, 0, 1)], g4(5, 3, 0, 1)), ["第 1 組搶得頭香，暫居第一！", "第 1 組這題拿下滿分！"]);
    // Overtaking, with the passed group 1 point behind.
    assert.deepEqual(notes([g4(3, 0, 0, 0), g4(0, 4, 0, 0)], g4(3, 4, 0, 0)), [
        "第 2 組超車成功，登上第一！",
        "第 1 組仍緊追不放，只差 1 分！",
    ]);
    // Nobody scored.
    assert.equal(notes([g4(1, 0, 0, 0), g4(0, 0, 0, 0)], g4(1, 0, 0, 0))[0], "怎麼沒人答對，出題在搞！");
    // A full-marks streak outranks a scoring streak.
    const hot = [g4(1, 1, 0, 0), g4(2, 0, 0, 0), g4(1, 0, 0, 0), g4(5, 0, 1, 0), g4(5, 0, 0, 1)];
    assert.deepEqual(notes(hot, g4(14, 1, 1, 1)), ["第 1 組連續 2 題滿分，書卷了吧...", "第 1 組連續 5 題得分，好電！"]);
    // Tied for 1st, and a group scoring after two empty rounds.
    assert.deepEqual(notes([g4(2, 0, 0, 0), g4(0, 0, 0, 0), g4(0, 2, 0, 0)], g4(2, 2, 0, 0)), [
        "第 1、2 組並列第一！",
        "第 2 組終於開張！",
    ]);
    // Climbing below 1st.
    assert.deepEqual(notes([g4(5, 3, 2, 0), g4(0, 0, 0, 4)], g4(5, 3, 2, 4)), [
        "第 4 組大躍進，從第 4 名衝到第 2 名！",
        "第 4 組仍緊追不放，只差 1 分！",
    ]);
    // Everyone starts tied for 1st, so scoring in round 1 is not a climb.
    assert.ok(!notes([g4(5, 0, 0, 2)], g4(5, 0, 0, 2)).some((n) => n.includes("大躍進")));
    assert.deepEqual(notes([], g4(0, 0, 0, 0)), []);
    // The all-groups lines name four or five groups.
    assert.deepEqual(notes([g4(0, 0, 0, 0), g4(1, 1, 1, 1)], g4(1, 1, 1, 1)), ["四組都有拿分，這題大家都會！"]);
    const g5 = (a, b, c, d, e) => ({ ...g4(a, b, c, d), 5: e });
    assert.deepEqual(notes([g5(0, 0, 0, 0, 0), g5(1, 1, 1, 1, 1)], g5(1, 1, 1, 1, 1)), ["五組都有拿分，這題大家都會！"]);
}

// ===== Reset =====
assert.equal((await post("/api/admin/reset", {})).status, 401);
assert.equal((await admin("reset")).status, 200);
assert.deepEqual(await scores(), { 1: 0, 2: 0, 3: 0, 4: 0 });
{
    const st = await (await admin("state")).json();
    assert.deepEqual([st.songs, st.round, st.groupPw, st.answers], [[], null, {}, []]);
    assert.equal(st.songId, null);
}
// Group codes are cleared too.
assert.equal((await join("小明", "Red")).status, 401);
// Existing players see no round.
assert.equal((await playState(ming)).round, null);
assert.deepEqual((await playState(ming)).scores, { 1: 0, 2: 0, 3: 0, 4: 0 });
assert.deepEqual(await history(ming), []);

// Reset is pushed to phones.
assert.equal(lastState().round, null);

// ===== Five groups =====
{
    // Only 1, true and True turn on the fifth group.
    const pageGroups = async (value) =>
        (await (await worker.fetch(new Request("https://x/api/groups.js"), { ...env, FIVE_GROUPS: value })).text()).match(/"(\d)"/)[1];
    for (const v of ["1", "true", "True", true]) assert.equal(await pageGroups(v), "5", `FIVE_GROUPS=${v}`);
    for (const v of [undefined, "", "0", "false", "TRUE", "yes"]) assert.equal(await pageGroups(v), "4", `FIVE_GROUPS=${v}`);

    const ctx5 = { ...mockCtx(), getWebSockets: () => [] };
    const env5 = { ...env, FIVE_GROUPS: "true", SCORES: { getByName: () => do5 } };
    const do5 = new Scores(ctx5, env5);
    const post5 = (path, body) =>
        worker.fetch(new Request("https://x" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env5);
    const admin5 = (action, body = {}) => post5(`/api/admin/${action}`, { token, ...body });

    assert.deepEqual(await (await worker.fetch(new Request("https://x/api/GetScore"), env5)).json(), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    assert.equal((await post5("/api/SetScore", { token, group: 5, score: 7 })).status, 200);
    assert.equal((await post5("/api/SetScore", { token, group: 6, score: 7 })).status, 400);
    assert.equal((await post("/api/SetScore", { token, group: 5, score: 7 })).status, 400);

    // A player of group 5 plays a round.
    await admin5("passwords", { passwords: { 1: "red", 2: "blue", 3: "gold", 4: "leaf", 5: "aqua" } });
    const qing = await (await post5("/api/join", { name: "小青", code: "AQUA" })).json();
    assert.equal(qing.group, 5);
    await admin5("songs", { songs: [{ year: 2003, artist: "周杰倫", title: "晴天" }] });
    await admin5("open", { songId: 0 });
    await post5("/api/play/answer", { token: qing.token, year: 2003, artist: "周杰倫", title: "晴天" });
    await admin5("close");
    const st = await (await post5("/api/play/state", { token: qing.token })).json();
    assert.deepEqual(st.scores, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 12 });
    assert.deepEqual(st.result.groups, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 5 });
    assert.deepEqual(st.result.best.map((b) => b.name), [null, null, null, null, "小青"]);

    // Turned off: group 5 leaves the totals, its code stops working and its players must join again.
    assert.deepEqual(await new Scores(ctx5, env).read(), { 1: 0, 2: 0, 3: 0, 4: 0 });
    assert.equal(await new Scores(ctx5, env).groupForCode("aqua"), null);
    assert.equal((await post("/api/play/state", { token: qing.token })).status, 401);
    // Turned on: totals saved with four groups get a 0 for group 5.
    const ctx4 = mockCtx();
    await ctx4.storage.put("scores", { 1: 3, 2: 0, 3: 1, 4: 2 });
    assert.deepEqual(await new Scores(ctx4, env5).read(), { 1: 3, 2: 0, 3: 1, 4: 2, 5: 0 });

    // The icons follow the group count.
    const ASSETS = { fetch: async (req) => new Response(new URL(req.url).pathname) };
    const icon = async (e, path) => (await worker.fetch(new Request("https://x" + path), { ...e, ASSETS })).text();
    assert.equal(await icon(env, "/favicon.svg"), "/favicon.svg");
    assert.equal(await icon(env5, "/favicon.ico"), "/five/favicon.ico");
    assert.equal(await icon(env5, "/apple-touch-icon.png"), "/five/apple-touch-icon.png");
}
