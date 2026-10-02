// The host view: the answer key of the selected song, round controls and each group's result.
// It draws from the state quiz.js loads ("state" events). $, el, icon, toast and adminApi come from /js/admin.js;
// FIELDS and refreshQuiz from /js/quiz.js; refreshScores from /js/scores.js.

// Latest admin state, used by the buttons.
let hostState = null;

// The first accepted spelling is shown large, the others below it.
function hostKey(id, [main, ...alts]) {
    $(id).replaceChildren(main);
    if (alts.length) $(id).append(el("small", null, alts.join("、")));
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

document.addEventListener("state", ({ detail: state }) => {
    hostState = state;
    const { songs, round, songId, answers, awarded } = state;
    const song = songs[songId];
    const open = Boolean(round?.open);

    if (song) $("host_title").replaceChildren("第 ", el("b", null, String(songId + 1)), " 首");
    else $("host_title").textContent = songs.length ? "尚未選歌" : "還沒有歌單";

    if (song) {
        hostKey("host_year", [String(song.year)]);
        hostKey("host_artist", song.artist);
        hostKey("host_song", song.title);
    } else {
        for (const id of ["host_year", "host_artist", "host_song"]) $(id).textContent = "—";
    }

    $("host_results").hidden = !song;
    if (song) $("host_results").replaceChildren(...GROUPS.map((g) => teamCard(g, answers, awarded)));

    $("host_open_btn").disabled = !song || open;
    $("host_close_btn").disabled = !open;
});

// Hiding blurs the answer key, for when this screen is projected; entering the view always hides it.
function setHidden(hidden) {
    $("host_key").classList.toggle("masked", hidden);
    $("mask_btn").querySelector("use").setAttribute("href", hidden ? "#ic-eye" : "#ic-eye-off");
    $("mask_btn").querySelector("span").textContent = hidden ? "顯示答案" : "隱藏答案";
}

$("mask_btn").addEventListener("click", () => setHidden(!$("host_key").classList.contains("masked")));

document.addEventListener("view", ({ detail: view }) => {
    if (view === "host") setHidden(true);
});

$("host_open_btn").addEventListener("click", async () => {
    if (hostState?.songId == null) return;
    if (await adminApi("open", { songId: hostState.songId })) {
        toast(`第 ${hostState.songId + 1} 首開始作答`, "ok");
        void refreshQuiz();
    }
});

$("host_close_btn").addEventListener("click", async () => {
    if (await adminApi("close")) {
        toast("已收卷並計分", "ok");
        void refreshScores();
        void refreshQuiz();
    }
});
