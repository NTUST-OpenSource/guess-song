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

// Typed scores save on change, so Enter or leaving the box saves: phone number pads have no Enter key.
// Escape leaves without saving. change fires before blur, so blur sees the cancel and a save in flight.
for (const box of document.querySelectorAll(".score-in")) {
    let cancelled = false;
    box.addEventListener("keydown", (e) => {
        if (e.key === "Escape") cancelled = true;
        if (e.key === "Escape" || e.key === "Enter") box.blur();
    });
    box.addEventListener("change", async () => {
        if (cancelled) return;
        const group = Number(box.dataset.score);
        const score = box.valueAsNumber;
        if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
            return toast(`分數要是 0–${MAX_SCORE} 的整數`, "bad");
        }
        box.dataset.pending = String(Number(box.dataset.pending ?? 0) + 1);
        if (await send("/api/SetScore", { group, score })) toast(`第 ${group} 組改成 ${score} 分`, "ok");
        box.dataset.pending = String(Number(box.dataset.pending) - 1);
        void refreshScores();
    });
    // Restores the server value and skipped pushes; a save in flight refetches when it finishes instead.
    box.addEventListener("blur", () => {
        cancelled = false;
        if (!(Number(box.dataset.pending) > 0)) void refreshScores();
    });
}
