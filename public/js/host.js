// /host: shows the answer key of the song selected in the dashboard, and opens or closes rounds.
// Shares the dashboard login token; refreshScores comes from /js/scores.js.
const TOKEN_KEY = "ntust_camp_token";
const $ = (id) => document.getElementById(id);

const toLogin = () => {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login?next=/host";
};

if (!localStorage.getItem(TOKEN_KEY)) toLogin();

// Latest admin state, used by the buttons.
let current = null;

// quiet: background refreshes fail without an alert.
async function adminApi(action, payload = {}, quiet = false) {
    try {
        const res = await fetch(`/api/admin/${action}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: localStorage.getItem(TOKEN_KEY), ...payload }),
        });
        if (res.status === 401) return toLogin();
        const data = await res.json();
        if (data.status === 1) return data;
        if (!quiet) alert(data.msg);
    } catch {
        if (!quiet) alert("網路錯誤，請再試一次");
    }
    return null;
}

// The first accepted spelling is shown large, the others below it.
function showKey(id, values) {
    const [main, ...alts] = values;
    const dd = $(id);
    dd.textContent = main;
    if (alts.length) {
        const alt = document.createElement("span");
        alt.className = "alt";
        alt.textContent = `也接受：${alts.join("、")}`;
        dd.append(alt);
    }
}

function render(state) {
    current = state;
    const { songs, round, songId, answers, awarded } = state;
    const song = songs[songId];
    const isCurrent = round?.songId === songId;
    const open = Boolean(round?.open);

    $("host_title").textContent = song ? `第 ${songId + 1} 首` : songs.length ? "尚未選歌" : "還沒有歌單";
    $("host_status").textContent = !song
        ? ""
        : isCurrent
          ? `${open ? "作答中" : "已收卷"}｜${answers.length} 人作答`
          : open
            ? `還沒發題（第 ${round.songId + 1} 首作答中，請先收卷）`
            : "還沒發題";

    if (song) {
        showKey("key_year", [String(song.year)]);
        showKey("key_artist", song.artist);
        showKey("key_title", song.title);
    } else {
        for (const id of ["key_year", "key_artist", "key_title"]) $(id).textContent = "—";
    }

    $("host_awarded").textContent =
        song && awarded
            ? `本題得分 ${Object.entries(awarded)
                  .map(([g, p]) => `${g}組+${p}`)
                  .join(" ")}`
            : "";

    $("open_btn").disabled = !song || open;
    $("close_btn").disabled = !open;
}

async function refresh(quiet = true) {
    const state = await adminApi("state", {}, quiet);
    if (state) render(state);
}

$("open_btn").addEventListener("click", async () => {
    if (current?.songId == null) return;
    if (await adminApi("open", { songId: current.songId })) void refresh(false);
});

$("close_btn").addEventListener("click", async () => {
    if (await adminApi("close")) {
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

void refresh();
