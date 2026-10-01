// Shared by /scoreboard, the dashboard and /host: renders the four totals pushed over WebSocket.
function renderScores(data) {
    for (let i = 1; i <= 4; i++) {
        const box = document.querySelector(`#t${i} .score-box`);
        // Skip a box the admin is editing or whose arrow update is in flight; read-only boxes always update.
        if (!box.readOnly && (box === document.activeElement || Number(box.dataset.pending) > 0)) continue;
        box.value = data[i];
    }
}

// Fetch once after an action or a cancelled edit to restore skipped boxes.
async function refreshScores() {
    try {
        renderScores(await (await fetch("/api/GetScore")).json());
    } catch {
        // The next push updates the totals.
    }
}

// Every server change arrives here; admin pages listen for "live" and refetch their state.
live((msg) => {
    if (msg.type !== "scores") return;
    renderScores(msg.scores);
    document.dispatchEvent(new CustomEvent("live"));
});
