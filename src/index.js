import { notes } from "./notes.js";

const GROUPS = 4;
// Token lifetime in seconds.
const TOKEN_TTL = 12 * 60 * 60;
const MAX_SCORE = 999;

const enc = new TextEncoder();

// Node (test.mjs) cannot import cloudflare:workers, so fall back to a base class with the same shape.
let DurableObject = class {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
    }
};
try {
    ({ DurableObject } = await import("cloudflare:workers"));
} catch {}

const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });

const ok = (extra) => json({ status: 1, msg: "success", ...extra });
const fail = (msg, status = 400) => json({ status: 0, msg }, status);

const emptyScores = () =>
    Object.fromEntries(Array.from({ length: GROUPS }, (_, i) => [String(i + 1), 0]));

const b64u = (buf) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

const unb64u = (s) =>
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret) =>
    crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
    ]);

// Tokens are stateless HMAC signatures, so logging out cannot revoke one.
// Rotating AUTH_SECRET invalidates every token at once.
async function issueToken(secret) {
    const exp = String(Math.floor(Date.now() / 1000) + TOKEN_TTL);
    const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(exp));
    return `${exp}.${b64u(sig)}`;
}

async function verifyToken(secret, token) {
    if (typeof token !== "string") return false;
    const [exp, sig] = token.split(".");
    if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
    try {
        return await crypto.subtle.verify(
            "HMAC",
            await hmacKey(secret),
            unb64u(sig),
            enc.encode(exp),
        );
    } catch {
        return false;
    }
}

// Player tokens sign "p." + payload and admin tokens sign only exp, so neither can pass as the other.
async function issuePlayerToken(secret, group, name) {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
    // A random id per join keeps answers apart even for players with the same name in one group.
    const payload = b64u(enc.encode(JSON.stringify({ g: group, n: name, id: crypto.randomUUID(), exp })));
    const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`p.${payload}`));
    return `${payload}.${b64u(sig)}`;
}

async function verifyPlayerToken(secret, token) {
    if (typeof token !== "string") return null;
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    try {
        const valid = await crypto.subtle.verify(
            "HMAC",
            await hmacKey(secret),
            unb64u(sig),
            enc.encode(`p.${payload}`),
        );
        if (!valid) return null;
        const player = JSON.parse(new TextDecoder().decode(unb64u(payload)));
        return player.exp >= Date.now() / 1000 ? player : null;
    } catch {
        return null;
    }
}

const isGroup = (v) => Number.isInteger(v) && v >= 1 && v <= GROUPS;

// Group codes ignore case and surrounding spaces; phones often capitalize the first letter.
const codeKey = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

// Points per field: exact year 3, within 3 years 1; artist and title 1 each.
const FIELD_POINTS = { year: [3, 1, 0], artist: [1, 0], title: [1, 0] };
const FIELDS = Object.keys(FIELD_POINTS);

// Ignore case, full-width forms, whitespace and punctuation.
const norm = (s) =>
    String(s)
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]/gu, "");

const textOk = (ans, accepted) => norm(ans) !== "" && accepted.some((a) => norm(a) === norm(ans));

const yearPoints = (ans, year) => (ans === null ? 0 : ans === year ? 3 : Math.abs(ans - year) <= 3 ? 1 : 0);

// auto is the automatic grade; points applies manual overrides on top of it.
function grade(song, answers) {
    return Object.entries(answers).map(([player, a]) => {
        const auto = {
            year: yearPoints(a.year, song.year),
            artist: textOk(a.artist, song.artist) ? 1 : 0,
            title: textOk(a.title, song.title) ? 1 : 0,
        };
        return { player, ...a, auto, points: { ...auto, ...a.override } };
    });
}

const sumPoints = (points) => FIELDS.reduce((t, f) => t + points[f], 0);

// Each field counts once per group: the best points among its members.
const fieldBest = (graded, group) => {
    const mine = graded.filter((a) => a.group === group);
    return Object.fromEntries(FIELDS.map((f) => [f, Math.max(0, ...mine.map((a) => a.points[f]))]));
};

const groupPoints = (graded) =>
    Object.fromEntries(Array.from({ length: GROUPS }, (_, i) => [String(i + 1), sumPoints(fieldBest(graded, i + 1))]));

// Each group's top scorer for a round; ties go to whoever submitted their final answer first.
const groupBest = (graded) =>
    Array.from({ length: GROUPS }, (_, i) => {
        const best = graded
            .filter((a) => a.group === i + 1)
            .map((a) => ({ ...a, total: sumPoints(a.points) }))
            .sort((x, y) => y.total - x.total || x.at - y.at)[0];
        return best?.total > 0
            ? { group: i + 1, name: best.name, fields: FIELDS.filter((f) => best.points[f] > 0), points: best.total }
            : { group: i + 1, name: null, fields: [], points: 0 };
    });

const toList = (v) => (Array.isArray(v) ? v : [v]).filter((s) => typeof s === "string" && s.trim() !== "");

// youtube is optional; when present it must be an http(s) URL because the dashboard links to it.
const isLink = (v) => v === undefined || (typeof v === "string" && /^https?:\/\//i.test(v.trim()));

// Video id for the thumbnail; links that are not YouTube have none.
const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com"];

function youtubeId(link) {
    try {
        const url = new URL(link);
        const host = url.hostname.replace(/^(www|m|music)\./, "");
        if (!YOUTUBE_HOSTS.includes(host)) return null;
        const id =
            host === "youtu.be"
                ? url.pathname.slice(1)
                : (url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]);
        return /^[\w-]{11}$/.test(id ?? "") ? id : null;
    } catch {
        return null;
    }
}

// Identity of the song that was played, recorded at close time. Two songs are the same
// when their videos match, or when their titles match and either one has no video.
const songMark = (song) => ({ title: norm(song.title[0]), youtube: youtubeId(song.youtube) });
const sameSong = (a, b) => (a.youtube && b.youtube ? a.youtube === b.youtube : a.title === b.title);

const thumbOf = (song) => {
    const video = youtubeId(song.youtube);
    return video ? `https://i.ytimg.com/vi/${video}/hqdefault.jpg` : null;
};

// Closed rounds whose song is still the one that was played, most recently closed first.
// The open round must never reach players.
function closedIds(songs, round, awarded, closed) {
    return (
        Object.keys(awarded)
            .map(Number)
            .filter((s) => songs[s] && !(round?.open && round.songId === s))
            // Rounds without a close record are shown as they are.
            .filter((s) => !closed[s] || sameSong(songMark(songs[s]), closed[s]))
            // Rounds without a close time fall back to song order.
            .sort((x, y) => (closed[y]?.at ?? 0) - (closed[x]?.at ?? 0) || y - x)
    );
}

const ownAnswer = (a) => (a ? { year: a.year, artist: a.artist, title: a.title, points: a.points } : null);

function parseSongs(v) {
    if (!Array.isArray(v)) return null;
    if (!v.every((s) => isLink(s?.youtube))) return null;
    const songs = v.map((s) => ({
        year: s?.year,
        artist: toList(s?.artist),
        title: toList(s?.title),
        ...(s?.youtube === undefined ? {} : { youtube: s.youtube.trim() }),
    }));
    return songs.every((s) => Number.isInteger(s.year) && s.artist.length && s.title.length) ? songs : null;
}

// One Durable Object serializes every write. Each change is pushed over WebSocket:
// players get their own state, other sockets get the totals and refetch what they need.
export class Scores extends DurableObject {
    async read() {
        return (await this.ctx.storage.get("scores")) ?? emptyScores();
    }

    async add(group, delta) {
        const scores = await this.read();
        await this.ctx.storage.put("scores", {
            ...scores,
            [group]: Math.max(0, Math.min(MAX_SCORE, (scores[group] ?? 0) + delta)),
        });
        await this.push();
    }

    async set(group, score) {
        const scores = await this.read();
        await this.ctx.storage.put("scores", { ...scores, [group]: score });
        await this.push();
    }

    // ===== WebSocket =====
    // The Worker verifies the token first: g and id mark a player socket; without them the socket only receives totals.
    async fetch(request) {
        const url = new URL(request.url);
        const g = Number(url.searchParams.get("g"));
        const who = isGroup(g) ? { g, id: url.searchParams.get("id") } : null;
        const [client, server] = Object.values(new WebSocketPair());
        // Answer client pings without waking a hibernating object.
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment(who);
        const first = who
            ? this.playerView(await this.shared(), who)
            : { type: "scores", scores: await this.read(), ...(url.searchParams.has("rejoin") && { rejoin: true }) };
        server.send(JSON.stringify(first));
        return new Response(null, { status: 101, webSocket: client });
    }

    // Clients only send pings, which the auto-response answers.
    webSocketMessage() {}

    webSocketClose(ws, code, reason) {
        try {
            // 1005 means the client sent no code, which cannot be echoed back.
            ws.close(code === 1005 ? 1000 : code, reason);
        } catch {
            // The connection is already gone, e.g. 1006.
        }
    }

    // players = false is for changes only the admin pages show, such as new answers or song selection.
    async push(players = true) {
        const sockets = this.ctx.getWebSockets();
        if (!sockets.length) return;
        const shared = players ? await this.shared() : null;
        const scores = JSON.stringify({ type: "scores", scores: shared?.scores ?? (await this.read()) });
        for (const ws of sockets) {
            const who = ws.deserializeAttachment();
            if (who && !players) continue;
            try {
                ws.send(who ? JSON.stringify(this.playerView(shared, who)) : scores);
            } catch {
                // A closing socket receives the full state again when it reconnects.
            }
        }
    }

    // ===== Rounds =====
    // Storage keys: scores, songs (with answers), groupPw, round {songId, open}, selected (song shown on /host),
    // ans:<songId> {"<group>:<player id>": answer}, awarded {songId: {group: points added}},
    // closed {songId: {at: last close time, title, youtube: identity of the song that was played}}

    async load(key, fallback) {
        return (await this.ctx.storage.get(key)) ?? fallback;
    }

    // An empty code keeps that group closed.
    async groupForCode(code) {
        const key = codeKey(code);
        if (!key) return null;
        const hit = Object.entries(await this.load("groupPw", {})).find(([, c]) => codeKey(c) === key);
        return hit ? Number(hit[0]) : null;
    }

    async setGroupPasswords(passwords) {
        await this.ctx.storage.put("groupPw", passwords);
    }

    // The part of every player's view that is the same for all, computed once per push.
    async shared() {
        const [scores, songs, round, awarded, closed] = await Promise.all([
            this.read(),
            this.load("songs", []),
            this.load("round", null),
            this.load("awarded", {}),
            this.load("closed", {}),
        ]);
        const answers = round && songs[round.songId] ? await this.load(`ans:${round.songId}`, {}) : {};
        const ids = round && !round.open ? closedIds(songs, round, awarded, closed) : [];
        if (!ids.includes(round?.songId)) return { scores, round, answers, graded: [], result: null };
        const song = songs[round.songId];
        const graded = grade(song, answers);
        const teams = Object.fromEntries(Array.from({ length: GROUPS }, (_, i) => [i + 1, fieldBest(graded, i + 1)]));
        const rounds = ids.slice(ids.indexOf(round.songId)).reverse().map((s) => awarded[s]);
        return {
            scores,
            round,
            answers,
            graded,
            result: {
                no: round.songId + 1,
                year: song.year,
                artist: song.artist[0],
                title: song.title[0],
                thumb: thumbOf(song),
                groups: awarded[round.songId],
                best: groupBest(graded),
                notes: notes(rounds, scores, teams),
            },
        };
    }

    // While a round is open this must never include the answer key; result exists only after close.
    playerView({ scores, round, answers, graded, result }, { g, id }) {
        const key = `${g}:${id}`;
        const a = round?.open ? answers[key] : null;
        return {
            type: "state",
            group: g,
            scores,
            round: round && { no: round.songId + 1, open: round.open },
            answer: a ? { year: a.year, artist: a.artist, title: a.title } : null,
            result: result && { ...result, mine: ownAnswer(graded.find((x) => x.player === key)) },
        };
    }

    async playerState(group, id) {
        return this.playerView(await this.shared(), { g: group, id });
    }

    // Closed rounds, most recently closed first, with the player's own answer and their group's points per field.
    async playerHistory(group, id) {
        const [songs, round, awarded, closed] = await Promise.all([
            this.load("songs", []),
            this.load("round", null),
            this.load("awarded", {}),
            this.load("closed", {}),
        ]);
        const key = `${group}:${id}`;
        const history = [];
        for (const songId of closedIds(songs, round, awarded, closed)) {
            const song = songs[songId];
            const graded = grade(song, await this.load(`ans:${songId}`, {}));
            history.push({
                no: songId + 1,
                year: song.year,
                artist: song.artist[0],
                title: song.title[0],
                thumb: thumbOf(song),
                groups: awarded[songId],
                mine: ownAnswer(graded.find((a) => a.player === key)),
                team: { points: fieldBest(graded, group), best: groupBest(graded)[group - 1].name },
            });
        }
        return history;
    }

    async submit(group, id, name, answer) {
        const round = await this.load("round", null);
        if (!round?.open) return false;
        const key = `ans:${round.songId}`;
        const answers = await this.load(key, {});
        // A new answer clears manual overrides made for the previous one.
        answers[`${group}:${id}`] = { group, name, ...answer, at: Date.now(), override: {} };
        await this.ctx.storage.put(key, answers);
        await this.push(false);
        return true;
    }

    // Returns an error message, or null when the list was saved.
    async setSongs(songs) {
        if ((await this.load("round", null))?.open) return "作答中不能改歌單，請先收卷";
        const [current, awarded, closed] = await Promise.all([
            this.load("songs", []),
            this.load("awarded", {}),
            this.load("closed", {}),
        ]);
        // A played song can only be corrected in place; removing or replacing it would regrade its points against another song.
        const played = Object.keys(awarded).map(Number).filter((i) => closed[i] || current[i]);
        const changed = played.find((i) => !songs[i] || !sameSong(songMark(songs[i]), closed[i] ?? songMark(current[i])));
        if (changed !== undefined) return `第 ${changed + 1} 首已經收卷，只能修正解答，不能刪掉或換成別首歌`;
        await this.ctx.storage.put("songs", songs);
        for (const id of Object.keys(awarded)) await this.settle(Number(id));
        await this.push();
        return null;
    }

    async select(songId) {
        if (!(await this.load("songs", []))[songId]) return false;
        await this.ctx.storage.put("selected", songId);
        await this.push(false);
        return true;
    }

    async openRound(songId) {
        if ((await this.load("round", null))?.open) return "請先收卷";
        if (!(await this.load("songs", []))[songId]) return "沒有這首歌";
        await this.ctx.storage.put("round", { songId, open: true });
        await this.ctx.storage.put("selected", songId);
        await this.push();
        return null;
    }

    async closeRound() {
        const round = await this.load("round", null);
        if (!round?.open) return false;
        await this.ctx.storage.put("round", { ...round, open: false });
        const song = (await this.load("songs", []))[round.songId];
        const closed = await this.load("closed", {});
        await this.ctx.storage.put("closed", {
            ...closed,
            [round.songId]: { at: Date.now(), ...(song ? songMark(song) : {}) },
        });
        await this.settle(round.songId);
        await this.push();
        return true;
    }

    async judge(songId, player, field, value) {
        const key = `ans:${songId}`;
        const answers = await this.load(key, {});
        const a = answers[player];
        if (!a) return false;
        if (value === null) delete a.override[field];
        else a.override[field] = value;
        await this.ctx.storage.put(key, answers);
        const round = await this.load("round", null);
        if (!(round?.open && round.songId === songId)) await this.settle(songId);
        await this.push();
        return true;
    }

    // Regrade a song and apply only the difference from the points awarded before.
    async settle(songId) {
        const song = (await this.load("songs", []))[songId];
        if (!song) return;
        const points = groupPoints(grade(song, await this.load(`ans:${songId}`, {})));
        const awarded = await this.load("awarded", {});
        const prev = awarded[songId] ?? {};
        const scores = await this.read();
        for (const g of Object.keys(points)) {
            const next = (scores[g] ?? 0) + points[g] - (prev[g] ?? 0);
            scores[g] = Math.max(0, Math.min(MAX_SCORE, next));
        }
        await this.ctx.storage.put("scores", scores);
        await this.ctx.storage.put("awarded", { ...awarded, [songId]: points });
    }

    async resetAll() {
        await this.ctx.storage.deleteAll();
        await this.push();
    }

    async adminState(songId) {
        const songs = await this.load("songs", []);
        const round = await this.load("round", null);
        const id = Number.isInteger(songId) ? songId : await this.load("selected", round?.songId);
        const song = songs[id];
        return {
            songs,
            round,
            groupPw: await this.load("groupPw", {}),
            songId: song ? id : null,
            answers: song ? grade(song, await this.load(`ans:${id}`, {})) : [],
            awarded: (await this.load("awarded", {}))[id] ?? null,
        };
    }
}

const scoresStub = (env) => env.SCORES.getByName("main");

// Browsers cannot set headers on a WebSocket request, so the player token travels in the query string
// and may appear in request logs. Admin pages connect without a token and refetch over POST.
async function handleSocket(env, request) {
    if (request.headers.get("Upgrade") !== "websocket") return fail("expected websocket", 426);
    const token = new URL(request.url).searchParams.get("token");
    const target = new URL("https://scores/ws");
    if (token) {
        const player = await verifyPlayerToken(env.AUTH_SECRET, token);
        if (player?.id) {
            target.searchParams.set("g", String(player.g));
            target.searchParams.set("id", player.id);
        } else {
            // Invalid or expired token: connect as a totals-only socket and ask the phone to join again.
            target.searchParams.set("rejoin", "1");
        }
    }
    return scoresStub(env).fetch(new Request(target, request));
}

async function requireAuth(env, body) {
    return verifyToken(env.AUTH_SECRET, body?.token);
}

async function handleLogin(env, request) {
    const form = await request.formData();
    if (form.get("username") !== env.USERNAME || form.get("password") !== env.PASSWORD) {
        return fail("帳號或密碼錯誤", 401);
    }
    return ok({ token: await issueToken(env.AUTH_SECRET) });
}

async function handleAddScore(env, body) {
    if (!(await requireAuth(env, body))) return fail("please login", 401);
    if (!isGroup(body.group)) return fail("unaccept group value");

    // The dashboard sends delta (may be negative); without it, each true field adds 1.
    const delta = body.delta ?? [body.year, body.name, body.sing, body.dance].filter((v) => v === true).length;
    if (!Number.isInteger(delta) || Math.abs(delta) > MAX_SCORE) return fail("unaccept delta value");
    await scoresStub(env).add(body.group, delta);
    return ok();
}

async function handleSetScore(env, body) {
    if (!(await requireAuth(env, body))) return fail("please login", 401);
    if (!isGroup(body.group)) return fail("unaccept group value");
    if (!Number.isInteger(body.score) || body.score < 0 || body.score > MAX_SCORE) {
        return fail("unaccept score value");
    }

    await scoresStub(env).set(body.group, body.score);
    return ok();
}

async function handleJoin(env, body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 20) return fail("名字要 1–20 個字");
    const group = await scoresStub(env).groupForCode(body.code);
    if (!group) return fail("組別代碼錯誤", 401);
    return ok({ group, token: await issuePlayerToken(env.AUTH_SECRET, group, name) });
}

async function handlePlay(env, action, body) {
    const player = await verifyPlayerToken(env.AUTH_SECRET, body.token);
    // Tokens without a player id must join again.
    if (!player?.id) return fail("please join", 401);
    const stub = scoresStub(env);

    // Same payload as the WebSocket push; kept for debugging and tests.
    if (action === "state") return ok(await stub.playerState(player.g, player.id));
    if (action === "history") return ok({ history: await stub.playerHistory(player.g, player.id) });

    if (action === "answer") {
        const year = body.year ?? null;
        if (year !== null && !Number.isInteger(year)) return fail("年份要是整數");
        const text = (v) => (typeof v === "string" ? v.trim().slice(0, 50) : "");
        const answer = { year, artist: text(body.artist), title: text(body.title) };
        return (await stub.submit(player.g, player.id, player.n, answer)) ? ok() : fail("現在不能作答");
    }

    return fail("not found", 404);
}

async function handleAdmin(env, action, body) {
    if (!(await requireAuth(env, body))) return fail("please login", 401);
    const stub = scoresStub(env);

    if (action === "state") return ok(await stub.adminState(body.songId));

    if (action === "reset") {
        await stub.resetAll();
        return ok();
    }

    if (action === "songs") {
        const songs = parseSongs(body.songs);
        if (!songs) return fail("歌單格式錯誤");
        const err = await stub.setSongs(songs);
        return err ? fail(err) : ok();
    }

    if (action === "select") {
        if (!Number.isInteger(body.songId)) return fail("沒有這首歌");
        return (await stub.select(body.songId)) ? ok() : fail("沒有這首歌");
    }

    if (action === "open") {
        if (!Number.isInteger(body.songId)) return fail("沒有這首歌");
        const err = await stub.openRound(body.songId);
        return err ? fail(err) : ok();
    }

    if (action === "close") {
        return (await stub.closeRound()) ? ok() : fail("目前沒有作答中的題目");
    }

    if (action === "judge") {
        const { songId, player, field, value } = body;
        if (!Number.isInteger(songId) || typeof player !== "string") return fail("參數錯誤");
        if (!FIELDS.includes(field) || !(value === null || FIELD_POINTS[field].includes(value))) {
            return fail("參數錯誤");
        }
        return (await stub.judge(songId, player, field, value)) ? ok() : fail("找不到這份答案");
    }

    if (action === "passwords") {
        const passwords = Object.fromEntries(
            Array.from({ length: GROUPS }, (_, i) => [String(i + 1), body.passwords?.[i + 1]]),
        );
        if (!Object.values(passwords).every((v) => typeof v === "string")) return fail("代碼格式錯誤");
        const keys = Object.values(passwords).map(codeKey).filter(Boolean);
        if (new Set(keys).size !== keys.length) return fail("各組的代碼不能重複");
        await stub.setGroupPasswords(passwords);
        return ok();
    }

    return fail("not found", 404);
}

export default {
    async fetch(request, env) {
        const { pathname } = new URL(request.url);

        if (pathname === "/api/ws") return handleSocket(env, request);

        if (pathname === "/api/GetScore" && request.method === "GET") {
            return json(await scoresStub(env).read());
        }

        if (request.method !== "POST") return fail("not found", 404);

        if (pathname === "/api/login") return handleLogin(env, request);

        let body;
        try {
            body = await request.json();
        } catch {
            return fail("json decode error");
        }

        if (pathname === "/api/AddScore") return handleAddScore(env, body);
        if (pathname === "/api/SetScore") return handleSetScore(env, body);
        if (pathname === "/api/join") return handleJoin(env, body);
        if (pathname.startsWith("/api/play/")) return handlePlay(env, pathname.slice(10), body);
        if (pathname.startsWith("/api/admin/")) return handleAdmin(env, pathname.slice(11), body);

        return fail("not found", 404);
    },
};
