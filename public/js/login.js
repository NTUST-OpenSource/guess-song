async function sendLogin() {
    const formData = new FormData();
    formData.append("username", document.getElementById("username").value);
    formData.append("password", document.getElementById("password").value);

    try {
        const res = await fetch("/api/login", { method: "POST", body: formData });
        const data = await res.json();
        if (data.status === 1) {
            localStorage.setItem("ntust_camp_token", data.token);
            // Only allow-listed paths in next, so the login page cannot redirect elsewhere.
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
