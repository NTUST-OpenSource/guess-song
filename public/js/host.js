// /host: the answer key of the song selected in the dashboard, round controls and each group's result.
// $, el, icon, toast, adminApi and the saved state come from /js/admin.js; refreshScores from /js/scores.js.
const FIELDS = ["year", "artist", "title"];

// Latest admin state, used by the buttons.
let current = null;

// The first accepted spelling is shown large, the others below it.
function showKey(id, values) {
    const [main, ...alts] = values;
    $(id).replaceChildren(main);
    if (alts.length) $(id).append(el("small", null, `也接受：${alts.join("、")}`));
}

const total = (points) => FIELDS.reduce((t, f) => t + points[f], 0);

// The group's top scorer for the round, as on the player's result board: most points, ties to the earliest answer.
function topScorer(answers, g) {
    const best = answers
        .filter((a) => a.group === g)
        .sort((x, y) => total(y.points) - total(x.points) || x.at - y.at)[0];
    return best && total(best.points) > 0 ? best.name : null;
}

// A group's card: its answer count in the corner; once the round closes, its points and top scorer.
// Groups without points stay tinted, so the scoring groups stand out.
function teamCard(g, answers, awarded) {
    const points = awarded?.[g] ?? 0;
    const card = el("div", points ? "result" : "result quiet");
    card.dataset.g = g;
    const pts = el("p", "result-pts");
    pts.append(icon(`sh${g}`, "shape"), el("span", "sr", `第 ${g} 組`), awarded ? `+${points}` : "—");
    const who = el("p", "result-who", awarded ? (topScorer(answers, g) ?? "—") : "");
    const count = el("span", "result-count", `${answers.filter((a) => a.group === g).length} 人`);
    card.append(pts, who, count);
    return card;
}

function render(state) {
    current = state;
    const { songs, round, songId, answers, awarded } = state;
    const song = songs[songId];
    const open = Boolean(round?.open);

    if (song) $("host_title").replaceChildren("第 ", el("b", null, String(songId + 1)), " 首");
    else $("host_title").textContent = songs.length ? "尚未選歌" : "還沒有歌單";

    if (song) {
        showKey("key_year", [String(song.year)]);
        showKey("key_artist", song.artist);
        showKey("key_title", song.title);
    } else {
        for (const id of ["key_year", "key_artist", "key_title"]) $(id).textContent = "—";
    }

    $("host_results").hidden = !song;
    if (song) $("host_results").replaceChildren(...GROUPS.map((g) => teamCard(g, answers, awarded)));

    $("open_btn").disabled = !song || open;
    $("close_btn").disabled = !open;
}

async function refresh(quiet = true) {
    const state = await adminApi("state", {}, quiet);
    if (!state) return;
    saveState(state);
    render(state);
}

// Hiding blurs the answer key, for when this screen is projected; every visit starts hidden.
function setHidden(hidden) {
    $("host_key").classList.toggle("masked", hidden);
    $("mask_btn").querySelector("use").setAttribute("href", hidden ? "#ic-eye" : "#ic-eye-off");
    $("mask_btn").querySelector("span").textContent = hidden ? "顯示答案" : "隱藏答案";
}

$("mask_btn").addEventListener("click", () => setHidden(!$("host_key").classList.contains("masked")));

$("open_btn").addEventListener("click", async () => {
    if (current?.songId == null) return;
    if (await adminApi("open", { songId: current.songId })) {
        toast(`第 ${current.songId + 1} 首開始作答`, "ok");
        void refresh(false);
    }
});

$("close_btn").addEventListener("click", async () => {
    if (await adminApi("close")) {
        toast("已收卷並計分", "ok");
        void refreshScores();
        void refresh(false);
    }
});

// Refetch when scores.js reports a push, batching bursts into one request.
let liveTimer = 0;
document.addEventListener("live", () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void refresh(), 200);
});

setHidden(true);
// Draw the last known state at once, then refresh it.
const cached = savedState();
if (cached) render(cached);
void refresh();
