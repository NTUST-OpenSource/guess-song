// Shared by /scoreboard, the dashboard and /host: renders the four totals pushed over WebSocket.
// An element with data-score="<group>" shows that group's total. Loaded after the page scripts, so their
// listeners hear the first totals.
let shownScores = null;

function renderScores(data) {
    for (const el of document.querySelectorAll("[data-score]")) {
        const value = data[el.dataset.score];
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
            // Skip a box the admin is editing or whose arrow update is in flight; read-only boxes always update.
            if (!el.readOnly && (el === document.activeElement || Number(el.dataset.pending) > 0)) continue;
            el.value = value;
        } else {
            el.textContent = value;
        }
    }
    const prev = shownScores;
    shownScores = data;
    try {
        sessionStorage.setItem("scores", JSON.stringify(data));
    } catch {
        // Without storage the next page waits for the socket instead.
    }
    // Pages animate changes from here: +N pops, the scoreboard's counting and reordering.
    document.dispatchEvent(new CustomEvent("scores", { detail: { scores: data, prev } }));
}

// Fetch once after an action or a cancelled edit to restore skipped boxes.
async function refreshScores() {
    try {
        renderScores(await (await fetch("/api/GetScore")).json());
    } catch {
        // The next push updates the totals.
    }
}

// The totals last seen in this tab's session show at once; the socket's first message refreshes them.
try {
    const last = JSON.parse(sessionStorage.getItem("scores"));
    if (last) renderScores(last);
} catch {
    // No saved totals: wait for the socket.
}

// Every server change arrives here; admin pages listen for "live" and refetch their state.
// While the socket is down, body.offline shows the reconnecting notice.
live(
    (msg) => {
        if (msg.type !== "scores") return;
        renderScores(msg.scores);
        document.dispatchEvent(new CustomEvent("live"));
    },
    undefined,
    (ok) => document.body.classList.toggle("offline", !ok),
);
