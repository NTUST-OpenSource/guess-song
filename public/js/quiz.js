// Loaded after dashboard.js; TOKEN_KEY, logout and refreshScores come from the earlier scripts.
const FIELD_NAMES = { year: "年份", artist: "歌手", title: "歌名" };
const $ = (id) => document.getElementById(id);

// Fill the song list and codes only on first load so refreshes do not overwrite edits.
let loaded = false;

// quiet: background refreshes fail without an alert.
async function adminApi(action, payload = {}, quiet = false) {
    try {
        const res = await fetch(`/api/admin/${action}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: localStorage.getItem(TOKEN_KEY), ...payload }),
        });
        if (res.status === 401) return logout();
        const data = await res.json();
        if (data.status === 1) return data;
        if (!quiet) alert(data.msg);
    } catch {
        if (!quiet) alert("網路錯誤，請再試一次");
    }
    return null;
}

const selectedSong = () => ($("quiz_song").value === "" ? undefined : Number($("quiz_song").value));

// Names are user input: always use textContent, never HTML.
function cell(content) {
    const td = document.createElement("td");
    if (content instanceof Node) td.append(content);
    else td.textContent = content;
    return td;
}

// Each click cycles the points (year 3 -> 1 -> 0, others 1 -> 0); returning to the automatic grade clears the override.
const FIELD_POINTS = { year: [3, 1, 0], artist: [1, 0], title: [1, 0] };

function judgeButton(songId, a, field) {
    const btn = document.createElement("button");
    const pts = a.points[field];
    const overridden = field in a.override;
    const value = field === "year" ? (a.year ?? "") : a[field];
    const options = FIELD_POINTS[field];
    const next = options[(options.indexOf(pts) + 1) % options.length];
    btn.className = `judge-btn ${pts > 0 ? "correct" : "wrong"}${overridden ? " overridden" : ""}`;
    btn.textContent = `+${pts} ${value || "—"}`;
    btn.title = overridden ? "人工改判過，點到回自動批改的分數就是還原" : "點一下改判";
    btn.addEventListener("click", async () => {
        const res = await adminApi("judge", {
            songId,
            player: a.player,
            field,
            value: next === a.auto[field] ? null : next,
        });
        if (res) {
            void refreshScores();
            void refreshQuiz();
        }
    });
    return btn;
}

function render(state) {
    const { songs, round, groupPw, songId, answers, awarded } = state;

    // Rebuild the options only when the list changes, so an open menu is not interrupted.
    const select = $("quiz_song");
    const labels = songs.map((s, i) => `第 ${i + 1} 首｜${s.title[0]}`);
    if ([...select.options].map((o) => o.text).join("\n") !== labels.join("\n")) {
        const keep = selectedSong() ?? songId ?? 0;
        select.replaceChildren(...labels.map((label, i) => new Option(label, String(i))));
        if (songs.length) select.value = String(Math.min(keep, songs.length - 1));
        // Nothing selected yet (a fresh list): sync the default first song to /host.
        if (songs.length && songId === null) void adminApi("select", { songId: selectedSong() }, true);
    }

    // Link to the video, or search YouTube for "title artist" when there is none.
    const picked = songs[selectedSong()];
    const link = $("youtube_link");
    link.hidden = !picked;
    if (picked) {
        const query = encodeURIComponent(`${picked.title[0]} ${picked.artist[0]}`);
        link.href = picked.youtube ?? `https://www.youtube.com/results?search_query=${query}`;
        link.textContent = picked.youtube ? "在 YouTube 播放" : "在 YouTube 搜尋這首";
    }

    $("quiz_status").textContent = round
        ? `目前：第 ${round.songId + 1} 首 ${round.open ? "作答中" : "已收卷"}`
        : "尚未發題";

    const song = songs[songId];
    $("answer_key").textContent = song
        ? `第 ${songId + 1} 首解答：${song.year}／${song.artist.join("、")}／${song.title.join("、")}`
        : "還沒有歌單";
    $("answer_summary").textContent = song
        ? `${answers.length} 人作答；` +
          (awarded
              ? `本題得分 ${Object.entries(awarded)
                    .map(([g, p]) => `${g}組+${p}`)
                    .join(" ")}`
              : "收卷後計分")
        : "";

    const sorted = [...answers].sort((a, b) => a.group - b.group || a.name.localeCompare(b.name));
    $("answer_rows").replaceChildren(
        ...sorted.map((a) => {
            const tr = document.createElement("tr");
            tr.append(
                cell(String(a.group)),
                cell(a.name),
                ...Object.keys(FIELD_NAMES).map((f) => cell(judgeButton(songId, a, f))),
            );
            return tr;
        }),
    );

    if (!loaded) {
        loaded = true;
        $("songs_json").value = JSON.stringify(songs, null, 2);
        for (let g = 1; g <= 4; g++) $(`pw_${g}`).value = groupPw[g] ?? "";
    }
}

async function refreshQuiz(quiet = false) {
    const state = await adminApi("state", { songId: selectedSong() }, quiet);
    if (state) render(state);
}

// Group code inputs.
$("group_passwords").replaceChildren(
    ...Array.from({ length: 4 }, (_, i) => {
        const label = document.createElement("label");
        label.htmlFor = `pw_${i + 1}`;
        label.textContent = `第 ${i + 1} 組`;
        const input = document.createElement("input");
        input.id = `pw_${i + 1}`;
        input.type = "text";
        input.autocomplete = "off";
        return [label, input];
    }).flat(),
);

// Selecting a song shows its answer key on /host.
$("quiz_song").addEventListener("change", async () => {
    await adminApi("select", { songId: selectedSong() });
    void refreshQuiz();
});

$("open_btn").addEventListener("click", async () => {
    if (await adminApi("open", { songId: selectedSong() })) void refreshQuiz();
});

$("close_btn").addEventListener("click", async () => {
    if (await adminApi("close")) {
        void refreshScores();
        void refreshQuiz();
    }
});

$("save_pw_btn").addEventListener("click", async () => {
    const passwords = Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [i + 1, $(`pw_${i + 1}`).value.trim()]),
    );
    if (await adminApi("passwords", { passwords })) alert("代碼已儲存");
});

$("songs_file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) $("songs_json").value = await file.text();
});

$("save_songs_btn").addEventListener("click", async () => {
    let songs;
    try {
        songs = JSON.parse($("songs_json").value);
    } catch {
        return alert("JSON 格式錯誤");
    }
    if (await adminApi("songs", { songs })) {
        alert("歌單已儲存");
        void refreshScores();
        void refreshQuiz();
    }
});

$("reset_btn").addEventListener("click", async () => {
    const ok = confirm(
        "確定要重置嗎？\n\n會清空：四組分數、歌單與解答、組別代碼、所有作答紀錄。\n這個動作無法復原。",
    );
    if (!ok || !(await adminApi("reset"))) return;
    // Clear the song list and code inputs too.
    loaded = false;
    void refreshScores();
    void refreshQuiz();
    alert("已重置");
});

// Refetch when scores.js reports a push, batching bursts of answers into one request.
let liveTimer = 0;
document.addEventListener("live", () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void refreshQuiz(true), 300);
});

void refreshQuiz();
