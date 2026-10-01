// Player page: state is pushed over WebSocket (live.js); only joining, answering and history call the API.
// Each round opens and closes with an animation; tapping the screen skips to the end.
const PLAYER_KEY = "ntust_camp_player";
const VIEW_KEY = "ntust_camp_history_view";
const GROUPS = [1, 2, 3, 4];
const FIELDS = ["year", "artist", "title"];
const FIELD_NAMES = { year: "年份", artist: "歌手", title: "歌名" };
const SVG_NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const app = $("app");
const stage = $("stage");
const intro = $("intro");
const stamp = $("stamp");
const flood = $("flood");
const conn = $("conn");
const sheet = $("sheet");
const sheetPanel = sheet.querySelector(".sheet-panel");
const answerScene = $("answer");
const resultScene = $("result");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const token = () => localStorage.getItem(PLAYER_KEY);
const sumPoints = (p) => FIELDS.reduce((t, f) => t + p[f], 0);
const myGroup = () => Number(app.dataset.me);

// The token's first part is base64url {g: group, n: name}; it is read for display only and verified by the server.
function whoAmI() {
    try {
        const b64 = token().split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    } catch {
        return null;
    }
}

async function api(url, payload) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
    return { status: res.status, data: await res.json() };
}

// Names and answers are user input: always use textContent, never HTML.
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function svgUse(className, id) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#${id}`);
    svg.append(use);
    return svg;
}
const shape = (g) => svgUse("shape", `sh${g}`);
const icon = (id) => svgUse("icon", id);

// ===== Sequencing: a new run cancels the previous sequence; skip() resolves the remaining waits =====
let run = 0;
let playing = 0;
let skipping = false;
const waiters = new Set();

function wait(ms) {
    if (skipping) return Promise.resolve();
    return new Promise((resolve) => {
        const w = {
            resolve,
            timer: setTimeout(
                () => {
                    waiters.delete(w);
                    resolve();
                },
                reduce.matches ? Math.min(ms, 150) : ms,
            ),
        };
        waiters.add(w);
    });
}

function flush() {
    for (const w of waiters) {
        clearTimeout(w.timer);
        w.resolve();
    }
    waiters.clear();
}

function skip() {
    if (!playing) return;
    skipping = true;
    flush();
}

function begin() {
    run++;
    flush();
    skipping = false;
    resetFx();
    playing = run;
    return run;
}

// Apply any state that arrived while the sequence was playing.
function finish(id) {
    if (id !== run) return;
    playing = 0;
    skipping = false;
    if (latest) sync(latest);
}

async function pause(ms, id) {
    await wait(ms);
    return id !== run;
}

function resetFx() {
    intro.hidden = true;
    intro.className = "fx intro";
    $("count").replaceChildren();
    stamp.hidden = true;
    stamp.className = "fx stamp";
    flood.hidden = true;
    flood.className = "fx flood";
    app.classList.remove("shake");
    resultScene.classList.remove("revealing");
    answerScene.classList.remove("entering");
    stopConfetti();
}

function shake() {
    app.classList.remove("shake");
    void app.offsetWidth;
    app.classList.add("shake");
}

function countUp(node, from, to, ms, id) {
    if (skipping || reduce.matches || from === to) {
        node.textContent = to;
        return;
    }
    const t0 = performance.now();
    const tick = (now) => {
        // Stop once the sequence ends (finished or skipped) so newer pushed totals are not overwritten.
        if (id !== run || playing !== id) return;
        const k = Math.min(1, (now - t0) / ms);
        node.textContent = skipping ? to : Math.round(from + (to - from) * (1 - (1 - k) ** 3));
        if (k < 1 && !skipping) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function floatPlus(g, n) {
    if (!n || skipping || reduce.matches) return;
    const f = el("span", "plus-float", `+${n}`);
    $(`top_${g}`).append(f);
    setTimeout(() => f.remove(), 1600);
}

// ===== Screens =====
function setScene(name) {
    if (app.dataset.scene === name) return;
    app.dataset.scene = name;
    stage.scrollTop = 0;
}

function renderTop(scores) {
    for (const g of GROUPS) {
        $(`top_${g}`).querySelector("b").textContent = scores?.[g] ?? 0;
        $(`top_${g}`).classList.toggle("mine", g === myGroup());
    }
}

function setRoundNo(no) {
    for (const b of document.querySelectorAll(".round-no")) b.textContent = no ?? "";
    $("me_round").hidden = !no;
    $("me_round").textContent = no ? `第 ${no} 題` : "";
}

// YouTube thumbnail when available, otherwise or on error a record.
function setCover(box, thumb, no) {
    box.style.setProperty("--c1", `var(--g${(no % 4) + 1})`);
    box.style.setProperty("--c2", `var(--g${((no + 2) % 4) + 1})`);
    const disc = el("span", "disc");
    if (!thumb) return box.replaceChildren(disc);
    const img = document.createElement("img");
    img.src = thumb;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(disc));
    box.replaceChildren(img);
}

// ===== Answering =====
// Last answer the server accepted, as JSON; drives the button's sent and update states.
let sent = null;

function readAnswer() {
    const year = $("ans_year").valueAsNumber;
    return {
        year: Number.isNaN(year) ? null : year,
        artist: $("ans_artist").value.trim(),
        title: $("ans_title").value.trim(),
    };
}

function markSent() {
    const done = sent !== null && sent === JSON.stringify(readAnswer());
    $("answer_btn").classList.toggle("sent", done);
    $("answer_label").textContent = done ? "已送出" : sent ? "更新答案" : "送出答案";
}

function fillAnswer(a) {
    $("ans_year").value = a?.year ?? "";
    $("ans_artist").value = a?.artist ?? "";
    $("ans_title").value = a?.title ?? "";
    sent = a ? JSON.stringify(readAnswer()) : null;
    markSent();
}

// ===== Round result =====
const rowByGroup = {};
const beforeScores = (scores, gains) =>
    Object.fromEntries(GROUPS.map((g) => [g, Math.max(0, (scores[g] ?? 0) - (gains[g] ?? 0))]));

const cheer = (mine, total) =>
    !mine ? "未作答" : total >= 5 ? "完美！" : total >= 3 ? "漂亮！" : total > 0 ? "加油！" : "差一點！";

function mineRow(f, mine) {
    const pts = mine?.points[f] ?? 0;
    const li = el("li", `card mine-row rv ${pts > 0 ? "hit" : "miss"}`);
    const mark = el("span", "m-mark");
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", pts > 0 ? "答對" : "答錯");
    mark.append(icon(pts > 0 ? "ic-check" : "ic-cross"));
    li.append(el("span", "m-label", FIELD_NAMES[f]), el("span", "m-val", String(mine?.[f] ?? "") || "—"), mark, el("span", "m-pts", `+${pts}`));
    return li;
}

// The group's top scorer for the round (ties go to the earliest submission) alternates with the group name.
function groupLabel(g, name) {
    const box = el("span", name ? "b-names swap" : "b-names");
    if (name) box.append(el("span", "b-who", name));
    box.append(el("span", "b-team", `第 ${g} 組`));
    return box;
}

function setRanks(scores) {
    const order = [...GROUPS].sort((x, y) => scores[y] - scores[x] || x - y);
    for (const g of GROUPS) {
        rowByGroup[g].style.setProperty("--rank", order.indexOf(g));
        // Tied groups share a place.
        rowByGroup[g].querySelector(".b-rank").textContent = 1 + GROUPS.filter((x) => scores[x] > scores[g]).length;
    }
}

function setBars(scores, top) {
    for (const g of GROUPS) rowByGroup[g].style.setProperty("--p", ((scores[g] ?? 0) / top).toFixed(3));
}

function buildBoard(scores, r, settled, top) {
    $("board_list").replaceChildren(
        ...GROUPS.map((g) => {
            const li = el("li", `card b-row${g === myGroup() ? " is-me" : ""}${settled ? " scored" : ""}`);
            li.dataset.g = g;
            const best = r.best.find((b) => b.group === g);
            li.append(
                el("span", "b-fill"),
                el("span", "b-rank"),
                shape(g),
                groupLabel(g, best?.name),
                el("span", "b-total", String(scores[g] ?? 0)),
                el("span", "b-plus", `+${r.groups[g] ?? 0}`),
            );
            rowByGroup[g] = li;
            return li;
        }),
    );
    setRanks(scores);
    setBars(scores, top);
}

// settled: the screen after the reveal; false: before it, with the totals from before the round.
function renderResult(r, scores, settled) {
    const top = Math.max(1, ...GROUPS.map((g) => scores[g] ?? 0));
    setCover($("key_cover"), r.thumb, r.no);
    $("key_title").textContent = r.title;
    $("key_meta").textContent = `${r.artist} · ${r.year}`;
    $("mine_list").replaceChildren(...FIELDS.map((f) => mineRow(f, r.mine)));
    buildBoard(settled ? scores : beforeScores(scores, r.groups), r, settled, top);
    $("notes").replaceChildren(...r.notes.map((t) => el("li", "", t)));
    for (const n of resultScene.querySelectorAll(".rv.in")) n.classList.remove("in");
}

function renderFlood(r) {
    const total = r.mine ? sumPoints(r.mine.points) : 0;
    flood.dataset.kind = total ? "hit" : "miss";
    $("flood_use").setAttribute("href", total ? "#ic-check" : "#ic-cross");
    $("flood_text").textContent = cheer(r.mine, total);
    $("flood_pts").textContent = `+${total}`;
}

// ===== Confetti in the four group shapes =====
const canvas = $("confetti");
const ctx = canvas.getContext("2d");
let confettiRaf = 0;

function stopConfetti() {
    cancelAnimationFrame(confettiRaf);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawBit(b, color) {
    const s = b.s;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (b.k === 0) {
        ctx.moveTo(0, -s / 2);
        ctx.lineTo(s / 2, s / 2);
        ctx.lineTo(-s / 2, s / 2);
    } else if (b.k === 1) {
        ctx.moveTo(0, -s / 2);
        ctx.lineTo(s / 2, 0);
        ctx.lineTo(0, s / 2);
        ctx.lineTo(-s / 2, 0);
    } else if (b.k === 2) {
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
    } else {
        ctx.rect(-s / 2, -s / 2, s, s);
    }
    ctx.fill();
    ctx.restore();
}

function confetti() {
    if (reduce.matches || skipping) return;
    const { width, height } = app.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(app);
    const colors = GROUPS.map((g) => css.getPropertyValue(`--g${g}`).trim());
    const bits = Array.from({ length: 90 }, (_, i) => ({
        x: width / 2 + (Math.random() - 0.5) * 80,
        y: height * 0.45,
        vx: (Math.random() - 0.5) * 10,
        vy: -(7 + Math.random() * 9),
        a: Math.random() * Math.PI * 2,
        va: (Math.random() - 0.5) * 0.3,
        s: 7 + Math.random() * 7,
        k: i % 4,
    }));
    const t0 = performance.now();
    let last = t0;
    cancelAnimationFrame(confettiRaf);
    const frame = (now) => {
        const dt = Math.min(2.5, (now - last) / 16.7);
        last = now;
        ctx.clearRect(0, 0, width, height);
        for (const b of bits) {
            b.vy += 0.34 * dt;
            b.vx *= 0.99;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.a += b.va * dt;
            drawBit(b, colors[b.k]);
        }
        if (now - t0 < 2800) confettiRaf = requestAnimationFrame(frame);
        else ctx.clearRect(0, 0, width, height);
    };
    confettiRaf = requestAnimationFrame(frame);
}

// ===== Round start: wipe, round number, 3-2-1 countdown, start =====
async function playIntro() {
    const id = begin();
    closeSheet();
    setScene("answer");
    intro.hidden = false;
    intro.classList.add("s-wipe");
    if (await pause(540, id)) return;
    intro.classList.add("s-card");
    if (await pause(650, id)) return;
    for (const n of [3, 2, 1]) {
        $("count").replaceChildren(el("span", "count-num", String(n)));
        if (await pause(580, id)) return;
    }
    intro.classList.add("s-go");
    if (await pause(520, id)) return;
    intro.classList.add("s-out");
    answerScene.classList.add("entering");
    if (await pause(480, id)) return;
    intro.hidden = true;
    finish(id);
}

// ===== Round end: TIME'S UP, full-screen result, answer key and own answers, group totals, re-ranking, commentary =====
async function playReveal(s) {
    const id = begin();
    closeSheet();
    const r = s.result;
    const total = r.mine ? sumPoints(r.mine.points) : 0;
    const before = beforeScores(s.scores, r.groups);
    const show = (node) => node.classList.add("in");
    renderTop(before);
    stamp.hidden = false;
    stamp.classList.add("go");
    shake();
    if (await pause(1000, id)) return;
    renderFlood(r);
    flood.hidden = false;
    flood.classList.add("go");
    stamp.hidden = true;
    if (await pause(1300, id)) return;
    renderResult(r, s.scores, false);
    resultScene.classList.add("revealing");
    setScene("result");
    flood.classList.replace("go", "out");
    if (await pause(300, id)) return;
    flood.hidden = true;
    show(resultScene.querySelector(".q-no"));
    show(resultScene.querySelector(".key-card"));
    if (await pause(520, id)) return;
    for (const row of resultScene.querySelectorAll(".mine-row")) {
        show(row);
        if (await pause(340, id)) return;
    }
    if (total) confetti();
    if (await pause(total ? 700 : 300, id)) return;
    // The page is long: scroll to the group totals after the player's own rows.
    show($("board"));
    stage.scrollTo({ top: $("board").offsetTop - 12, behavior: reduce.matches || skipping ? "auto" : "smooth" });
    if (await pause(650, id)) return;
    for (const g of GROUPS) {
        rowByGroup[g].classList.add("scored");
        countUp(rowByGroup[g].querySelector(".b-total"), before[g], s.scores[g], 900, id);
        countUp($(`top_${g}`).querySelector("b"), before[g], s.scores[g], 900, id);
        floatPlus(g, r.groups[g]);
    }
    setBars(s.scores, Math.max(1, ...GROUPS.map((g) => s.scores[g] ?? 0)));
    if (await pause(1050, id)) return;
    setRanks(s.scores);
    if (await pause(500, id)) return;
    show($("notes"));
    show(resultScene.querySelector(".wait-next"));
    if (await pause(500, id)) return;
    // Count-ups may not finish when skipped or in a background tab, so write the final totals.
    renderTop(s.scores);
    for (const g of GROUPS) rowByGroup[g].querySelector(".b-total").textContent = s.scores[g] ?? 0;
    resultScene.classList.remove("revealing");
    finish(id);
}

// ===== Answer history: personal / group =====
// Cards are built once; switching views only replaces changed text and numbers, and group-only parts collapse via #sheet[data-view].
let historyView = "mine";
// Last loaded history: shown at once on reopen and re-rendered only when a refetch differs.
let historyData = null;
let historyJson = "";
let historyCards = [];
let historySeq = 0;

// Total and the three [text, points] rows for the current view; the group view shows the answers that scored.
function viewOf(h) {
    const team = historyView === "team";
    const a = team ? h.team : h.mine;
    return {
        total: team ? (h.groups[myGroup()] ?? 0) : a ? sumPoints(a.points) : 0,
        rows: FIELDS.map((f) => (a ? [String(a[f] ?? "") || "—", a.points[f]] : ["未作答", 0])),
    };
}

// Numbers slide up when they grow and down when they shrink; text always slides up.
function roll(box, text, num, animate) {
    const current = box.lastElementChild;
    if (current?.textContent === text) return;
    const dir = num === undefined || !(num < Number(box.dataset.num)) ? "up" : "down";
    if (num !== undefined) box.dataset.num = num;
    if (current) {
        if (animate) {
            current.className = `out-${dir}`;
            setTimeout(() => current.remove(), 400);
        } else {
            current.remove();
        }
    }
    box.append(el("span", animate && current ? `in-${dir}` : "", text));
}

function applyView(card, animate) {
    const { total, rows } = viewOf(card.h);
    roll(card.gain, `+${total}`, total, animate);
    card.gain.classList.toggle("zero", !total);
    rows.forEach(([text, pts], i) => {
        const { row, value, points } = card.cells[i];
        row.classList.toggle("miss", pts === 0);
        roll(value, text, undefined, animate);
        roll(points, `+${pts}`, pts, animate);
    });
}

function groupChips(groups) {
    const box = el("div", "h-groups");
    for (const g of GROUPS) {
        const chip = el("span", g === myGroup() ? "mine" : "");
        chip.dataset.g = g;
        chip.append(shape(g), `+${groups[g] ?? 0}`);
        box.append(chip);
    }
    return box;
}

// One card per round; the top half matches the answer card on the result screen.
function historyCard(h) {
    const node = el("article", "h-item");
    const top = el("div", "h-top");
    const cover = el("div", "cover");
    cover.setAttribute("aria-hidden", "true");
    setCover(cover, h.thumb, h.no);
    const text = el("div", "h-text");
    text.append(el("p", "h-no", `第 ${h.no} 題`), el("h4", "h-title", h.title), el("p", "h-meta", `${h.artist} · ${h.year}`));
    const gain = el("span", "h-gain roll");
    top.append(cover, text, gain);
    const list = el("ul", "h-rows");
    const cells = FIELDS.map((f) => {
        const row = el("li", "h-row");
        const value = el("span", "value roll");
        const points = el("span", "pts roll");
        row.append(el("span", "label", FIELD_NAMES[f]), value, points);
        list.append(row);
        return { row, value, points };
    });
    // Group view only: the group's top scorer and every group's points.
    const extra = el("div", "h-extra");
    const inner = el("div");
    if (h.team.best) inner.append(el("p", "h-best", h.team.best));
    inner.append(groupChips(h.groups));
    extra.append(inner);
    node.append(top, list, extra);
    const card = { h, gain, cells };
    applyView(card, false);
    return { node, card };
}

function renderHistory() {
    const list = $("history_list");
    if (!historyData.length) {
        historyCards = [];
        return list.replaceChildren(el("p", "h-empty", "無題目"));
    }
    const built = historyData.map(historyCard);
    historyCards = built.map((b) => b.card);
    list.replaceChildren(...built.map((b) => b.node));
}

async function loadHistory() {
    const seq = ++historySeq;
    try {
        const { status, data } = await api("/api/play/history", { token: token() });
        // Swap the content only after the slide-up, so the moving panel is never repainted.
        await Promise.allSettled(sheetPanel.getAnimations().map((a) => a.finished));
        // A newer request is pending, or the sheet closed while waiting.
        if (seq !== historySeq || sheet.hidden) return;
        if (status === 401) return leave();
        const json = JSON.stringify(data.history ?? []);
        if (json === historyJson) return;
        historyJson = json;
        historyData = data.history ?? [];
        renderHistory();
    } catch {
        if (seq === historySeq && !historyData) $("history_list").replaceChildren(el("p", "h-empty", "載入失敗，請再開一次"));
    }
}

function openSheet() {
    if (!historyData) $("history_list").replaceChildren(el("p", "h-empty", "載入中…"));
    sheet.hidden = false;
    // The close button starts below the screen; a scrolling focus would shift the whole page.
    $("sheet_close").focus({ preventScroll: true });
    void loadHistory();
}

function closeSheet() {
    sheet.hidden = true;
}

function setView(view) {
    historyView = view;
    sheet.dataset.view = view;
    try {
        localStorage.setItem(VIEW_KEY, view);
    } catch {}
    for (const b of sheet.querySelectorAll("button[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
    for (const card of historyCards) applyView(card, true);
}

// ===== Pushed state to screen =====
// Latest pushed state; held during an animation and applied when it ends.
let latest = null;
// Round on screen ("none", "3:true", "3:false"); the scene changes only when it differs.
let shownKey;
// State currently rendered; identical pushes are ignored.
let shownJson = "";

function sync(s) {
    const json = JSON.stringify(s);
    if (json === shownJson) return;
    shownJson = json;
    app.dataset.me = s.group;
    const key = s.round ? `${s.round.no}:${s.round.open}` : "none";
    const from = shownKey;
    shownKey = key;
    setRoundNo(s.round?.no);
    // Judging and list corrections change the history too.
    if (!sheet.hidden) void loadHistory();

    if (s.round?.open) {
        renderTop(s.scores);
        // Same open round: update the totals only and leave the inputs alone.
        if (key === from) return;
        fillAnswer(s.answer);
        // Play the intro only when the round opens while this page is watching.
        if (from === undefined) return setScene("answer");
        return void playIntro();
    }
    if (s.result) {
        // Play the reveal only when this page saw the round open; otherwise show the result directly.
        if (from === `${s.result.no}:true`) return void playReveal(s);
        renderTop(s.scores);
        renderResult(s.result, s.scores, true);
        return setScene("result");
    }
    renderTop(s.scores);
    setScene("lobby");
}

function onMessage(msg) {
    if (msg.type === "scores") {
        // The server downgraded an invalid token to a totals-only socket: join again.
        if (msg.rejoin && token()) return leave();
        if (!token()) renderTop(msg.scores);
        return;
    }
    latest = msg;
    if (!playing) sync(msg);
}

// ===== Join / leave =====
function forget() {
    latest = null;
    shownKey = undefined;
    shownJson = "";
    historyData = null;
    historyJson = "";
    historyCards = [];
    begin();
    finish(run);
    closeSheet();
}

function showMe() {
    const me = whoAmI();
    app.dataset.me = me?.g ?? "";
    $("me_shape").setAttribute("href", `#sh${me?.g ?? 1}`);
    $("me_name").textContent = me?.n ?? "";
    $("me_team").textContent = me ? `第 ${me.g} 組` : "";
    $("lobby_team").textContent = me ? `第 ${me.g} 組` : "";
    $("lobby_name").textContent = me?.n ?? "";
    // The first pushed state decides the scene.
    setScene("lobby");
}

async function join(e) {
    e.preventDefault();
    try {
        const { data } = await api("/api/join", { name: $("player_name").value.trim(), code: $("group_code").value });
        if (data.status !== 1) return alert(data.msg);
        localStorage.setItem(PLAYER_KEY, data.token);
        forget();
        showMe();
        socket.reconnect();
    } catch {
        alert("網路錯誤，請再試一次");
    }
}

function leave() {
    localStorage.removeItem(PLAYER_KEY);
    forget();
    app.dataset.me = "";
    setRoundNo(null);
    setScene("join");
    socket.reconnect();
}

async function submitAnswer(e) {
    e.preventDefault();
    const answer = readAnswer();
    const btn = $("answer_btn");
    btn.disabled = true;
    try {
        const { status, data } = await api("/api/play/answer", { token: token(), ...answer });
        if (status === 401) return leave();
        // No alert once the round has closed: the reveal is on its way and an alert would block it.
        if (data.status !== 1) return latest?.round?.open ? alert(data.msg) : undefined;
        sent = JSON.stringify(answer);
        markSent();
    } catch {
        alert("網路錯誤，請再試一次");
    } finally {
        btn.disabled = false;
    }
}

// ===== Connection banner, delayed because short drops usually reconnect within a second or two =====
let connTimer = 0;
function onStatus(up) {
    clearTimeout(connTimer);
    if (up) {
        app.classList.remove("offline");
        if (conn.hidden) return;
        conn.classList.add("ok");
        $("conn_text").textContent = "已重新連線";
        connTimer = setTimeout(() => (conn.hidden = true), 1500);
        return;
    }
    connTimer = setTimeout(() => {
        conn.classList.remove("ok");
        $("conn_text").textContent = "連線中斷，重新連線中";
        conn.hidden = false;
        app.classList.add("offline");
    }, 1500);
}

$("join_form").addEventListener("submit", (e) => void join(e));
$("answer_form").addEventListener("submit", (e) => void submitAnswer(e));
for (const id of ["ans_year", "ans_artist", "ans_title"]) $(id).addEventListener("input", markSent);
$("history_btn").addEventListener("click", openSheet);
$("leave_btn").addEventListener("click", leave);
$("sheet_close").addEventListener("click", closeSheet);
sheet.addEventListener("click", (e) => {
    if (e.target === sheet) closeSheet();
});
for (const b of sheet.querySelectorAll("button[data-view]")) b.addEventListener("click", () => setView(b.dataset.view));
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
});
app.addEventListener("pointerdown", () => {
    if (playing) skip();
});

// ?code= prefills the group code, e.g. from a QR code.
const presetCode = new URLSearchParams(location.search).get("code");
if (presetCode) $("group_code").value = presetCode;

try {
    setView(localStorage.getItem(VIEW_KEY) === "team" ? "team" : "mine");
} catch {}
if (token()) showMe();
const socket = live(onMessage, token, onStatus);
