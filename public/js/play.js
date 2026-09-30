// defer 載入，DOM 已就緒
const PLAYER_KEY = "ntust_camp_player";
const PLAYER_LABEL_KEY = "ntust_camp_player_label";
const FIELD_NAMES = { year: "年份", artist: "歌手", title: "歌名" };
const $ = (id) => document.getElementById(id);

let shownRound; // 目前畫面顯示的「題號:是否作答中」，變了才重畫，避免輪詢蓋掉正在打的字
let shownHistory; // 目前畫面上歷史的版本（histRev），變了才重抓
let myGroup = null;
// 只畫最後一次送出的請求；網路慢時舊的回應晚到，直接丟掉，不能蓋掉新的畫面
let stateSeq = 0;
let historySeq = 0;

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

function renderScores(scores, group) {
    for (let g = 1; g <= 4; g++) {
        $(`score_${g}`).textContent = scores?.[g] ?? 0;
        $(`cell_${g}`).classList.toggle("mine", g === group);
    }
}

function showJoin() {
    $("join_view").hidden = false;
    $("play_view").hidden = true;
    $("history").hidden = true;
    $("marquee").hidden = true;
    myGroup = null;
    void refresh();
}

function showPlay() {
    $("join_view").hidden = true;
    $("play_view").hidden = false;
    $("player_label").textContent = localStorage.getItem(PLAYER_LABEL_KEY) ?? "";
    shownRound = undefined;
    shownHistory = undefined;
    void refresh();
}

function leave() {
    localStorage.removeItem(PLAYER_KEY);
    localStorage.removeItem(PLAYER_LABEL_KEY);
    showJoin();
}

const summary = (a) =>
    a ? `已送出：${a.year ?? "—"}／${a.artist || "—"}／${a.title || "—"}` : "尚未作答";

async function join() {
    const name = $("player_name").value.trim();
    try {
        const { data } = await api("/api/join", { name, code: $("group_code").value });
        if (data.status !== 1) return alert(data.msg);
        localStorage.setItem(PLAYER_KEY, data.token);
        localStorage.setItem(PLAYER_LABEL_KEY, `第 ${data.group} 組・${name}`);
        showPlay();
    } catch {
        alert("網路錯誤，請再試一次");
    }
}

// 每組一則：該組這首個人得分最高的人
const marqueeText = (highlights) =>
    highlights
        .map((h) =>
            h.name
                ? `組${h.group} ${h.name} [${h.fields.map((f) => FIELD_NAMES[f]).join(" + ")}] 正確得 ${h.points} 分`
                : `組${h.group} 這首沒有人答對`,
        )
        .join("　　　");

// 收卷後才有 highlights；文字沒變就不重設，避免動畫一直從頭跑
function renderMarquee(highlights) {
    // 舊版存的是 {first, streaks} 物件，不是陣列就當作沒有，避免整個畫面更新失敗
    if (!Array.isArray(highlights)) highlights = null;
    $("marquee").hidden = !highlights;
    if (!highlights) return;
    const text = marqueeText(highlights);
    const span = $("marquee_text");
    if (span.textContent === text) return;
    span.textContent = text;
    span.style.animationDuration = `${Math.max(10, text.length * 0.35)}s`;
}

function historyRow(label, parts) {
    const row = el("div", "history-row");
    row.append(el("span", "tag", label), ...parts);
    return row;
}

// 一題一張卡：左上角題號（疊在縮圖上）、解答、自己的答案（有分綠色、沒分紅色）、各組這題得分
function historyItem(h) {
    const item = el("article", "history-item");
    const no = el("span", "round-no", String(h.no));
    const body = el("div", "history-body");
    if (h.thumb) {
        const media = el("div", "history-media");
        const img = el("img", "history-thumb");
        img.src = h.thumb;
        img.alt = "";
        img.loading = "lazy";
        // 縮圖載不到就當作沒有縮圖，題號移回文字上面
        img.addEventListener("error", () => {
            media.remove();
            body.prepend(no);
            item.classList.add("no-thumb");
        });
        media.append(img, no);
        item.append(media);
    } else {
        body.append(no);
        item.classList.add("no-thumb");
    }

    // 各項中間用「／」隔開，名字裡有空白（Jay Chou）也不會黏在一起
    const mine = h.mine
        ? Object.keys(FIELD_NAMES).flatMap((f, i) => {
              const value = f === "year" ? (h.mine.year ?? "") : h.mine[f];
              const part = el("span", h.mine.points[f] > 0 ? "hit" : "miss", `${value || "—"} +${h.mine.points[f]}`);
              return i ? [el("span", "sep", "／"), part] : [part];
          })
        : [el("span", "miss", "未作答")];

    body.append(
        historyRow("解答", [el("span", "key", `${h.year}／${h.artist}／${h.title}`)]),
        historyRow("我的", mine),
    );

    const groups = el("div", "history-groups");
    groups.append(
        ...Object.entries(h.groups).map(([g, p]) => el("span", Number(g) === myGroup ? "mine" : "", `${g}組 +${p}`)),
    );

    item.append(body, groups);
    return item;
}

async function loadHistory(rev) {
    shownHistory = rev; // 先記下，避免下一輪輪詢重複抓；失敗就清掉讓下一輪重試
    const seq = ++historySeq;
    const token = localStorage.getItem(PLAYER_KEY);
    try {
        const { status, data } = await api("/api/play/history", { token });
        // 已經有更新的請求，或等回應時已經登出，別把舊的歷史畫回來
        if (seq !== historySeq || token !== localStorage.getItem(PLAYER_KEY)) return;
        if (status === 401) return leave();
        const list = data.history ?? [];
        $("history").hidden = !list.length;
        $("history").replaceChildren(...list.map(historyItem));
    } catch {
        if (seq === historySeq) shownHistory = undefined;
    }
}

function render({ round, answer, highlights, scores, group, histRev }) {
    myGroup = group;
    renderScores(scores, group);
    renderMarquee(highlights);
    if (histRev !== shownHistory) void loadHistory(histRev);

    const key = round ? `${round.no}:${round.open}` : "none";
    if (key === shownRound) return;
    shownRound = key;

    // 題號縮成左上角的小數字；作答中看得到表單、收卷後看得到解答，就不再寫狀態文字
    $("round_no").hidden = !round?.open;
    $("round_no").textContent = round?.open ? round.no : "";
    $("round_status").hidden = Boolean(round); // 只有還沒發過題時顯示「等待發題…」
    $("answer_form").hidden = !round?.open;
    $("ans_year").value = answer?.year ?? "";
    $("ans_artist").value = answer?.artist ?? "";
    $("ans_title").value = answer?.title ?? "";
    $("submitted").textContent = summary(answer);
}

// 還沒加入就只抓總分；加入後總分跟著作答狀態一起回來
async function refresh() {
    if (document.hidden) return;
    const seq = ++stateSeq;
    const token = localStorage.getItem(PLAYER_KEY);
    try {
        if (!token) {
            const scores = await (await fetch("/api/GetScore")).json();
            if (seq === stateSeq) renderScores(scores, null);
            return;
        }
        const { status, data } = await api("/api/play/state", { token });
        // 已經有更新的請求，或等回應時已經登出
        if (seq !== stateSeq || token !== localStorage.getItem(PLAYER_KEY)) return;
        if (status === 401) return leave();
        render(data);
    } catch {
        // ponytail: 輪詢失敗就等下一輪重試
    }
}

async function submitAnswer() {
    const year = $("ans_year").valueAsNumber;
    const answer = {
        year: Number.isNaN(year) ? null : year,
        artist: $("ans_artist").value,
        title: $("ans_title").value,
    };
    try {
        const { status, data } = await api("/api/play/answer", {
            token: localStorage.getItem(PLAYER_KEY),
            ...answer,
        });
        if (status === 401) return leave();
        if (data.status !== 1) {
            alert(data.msg);
            shownRound = undefined; // 可能已收卷，強制重畫
            return refresh();
        }
        $("submitted").textContent = summary({ ...answer, artist: answer.artist.trim(), title: answer.title.trim() });
    } catch {
        alert("網路錯誤，請再試一次");
    }
}

$("join_btn").addEventListener("click", () => void join());
$("group_code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void join();
});
$("answer_btn").addEventListener("click", () => void submitAnswer());
$("leave_btn").addEventListener("click", leave);
document.addEventListener("visibilitychange", () => void refresh());

// ponytail: 50 多人每 3 秒輪詢一次（總分也在同一個回應裡）；切到背景就不打 API
setInterval(() => void refresh(), 3000);

// 網址帶 ?code=1111 時預先填好組別代碼（可用 QR code 發給各組）
const presetCode = new URLSearchParams(location.search).get("code");
if (presetCode) $("group_code").value = presetCode;

if (localStorage.getItem(PLAYER_KEY)) showPlay();
else showJoin();
