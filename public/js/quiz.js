// Dashboard: the selected song, its answers and grades, and the settings dialog.
// $, el, icon, toast, adminApi, groupCounts and the saved state come from /js/admin.js; refreshScores from /js/scores.js.
const FIELDS = ["year", "artist", "title"];
const FIELD_NAMES = { year: "年份", artist: "歌手", title: "歌名" };
// Each click cycles the points (year 3 -> 1 -> 0, others 1 -> 0); returning to the automatic grade clears the override.
const FIELD_POINTS = { year: [3, 1, 0], artist: [1, 0], title: [1, 0] };

// Fill the song list and codes only on first load so refreshes do not overwrite edits.
let loaded = false;

const selectedSong = () => ($("quiz_song").value === "" ? undefined : Number($("quiz_song").value));

// The video id for the cover, by the same rules as youtubeId in src/index.js.
function youtubeId(link) {
    try {
        const url = new URL(link);
        const host = url.hostname.replace(/^(www|m|music)\./, "");
        const id =
            host === "youtu.be"
                ? url.pathname.slice(1)
                : ["youtube.com", "youtube-nocookie.com"].includes(host)
                  ? (url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1])
                  : null;
        return /^[\w-]{11}$/.test(id ?? "") ? id : null;
    } catch {
        return null;
    }
}

// The YouTube thumbnail when there is one, otherwise or on error a record, as on the player's cards.
// Refreshes keep the current image instead of loading it again.
let coverOf = null;
function setCover(no, song) {
    const video = song ? youtubeId(song.youtube) : null;
    if (coverOf === `${no}:${video}`) return;
    coverOf = `${no}:${video}`;
    const box = $("round_cover");
    box.style.setProperty("--c1", `var(--g${(no % 4) + 1})`);
    box.style.setProperty("--c2", `var(--g${((no + 2) % 4) + 1})`);
    const disc = el("span", "disc");
    if (!video) return box.replaceChildren(disc);
    const img = document.createElement("img");
    img.src = `https://i.ytimg.com/vi/${video}/hqdefault.jpg`;
    img.alt = "";
    img.addEventListener("error", () => img.replaceWith(disc));
    box.replaceChildren(img);
}

function showStatus({ round, songId, awarded }) {
    const [cls, label] =
        round?.songId === songId
            ? round.open
                ? ["open", "作答中"]
                : ["closed", "已收卷"]
            : round?.open
              ? ["warn", `第 ${round.songId + 1} 首作答中`]
              : awarded
                ? ["closed", "已收卷"]
                : ["", "未發題"];
    const pill = $("round_status");
    pill.className = `status ${cls}`;
    pill.replaceChildren(label);
    if (cls === "open") {
        const eq = el("span", "eq");
        eq.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 3; i++) {
            const bar = el("i");
            bar.style.setProperty("--i", i);
            eq.append(bar);
        }
        pill.prepend(eq);
    }
}

// The first accepted spelling, then the others in small print.
function showKey(id, [main, ...alts]) {
    $(id).replaceChildren(main);
    if (alts.length) $(id).append(el("small", null, `也接受：${alts.join("、")}`));
}

function judgeButton(songId, a, field) {
    const pts = a.points[field];
    const overridden = field in a.override;
    const value = String(field === "year" ? (a.year ?? "") : a[field]) || "—";
    const options = FIELD_POINTS[field];
    const next = options[(options.indexOf(pts) + 1) % options.length];
    const btn = el("button", overridden ? "judge over" : "judge");
    btn.type = "button";
    btn.dataset.pts = pts;
    btn.title = overridden ? "人工改判過，點到原本的分數就是還原" : "點一下改判";
    btn.setAttribute("aria-label", `${FIELD_NAMES[field]} ${value}，+${pts}${overridden ? "（人工改判）" : ""}`);
    btn.append(el("span", "v", value), el("b", "p", `+${pts}`));
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

// Names are user input: always textContent, never HTML.
function answerRow(songId, a) {
    const chip = el("span", "gchip");
    chip.dataset.g = a.group;
    chip.append(icon(`sh${a.group}`, "shape"), el("span", "sr", `第 ${a.group} 組`));
    const name = el("span", null, a.name);
    name.title = a.name;
    const inner = el("span", "who-in");
    inner.append(chip, name);
    const who = el("td", "who");
    who.append(inner);
    const tr = el("tr");
    tr.append(
        who,
        ...FIELDS.map((f) => {
            const td = el("td");
            td.dataset.label = FIELD_NAMES[f];
            td.append(judgeButton(songId, a, f));
            return td;
        }),
    );
    return tr;
}

// fresh: the state just came from the server, not from the session cache.
function render(state, fresh = true) {
    const { songs, round, songId, answers, awarded } = state;

    // Rebuild the options only when the list changes, so an open menu is not interrupted.
    const select = $("quiz_song");
    const labels = songs.map((s, i) => `${i + 1} | ${s.title[0]}`);
    if ([...select.options].map((o) => o.text).join("\n") !== labels.join("\n")) {
        const keep = selectedSong() ?? songId ?? 0;
        select.replaceChildren(
            ...songs.map((s, i) => {
                const option = new Option("", String(i));
                option.append(el("b", null, String(i + 1)), ` | ${s.title[0]}`);
                return option;
            }),
        );
        if (songs.length) select.value = String(Math.min(keep, songs.length - 1));
        // Nothing selected yet (a fresh list): sync the default first song to /host.
        if (songs.length && songId === null) void adminApi("select", { songId: selectedSong() }, true);
    }
    if (songs[songId]) select.value = String(songId);
    select.disabled = !songs.length;

    const song = songs[songId];
    setCover(songId ?? 0, song);
    $("round_status").hidden = !song;
    if (song) showStatus(state);

    // Link to the video, or search YouTube for "title artist" when there is none.
    $("youtube_link").hidden = !song;
    $("answer_key").hidden = !song;
    if (song) {
        const query = encodeURIComponent(`${song.title[0]} ${song.artist[0]}`);
        $("youtube_link").href = song.youtube ?? `https://www.youtube.com/results?search_query=${query}`;
        $("youtube_text").textContent = song.youtube ? "在 YouTube 播放" : "在 YouTube 搜尋這首";
        showKey("key_year", [String(song.year)]);
        showKey("key_artist", song.artist);
        showKey("key_title", song.title);
    }

    $("open_btn").disabled = !song || Boolean(round?.open);
    $("close_btn").disabled = !round?.open;

    $("ans_total").textContent = song ? `${answers.length} 人作答` : "";
    $("ans_counts").replaceChildren(...(song ? groupCounts(answers) : []));
    $("ans_awards").hidden = !(song && awarded);
    if (song && awarded) {
        $("ans_awards").replaceChildren(
            el("span", "sub", "本題得分"),
            ...GROUPS.map((g) => {
                const chip = el("span", awarded[g] ? "award" : "award zero");
                chip.dataset.g = g;
                chip.append(icon(`sh${g}`, "shape"), el("span", "sr", `第 ${g} 組`), `+${awarded[g] ?? 0}`);
                return chip;
            }),
        );
    }

    const sorted = [...answers].sort((a, b) => a.group - b.group || a.name.localeCompare(b.name));
    $("answer_rows").replaceChildren(...sorted.map((a) => answerRow(songId, a)));
    document.querySelector(".ans").hidden = !sorted.length;
    $("ans_empty").hidden = sorted.length > 0;
    $("ans_empty").textContent = songs.length ? "還沒有人作答" : "還沒有歌單";

    // Only server data fills the settings, so a stale cache never gets saved back.
    if (fresh && !loaded) {
        loaded = true;
        $("songs_json").value = JSON.stringify(songs, null, 2);
        checkSongs();
        for (const g of GROUPS) $(`pw_${g}`).value = state.groupPw[g] ?? "";
    }
}

async function refreshQuiz(quiet = false, songId = selectedSong()) {
    const state = await adminApi("state", { songId }, quiet);
    if (!state) return;
    saveState(state);
    render(state);
}

// Selecting a song shows its answer key on /host.
$("quiz_song").addEventListener("change", async () => {
    await adminApi("select", { songId: selectedSong() });
    void refreshQuiz();
});

$("open_btn").addEventListener("click", async () => {
    const songId = selectedSong();
    if (await adminApi("open", { songId })) {
        toast(`第 ${songId + 1} 首開始作答`, "ok");
        void refreshQuiz();
    }
});

$("close_btn").addEventListener("click", async () => {
    if (await adminApi("close")) {
        toast("已收卷並計分", "ok");
        void refreshScores();
        void refreshQuiz();
    }
});

// ===== Settings =====

// A click on the backdrop lands on the dialog itself, outside its box; keyboard clicks land on buttons.
for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (e) => {
        const r = dialog.getBoundingClientRect();
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if ((e.target === dialog && outside) || e.target.closest("[data-close]")) dialog.close();
    });
}

$("settings_btn").addEventListener("click", () => $("settings").showModal());

// Tabs: click or arrow keys.
const tabs = [...document.querySelectorAll("#settings [role=tab]")];
function selectTab(tab) {
    for (const t of tabs) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        $(t.getAttribute("aria-controls")).hidden = !on;
    }
}
for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
        selectTab(next);
        next.focus();
    });
}

// Group code inputs.
$("group_passwords").replaceChildren(
    ...GROUPS.flatMap((g) => {
        const chip = el("span", "gchip");
        chip.append(icon(`sh${g}`, "shape"));
        const label = el("label");
        label.htmlFor = `pw_${g}`;
        label.dataset.g = g;
        label.append(chip, `第 ${g} 組`);
        const input = el("input", "input");
        input.id = `pw_${g}`;
        input.autocomplete = "off";
        input.autocapitalize = "off";
        input.spellcheck = false;
        return [label, input];
    }),
);

$("save_pw_btn").addEventListener("click", async () => {
    const passwords = Object.fromEntries(GROUPS.map((g) => [g, $(`pw_${g}`).value.trim()]));
    if (await adminApi("passwords", { passwords })) toast("組別代碼已儲存", "ok");
});

// The line of a JSON syntax error, from the browser's message when it gives one.
function errorLine(text, message) {
    const line = /line (\d+)/.exec(message);
    if (line) return Number(line[1]);
    const at = /position (\d+)/.exec(message);
    return at ? text.slice(0, Number(at[1])).split("\n").length : null;
}

const filled = (v) => (Array.isArray(v) ? v : [v]).some((s) => typeof s === "string" && s.trim() !== "");
const isLink = (v) => v === undefined || (typeof v === "string" && /^https?:\/\//i.test(v.trim()));

// Checks the list while it is edited, with the same rules as the server, which checks it again on save.
function checkSongs() {
    const text = $("songs_json").value;
    let problem = null;
    let count = 0;
    try {
        const list = JSON.parse(text);
        if (!Array.isArray(list)) {
            problem = "最外層要是陣列 [ ]";
        } else {
            count = list.length;
            const bad = list.findIndex(
                (s) => !Number.isInteger(s?.year) || !filled(s?.artist) || !filled(s?.title) || !isLink(s?.youtube),
            );
            if (bad >= 0) problem = `第 ${bad + 1} 首格式錯誤`;
        }
    } catch (e) {
        const line = errorLine(text, e.message);
        problem = line ? `第 ${line} 行附近格式錯誤` : "JSON 格式錯誤";
    }
    $("songs_check").className = problem ? "check bad" : "check ok";
    $("songs_check").replaceChildren(icon(problem ? "ic-alert" : "ic-check"), problem ?? `${count} 首，格式正確`);
    $("save_songs_btn").disabled = Boolean(problem);
}

$("songs_json").addEventListener("input", checkSongs);

$("songs_file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $("songs_json").value = await file.text();
    $("file_name").textContent = file.name;
    checkSongs();
});

$("save_songs_btn").addEventListener("click", async () => {
    const songs = JSON.parse($("songs_json").value);
    if (await adminApi("songs", { songs })) {
        toast(`歌單已儲存，共 ${songs.length} 首`, "ok");
        void refreshScores();
        void refreshQuiz();
    }
});

$("reset_btn").addEventListener("click", () => $("reset_dialog").showModal());

$("reset_confirm").addEventListener("click", async () => {
    if (!(await adminApi("reset"))) return;
    $("reset_dialog").close();
    $("settings").close();
    // Clear the song list and code inputs too.
    loaded = false;
    void refreshScores();
    void refreshQuiz();
    toast("已重置所有資料", "ok");
});

// Refetch when scores.js reports a push, batching bursts of answers into one request.
let liveTimer = 0;
document.addEventListener("live", () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void refreshQuiz(true), 300);
});

// Draw the last known state at once, then load the song the server has selected, which /host shows too.
const cached = savedState();
if (cached) render(cached, false);
void refreshQuiz(false, null);
