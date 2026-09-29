// defer 載入，DOM 已就緒
async function sendLogin() {
    const formData = new FormData();
    formData.append("username", document.getElementById("username").value);
    formData.append("password", document.getElementById("password").value);

    try {
        const res = await fetch("/api/login", { method: "POST", body: formData });
        const data = await res.json();
        if (data.status === 1) {
            localStorage.setItem("ntust_camp_token", data.token);
            // 從 /host 被踢回來的就回 /host；只收白名單，避免被拿去轉址到外站
            const next = new URLSearchParams(location.search).get("next");
            window.location.href = ["/host", "/dashboard"].includes(next) ? next : "/dashboard";
        } else {
            alert(data.msg);
        }
    } catch {
        alert("網路錯誤，請再試一次");
    }
}

document.getElementById("submit").addEventListener("click", () => {
    void sendLogin();
});

for (const id of ["username", "password"]) {
    document.getElementById(id).addEventListener("keydown", (e) => {
        if (e.key === "Enter") void sendLogin();
    });
}
