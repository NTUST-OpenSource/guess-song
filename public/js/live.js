// Keeps one WebSocket to the Scores object: reconnects with backoff, reconnects on wake, and pings to stay alive.
// With a token the socket receives the player's state, otherwise only totals; reconnect() switches identity after join or logout.
function live(onMessage, token = () => null, onStatus = () => {}) {
    const PING_MS = 25000;
    // No message (pongs included) for this long means the socket is dead.
    const DEAD_MS = 60000;
    let ws = null;
    let retry = 0;
    let timer = 0;
    let seen = 0;

    function connect() {
        clearTimeout(timer);
        if (ws) {
            ws.onclose = null;
            // Send a code so the server can echo the close and end the connection.
            ws.close(1000);
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
            // Retry after 1, 2, 4 and 8 seconds, then every 10 seconds.
            timer = setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++));
        };
    }

    setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - seen > DEAD_MS) return connect();
        ws.send("ping");
    }, PING_MS);

    // When the page returns or the network comes back, reconnect at once if the socket is gone or silent.
    const wake = () => {
        if (document.hidden) return;
        if (ws.readyState !== WebSocket.OPEN || Date.now() - seen > PING_MS * 1.5) connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    connect();
    return { reconnect: connect };
}
