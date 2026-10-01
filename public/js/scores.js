// 計分板（/scoreboard）、後台、/host 共用：顯示四隊分數，分數由 WebSocket 推過來（defer 載入，DOM 已就緒）
function renderScores(data) {
    for (let i = 1; i <= 4; i++) {
        const box = document.querySelector(`#t${i} .score-box`);
        // 後台正在打字、或箭頭還在送出的那格先不蓋掉；計分板和 /host 的唯讀框點到了也照常更新
        if (!box.readOnly && (box === document.activeElement || Number(box.dataset.pending) > 0)) continue;
        box.value = data[i];
    }
}

// 按完按鈕、取消編輯時手動對一次：被跳過的那格要補回伺服器的分數
async function refreshScores() {
    try {
        renderScores(await (await fetch("/api/GetScore")).json());
    } catch {
        // ponytail: 失敗就等下一次推播
    }
}

// 伺服器狀態一變（加分、發題、收卷、有人作答、選歌）就會收到；後台頁面聽 "live" 事件自己重抓
live((msg) => {
    if (msg.type !== "scores") return;
    renderScores(msg.scores);
    document.dispatchEvent(new CustomEvent("live"));
});
