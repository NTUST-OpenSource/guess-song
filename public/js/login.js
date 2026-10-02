const form = document.getElementById("login_form");
const error = document.getElementById("login_error");
const submit = document.getElementById("submit");

function showError(msg) {
    document.getElementById("login_error_text").textContent = msg;
    error.hidden = false;
    // Restart the shake on every failure.
    form.classList.remove("shake");
    void form.offsetWidth;
    form.classList.add("shake");
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.username.value.trim() || !form.password.value) return showError("請輸入帳號和密碼");
    submit.disabled = true;
    submit.textContent = "登入中…";
    try {
        const res = await fetch("/api/login", { method: "POST", body: new FormData(form) });
        const data = await res.json();
        if (data.status === 1) {
            localStorage.setItem("ntust_camp_token", data.token);
            // Only allow-listed paths in next, so the login page cannot redirect elsewhere.
            const next = new URLSearchParams(location.search).get("next");
            location.href = ["/host", "/dashboard"].includes(next) ? next : "/dashboard";
            return;
        }
        showError(data.msg);
    } catch {
        showError("網路錯誤，請再試一次");
    }
    submit.disabled = false;
    submit.textContent = "登入";
});

form.addEventListener("input", () => {
    error.hidden = true;
});

document.getElementById("pw_eye").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const show = form.password.type === "password";
    form.password.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "隱藏密碼" : "顯示密碼");
    btn.querySelector("use").setAttribute("href", show ? "#ic-eye-off" : "#ic-eye");
});
