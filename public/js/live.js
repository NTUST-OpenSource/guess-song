// 跟 Scores DO 保持一條 WebSocket（defer 載入）：斷線自動重連、切回前景馬上補連、定時 ping 保活。
// token() 有值就是玩家連線（推個人狀態），沒有就只收總分；回傳的 reconnect() 換身分（加入、登出）時用
function live(onMessage, token = () => null, onStatus = () => {}) {
    const PING_MS = 25000;
    const DEAD_MS = 60000; // 這麼久沒收到任何東西（包含 pong）就當作斷了，手機睡醒常常是這樣
    let ws = null;
    let retry = 0;
    let timer = 0;
    let seen = 0;

    function connect() {
        clearTimeout(timer);
        if (ws) {
            ws.onclose = null;
            ws.close(1000); // 不帶代碼的話伺服器收到 1005，回不了關閉訊息，連線會掛著十幾秒
        }
        const t = token();
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${scheme}://${location.host}/api/ws${t ? `?token=${encodeURIComponent(t)}` : ""}`);
        seen = Date.now();
        ws.onopen = () => {
            retry = 0;
            onStatus(true);
        };
        ws.onmessage = (e) => {
            seen = Date.now();
            if (e.data !== "pong") onMessage(JSON.parse(e.data));
        };
        ws.onclose = () => {
            onStatus(false);
            // 1、2、4、8 秒…最多隔 10 秒重試一次
            timer = setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++));
        };
    }

    setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - seen > DEAD_MS) return connect();
        ws.send("ping");
    }, PING_MS);

    // 手機切回前景、網路恢復：連線不在或太久沒消息就馬上重連，不等退避的計時器
    const wake = () => {
        if (document.hidden) return;
        if (ws.readyState !== WebSocket.OPEN || Date.now() - seen > PING_MS * 1.5) connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    connect();
    return { reconnect: connect };
}
