// 作答頁（defer 載入，DOM 已就緒）：狀態全由 WebSocket 推過來（live.js），只有加入、送答案、看作答紀錄才打 API。
// 每輪開始（發題）和結束（收卷）各有一段動畫，播放中點一下畫面就直接跳到結果
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
const answerScene = $("answer");
const resultScene = $("result");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const token = () => localStorage.getItem(PLAYER_KEY);
const sumPoints = (p) => FIELDS.reduce((t, f) => t + p[f], 0);
const myGroup = () => Number(app.dataset.me);

// token 前半段是 base64url 的 {g 組別, n 名字}，只拿來顯示，驗證交給伺服器
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

// 名字、答案是玩家輸入的，一律用 textContent，不能拼 HTML
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

// ===== 動畫排程：run 換號就取消舊的序列；skip() 讓剩下的等待立刻結束 =====
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

// 序列播完：期間又推來的狀態（例如後台改判）這時才套上
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
        // 序列結束（播完或點一下跳過）就停，不然會蓋掉之後推來的新分數
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

// ===== 畫面 =====
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

// 有 YouTube 縮圖就放縮圖，沒有或載不到就放唱片
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

// ===== 作答 =====
let sent = null; // 最後一次成功送出的答案（JSON），按鈕用來判斷「已送出」還是「更新答案」

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

// ===== 本題結果 =====
const rowByGroup = {};
const beforeScores = (scores, gains) =>
    Object.fromEntries(GROUPS.map((g) => [g, Math.max(0, (scores[g] ?? 0) - (gains[g] ?? 0))]));

const cheer = (mine, total) =>
    !mine ? "未作答" : total >= 5 ? "完美！" : total >= 3 ? "漂亮！" : total > 0 ? "有拿分！" : "差一點！";

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

// 這題組內最高分（同分取最先送出）的人先秀名字，再跟「第 N 組」輪流淡入淡出
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
        // 同分同名次
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

// settled = 收卷動畫播完的樣子；false = 動畫開始前（總分還是收卷前的）
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

// ===== 彩帶：四組的四種圖形 =====
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
    // ponytail: 90 片、2.8 秒、一張 canvas；低階手機掉幀再減片數
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

// ===== 每輪開始：轉場 → 第 N 題 → 3、2、1 → 開始作答 =====
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

// ===== 每輪結束：TIME'S UP → 全螢幕對錯 → 解答、我的答案 → 捲到各組總分 → 名次換位 → 戰況 =====
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
    // 這頁比較長：看完自己的分數就往下捲到各組總分
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
    // 跳過、或分頁在背景時數字動畫可能沒跑完，收尾直接寫上最後的分數
    renderTop(s.scores);
    for (const g of GROUPS) rowByGroup[g].querySelector(".b-total").textContent = s.scores[g] ?? 0;
    resultScene.classList.remove("revealing");
    finish(id);
}

// ===== 作答紀錄：個人 / 小組 =====
// 卡片只建一次；切換時只換有變的文字和數字，小組才有的部分用收合動畫（CSS 看 #sheet 的 data-view）
let historyView = "mine";
let historyData = null; // 上次載入的紀錄：再打開時先秀這份，背景重抓有變才重畫
let historyJson = "";
let historyCards = [];
let historySeq = 0;

const teamText = (f, pts) => (pts === 0 ? "沒人答對" : f !== "year" ? "答對" : pts === 3 ? "猜中年份" : "差 3 年內");

// 目前檢視要顯示的總分和三列 [文字, 分數]
function viewOf(h) {
    if (historyView === "team") {
        return { total: h.groups[myGroup()] ?? 0, rows: FIELDS.map((f) => [teamText(f, h.team.points[f]), h.team.points[f]]) };
    }
    const m = h.mine;
    return {
        total: m ? sumPoints(m.points) : 0,
        rows: FIELDS.map((f) => (m ? [String(m[f] ?? "") || "—", m.points[f]] : ["未作答", 0])),
    };
}

// 換內容：數字變大往上滑、變小往下滑，文字一律往上；內容一樣就不動
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

// 一題一張卡，上半跟「本題結果」的解答卡一樣
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
    // 小組才有：組內最高分的人、各組這題得分
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
        return list.replaceChildren(el("p", "h-empty", "還沒有收卷的題目"));
    }
    const built = historyData.map(historyCard);
    historyCards = built.map((b) => b.card);
    list.replaceChildren(...built.map((b) => b.node));
}

async function loadHistory() {
    const seq = ++historySeq;
    try {
        const { status, data } = await api("/api/play/history", { token: token() });
        // 已經有更新的請求，或等回應時已經關掉
        if (seq !== historySeq || sheet.hidden) return;
        if (status === 401) return leave();
        const json = JSON.stringify(data.history ?? []);
        if (json === historyJson) return; // 沒變就不重畫，畫面不跳
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
    $("sheet_close").focus();
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

// ===== 伺服器推來的狀態 → 畫面 =====
let latest = null; // 最近一次推來的狀態；動畫播放中先存著，播完再套上
let shownKey; // 畫面上是哪一題、作答中還是收卷（"none"、"3:true"、"3:false"），變了才換畫面
let shownJson = ""; // 畫面上那份狀態，一模一樣就不重畫

function sync(s) {
    const json = JSON.stringify(s);
    if (json === shownJson) return;
    shownJson = json;
    app.dataset.me = s.group;
    const key = s.round ? `${s.round.no}:${s.round.open}` : "none";
    const from = shownKey;
    shownKey = key;
    setRoundNo(s.round?.no);
    if (!sheet.hidden) void loadHistory(); // 改判、改歌單時紀錄也要跟著變

    if (s.round?.open) {
        renderTop(s.scores);
        if (key === from) return; // 同一題還在作答：只更新總分，不動正在打的字
        fillAnswer(s.answer);
        // 剛打開頁面就停在作答畫面；看著它發題才播開場動畫
        if (from === undefined) return setScene("answer");
        return void playIntro();
    }
    if (s.result) {
        // 看著它收卷才播結算動畫；之後改判、重整都直接顯示結果
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
        // token 失效（過期、換了密鑰）：伺服器把連線降成只收總分，請玩家重新加入
        if (msg.rejoin && token()) return leave();
        if (!token()) renderTop(msg.scores);
        return;
    }
    latest = msg;
    if (!playing) sync(msg);
}

// ===== 加入 / 登出 =====
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
    setScene("lobby"); // 等第一份狀態推過來再決定停在哪
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
    localStorage.removeItem("ntust_camp_player_label"); // 舊版存的顯示名稱
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
        // 剛好收卷就不跳 alert：結算動畫會跟著推過來，alert 會把動畫卡住
        if (data.status !== 1) return latest?.round?.open ? alert(data.msg) : undefined;
        sent = JSON.stringify(answer);
        markSent();
    } catch {
        alert("網路錯誤，請再試一次");
    } finally {
        btn.disabled = false;
    }
}

// ===== 連線狀態：切網路、手機睡醒常常一兩秒就連回來，晚一點才顯示，避免一直閃 =====
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

// 網址帶 ?code=1111 時預先填好組別代碼（可用 QR code 發給各組）
const presetCode = new URLSearchParams(location.search).get("code");
if (presetCode) $("group_code").value = presetCode;

try {
    setView(localStorage.getItem(VIEW_KEY) === "team" ? "team" : "mine");
} catch {}
if (token()) showMe();
const socket = live(onMessage, token, onStatus);
