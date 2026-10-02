// The dashboard page shell, for both of its views (控制台 and 主持人): login guard, view switching, API calls,
// messages, logout and +N pops.
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

// ===== Views =====
// <html data-view> picks the view (set before the first frame from the address); the tabs switch it in place.
const VIEWS = {
    dashboard: { path: "/dashboard", title: "三『資』小豬 - 後台控制台" },
    host: { path: "/host", title: "三『資』小豬 - 主持人" },
};

function showView(view) {
    document.documentElement.dataset.view = view;
    document.title = VIEWS[view].title;
    for (const tab of document.querySelectorAll(".adm-nav [data-to]")) {
        if (tab.dataset.to === view) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
    }
    document.dispatchEvent(new CustomEvent("view", { detail: view }));
}

for (const tab of document.querySelectorAll(".adm-nav [data-to]")) {
    tab.addEventListener("click", (e) => {
        // Let modified clicks open the view in a new tab.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        const view = tab.dataset.to;
        if (document.documentElement.dataset.view === view) return;
        history.pushState(null, "", VIEWS[view].path);
        // The tab slides and the boxes morph where view transitions are supported.
        if (document.startViewTransition) document.startViewTransition(() => showView(view));
        else showView(view);
    });
}

addEventListener("popstate", () => showView(location.pathname === "/host" ? "host" : "dashboard"));

// /host reaches this page through a redirect that adds #host; show the address the person opened.
if (location.hash === "#host") history.replaceState(null, "", "/host");
showView(document.documentElement.dataset.view);

// Pop +N over a group's total, in both views, when it goes up.
document.addEventListener("scores", ({ detail: { scores, prev } }) => {
    if (!prev) return;
    for (const g of GROUPS) {
        const gain = scores[g] - prev[g];
        if (gain <= 0) continue;
        for (const box of document.querySelectorAll(`[data-pop="${g}"]`)) {
            const chip = el("span", "plus-float", `+${gain}`);
            chip.addEventListener("animationend", () => chip.remove());
            box.append(chip);
        }
    }
});
