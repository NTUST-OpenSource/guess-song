// 計分板（/scoreboard）、後台、/host 共用：抓分數、更新四隊 score box、每秒輪詢（defer 載入，DOM 已就緒）
async function refreshScores() {
    try {
        const res = await fetch("/api/GetScore");
        const data = await res.json();
        for (let i = 1; i <= 4; i++) {
            const box = document.querySelector(`#t${i} .score-box`);
            // 後台正在打字、或箭頭還在送出的那格先不蓋掉；計分板和 /host 的唯讀框點到了也照常更新
            if (!box.readOnly && (box === document.activeElement || Number(box.dataset.pending) > 0)) continue;
            box.value = data[i];
        }
    } catch {
        // ponytail: 輪詢失敗就等下一秒重試，不干擾畫面
    }
}

void refreshScores();
setInterval(refreshScores, 1000);
