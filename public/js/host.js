// /host: the answer key of the song selected in the dashboard, round controls and each group's result.
// $, el, icon, toast, adminApi and groupCounts come from /js/admin.js; refreshScores from /js/scores.js.
const HIDE_KEY = "host_hide_answers";
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

function result(g, points, name) {
    const box = el("div", points ? "result" : "result zero");
    box.dataset.g = g;
    const pts = el("p", "result-pts");
    pts.append(icon(`sh${g}`, "shape"), el("span", "sr", `第 ${g} 組`), `+${points}`);
    const who = el("p", "result-who");
    if (name) who.append(icon("ic-crown"), el("span", null, name));
    else who.append(el("span", null, "—"));
    box.append(pts, who);
    return box;
}

function render(state) {
    current = state;
    const { songs, round, songId, answers, awarded } = state;
    const song = songs[songId];
    const open = Boolean(round?.open);

    if (song) $("host_title").replaceChildren("第 ", el("b", null, String(songId + 1)), " 首");
    else $("host_title").textContent = songs.length ? "尚未選歌" : "還沒有歌單";
    $("host_counts").replaceChildren(...(song ? groupCounts(answers) : []));

    if (song) {
        showKey("key_year", [String(song.year)]);
        showKey("key_artist", song.artist);
        showKey("key_title", song.title);
    } else {
        for (const id of ["key_year", "key_artist", "key_title"]) $(id).textContent = "—";
    }

    $("host_results").hidden = !(song && awarded);
    if (song && awarded) {
        $("host_results").replaceChildren(...GROUPS.map((g) => result(g, awarded[g] ?? 0, topScorer(answers, g))));
    }

    $("open_btn").disabled = !song || open;
    $("close_btn").disabled = !open;
}

async function refresh(quiet = true) {
    const state = await adminApi("state", {}, quiet);
    if (state) render(state);
}

// Hiding blurs the answer key, for when this screen is projected; the choice is remembered on this device.
function setHidden(hidden) {
    $("host_key").classList.toggle("masked", hidden);
    $("mask_btn").querySelector("use").setAttribute("href", hidden ? "#ic-eye" : "#ic-eye-off");
    $("mask_btn").querySelector("span").textContent = hidden ? "顯示答案" : "隱藏答案";
    localStorage.setItem(HIDE_KEY, hidden ? "1" : "");
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

setHidden(localStorage.getItem(HIDE_KEY) === "1");
void refresh();
