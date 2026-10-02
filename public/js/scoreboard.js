// /scoreboard: animates the totals that scores.js pushes, in either layout; the layout is remembered on this device.
const LAYOUT_KEY = "scoreboard_layout";
const GROUPS = [1, 2, 3, 4];
const board = document.getElementById("board");
const rows = Object.fromEntries(GROUPS.map((g) => [g, board.querySelector(`.sb-group[data-g="${g}"]`)]));

function setLayout(layout) {
    board.dataset.layout = layout;
    const label = layout === "cols" ? "切換成排名長條" : "切換成固定四格";
    const btn = document.getElementById("layout_btn");
    btn.setAttribute("aria-label", label);
    btn.title = label;
    localStorage.setItem(LAYOUT_KEY, layout);
}

document.getElementById("layout_btn").addEventListener("click", () => {
    const next = board.dataset.layout === "cols" ? "rank" : "cols";
    // The groups morph into the other layout where view transitions are supported.
    if (document.startViewTransition) document.startViewTransition(() => setLayout(next));
    else setLayout(next);
});

// Counts up or down to the new total; a newer total takes over a count in progress.
function countTo(el, to) {
    const from = Number(el.textContent) || 0;
    el.dataset.to = to;
    if (from === to) return;
    const start = performance.now();
    const tick = (now) => {
        if (Number(el.dataset.to) !== to) return;
        const p = Math.min(1, (now - start) / 900);
        el.textContent = String(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

document.addEventListener("scores", ({ detail: { scores, prev } }) => {
    const order = [...GROUPS].sort((a, b) => scores[b] - scores[a] || a - b);
    const top = Math.max(...GROUPS.map((g) => scores[g]));
    for (const g of GROUPS) {
        const row = rows[g];
        row.style.setProperty("--rank", order.indexOf(g));
        row.style.setProperty("--p", (scores[g] / Math.max(1, top)).toFixed(3));
        // Tied groups share a place.
        row.querySelector(".sb-pos").textContent = 1 + GROUPS.filter((h) => scores[h] > scores[g]).length;
        row.classList.toggle("lead", top > 0 && scores[g] === top);
        // The first totals appear as they are; later ones count.
        if (prev) countTo(row.querySelector(".sb-total"), scores[g]);
        else row.querySelector(".sb-total").textContent = scores[g];
        const gain = prev ? scores[g] - prev[g] : 0;
        if (gain > 0) {
            const chip = document.createElement("span");
            chip.className = "sb-plus";
            chip.textContent = `+${gain}`;
            chip.addEventListener("animationend", () => chip.remove());
            row.append(chip);
        }
    }
});

setLayout(localStorage.getItem(LAYOUT_KEY) === "rank" ? "rank" : "cols");
