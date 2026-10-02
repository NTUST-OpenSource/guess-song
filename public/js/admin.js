// Shared by the dashboard and /host: login guard, API calls, messages, logout and +N pops.
const TOKEN_KEY = "ntust_camp_token";
const GROUPS = [1, 2, 3, 4];
const SVG_NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

// Back to the login page, which returns here afterwards.
function toLogin() {
    localStorage.removeItem(TOKEN_KEY);
    location.href = `/login?next=${location.pathname}`;
}

if (!localStorage.getItem(TOKEN_KEY)) toLogin();

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

// An icon or group shape from the page's SVG symbols.
function icon(id, cls = "icon") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#${id}`);
    svg.append(use);
    return svg;
}

// A short message at the bottom ("ok" green, "bad" red). It is a popover so it also shows above open dialogs.
let toastTimer = 0;
function toast(msg, kind = "") {
    const box = $("toast");
    clearTimeout(toastTimer);
    if (box.matches(":popover-open")) box.hidePopover();
    box.textContent = msg;
    box.className = `toast ${kind}`;
    box.showPopover();
    toastTimer = setTimeout(() => box.classList.add("out"), 2600);
}

$("toast").addEventListener("animationend", (e) => {
    if (e.animationName === "toastOut") e.target.hidePopover();
});

// POST with the login token. Returns the response data, or null after showing the error unless quiet.
async function send(url, payload = {}, quiet = false) {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: localStorage.getItem(TOKEN_KEY), ...payload }),
        });
        if (res.status === 401) return toLogin();
        const data = await res.json();
        if (data.status === 1) return data;
        if (!quiet) toast(data.msg, "bad");
    } catch {
        if (!quiet) toast("網路錯誤，請再試一次", "bad");
    }
    return null;
}

const adminApi = (action, payload, quiet) => send(`/api/admin/${action}`, payload, quiet);

// The last admin state, kept for this tab's session so the next admin page can draw it at once.
const STATE_KEY = "admin_state";

function savedState() {
    try {
        return JSON.parse(sessionStorage.getItem(STATE_KEY));
    } catch {
        return null;
    }
}

function saveState(state) {
    try {
        sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
        // Without storage the next page waits for the server instead.
    }
}

// How many players of each group answered.
function groupCounts(answers) {
    return GROUPS.map((g) => {
        const n = answers.filter((a) => a.group === g).length;
        const chip = el("span", n ? "count" : "count zero");
        chip.dataset.g = g;
        const mark = el("span", "gchip");
        mark.append(icon(`sh${g}`, "shape"));
        chip.append(mark, el("span", "sr", `第 ${g} 組`), el("b", null, String(n)), " 人");
        return chip;
    });
}

$("logout_btn").addEventListener("click", toLogin);

// Pop +N over a group's total when it goes up.
document.addEventListener("scores", ({ detail: { scores, prev } }) => {
    if (!prev) return;
    for (const g of GROUPS) {
        const gain = scores[g] - prev[g];
        const box = document.querySelector(`[data-pop="${g}"]`);
        if (gain <= 0 || !box) continue;
        const chip = el("span", "plus-float", `+${gain}`);
        chip.addEventListener("animationend", () => chip.remove());
        box.append(chip);
    }
});
