// Score tiles. send and toast come from /js/admin.js, refreshScores from /js/scores.js.
const MAX_SCORE = 999;

// −/+ update the box first, then send a delta so a concurrent close is not overwritten.
// data-pending keeps pushes from overwriting a box while its update is in flight.
for (const btn of document.querySelectorAll(".step")) {
    btn.addEventListener("click", async () => {
        const group = Number(btn.dataset.group);
        const delta = Number(btn.dataset.delta);
        const box = document.querySelector(`.score-in[data-score="${group}"]`);
        box.value = Math.max(0, Math.min(MAX_SCORE, (Number(box.value) || 0) + delta));
        box.dataset.pending = String(Number(box.dataset.pending ?? 0) + 1);
        await send("/api/AddScore", { group, delta });
        box.dataset.pending = String(Number(box.dataset.pending) - 1);
        void refreshScores();
    });
}

// Typed scores: Enter saves; Escape or leaving the box cancels and restores the server value.
for (const box of document.querySelectorAll(".score-in")) {
    box.addEventListener("keydown", async (e) => {
        if (e.key === "Escape") return box.blur();
        if (e.key !== "Enter") return;
        const group = Number(box.dataset.score);
        const score = box.valueAsNumber;
        if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
            return toast(`分數要是 0–${MAX_SCORE} 的整數`, "bad");
        }
        if (await send("/api/SetScore", { group, score })) toast(`第 ${group} 組改成 ${score} 分`, "ok");
        box.blur();
    });
    box.addEventListener("blur", () => void refreshScores());
}
