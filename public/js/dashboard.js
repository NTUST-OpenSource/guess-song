// refreshScores comes from /js/scores.js.
const TOKEN_KEY = "ntust_camp_token";
const MAX_SCORE = 999;

if (!localStorage.getItem(TOKEN_KEY)) {
    window.location.href = "/login";
}

function logout() {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login";
}

// An expired token sends the admin back to the login page.
async function post(url, payload) {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: localStorage.getItem(TOKEN_KEY), ...payload }),
        });

        if (res.status === 401) return logout();

        const data = await res.json();
        if (data.status === 1) return true;
        alert(data.msg);
    } catch {
        alert("網路錯誤，請再試一次");
    }
    return false;
}

// Arrow buttons update the box first, then send a delta so a concurrent close is not overwritten.
// data-pending keeps pushes from overwriting a box while its update is in flight.
for (const btn of document.querySelectorAll(".score-step")) {
    btn.addEventListener("click", async () => {
        const group = Number(btn.dataset.group);
        const delta = Number(btn.dataset.delta);
        const box = document.querySelector(`#t${group} .score-box`);
        box.value = Math.max(0, Math.min(MAX_SCORE, (Number(box.value) || 0) + delta));
        box.dataset.pending = String(Number(box.dataset.pending ?? 0) + 1);
        await post("/api/AddScore", { group, delta });
        box.dataset.pending = String(Number(box.dataset.pending) - 1);
        void refreshScores();
    });
}

// Typed scores: Enter saves; Escape or leaving the box cancels and restores the server value.
for (const box of document.querySelectorAll(".score-editor .score-box")) {
    box.addEventListener("keydown", async (e) => {
        if (e.key === "Escape") return box.blur();
        if (e.key !== "Enter") return;
        const score = box.valueAsNumber;
        if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
            return alert(`分數要是 0–${MAX_SCORE} 的整數`);
        }
        await post("/api/SetScore", { group: Number(box.dataset.group), score });
        box.blur();
    });
    box.addEventListener("blur", () => void refreshScores());
}

document.getElementById("logout_btn").addEventListener("click", logout);
