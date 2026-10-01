// 收卷後的戰況短評：看每題各組得分（舊 → 新）和目前總分，挑最有戲的兩句給手機顯示。
// rounds: [{ "1": 5, "2": 3, ... }, ...]，最後一筆是剛收卷的這題
// scores: 目前總分；teams: 這題各組每項取組內最高分 { 1: { year, artist, title }, ... }
// 數字小的優先，同優先照下面判斷的順序
const team = (g) => `第 ${g} 組`;
const teamList = (gs) => `第 ${gs.join("、")} 組`;

export function notes(rounds, scores, teams = {}) {
    const last = rounds.at(-1);
    if (!last) return [];
    const groups = Object.keys(scores).map(Number);
    const pts = (round, g) => round[g] ?? 0;
    const before = Object.fromEntries(groups.map((g) => [g, scores[g] - pts(last, g)]));
    const rank = (s) => [...groups].sort((x, y) => s[y] - s[x] || x - y);
    // 名次：同分同名次（開賽時四組都 0 分，大家都是第 1 名）
    const place = (s, g) => 1 + groups.filter((x) => s[x] > s[g]).length;
    const tops = (s) => groups.filter((g) => s[g] === s[rank(s)[0]]);
    const now = rank(scores);
    const was = rank(before);
    const leaders = tops(scores);
    const wasLeaders = tops(before);
    // 從第 end 題往回數，連續幾題符合 ok
    const streak = (g, ok, end = rounds.length - 1) => {
        let k = 0;
        while (end - k >= 0 && ok(pts(rounds[end - k], g))) k++;
        return k;
    };
    const said = [];
    const say = (priority, text) => said.push({ priority, text });

    if (groups.every((g) => pts(last, g) === 0)) say(1, "怎麼沒人答對，出題在搞！");
    if (leaders.length === 1 && wasLeaders.join() !== leaders.join()) {
        const g = leaders[0];
        if (rounds.length === 1) say(1, `${team(g)}搶得頭香，暫居第一！`);
        else if (wasLeaders.includes(g)) say(1, `${team(g)}脫穎而出，獨居第一！`);
        else say(1, `${team(g)}超車成功，登上第一！`);
    }
    if (leaders.length > 1 && scores[leaders[0]] > 0 && wasLeaders.join() !== leaders.join()) {
        say(2, `${teamList(leaders)}並列第一！`);
    }

    const perfect = [];
    for (const g of groups) {
        const perfectRun = streak(g, (p) => p >= 5);
        const scoredRun = streak(g, (p) => p > 0);
        const dryRun = streak(g, (p) => p === 0);
        if (perfectRun >= 2) say(2, `${team(g)}連續 ${perfectRun} 題滿分，書卷了吧...`);
        else if (perfectRun === 1) perfect.push(g);
        if (scoredRun >= 5) say(3, `${team(g)}連續 ${scoredRun} 題得分，好電！`);
        else if (scoredRun >= 3) say(6, `${team(g)}連續 ${scoredRun} 題得分`);
        // 衝上第一已經有上面那句，這裡只講中段的爬升
        const [from, to] = [place(before, g), place(scores, g)];
        if (to > 1 && from - to >= 2) say(3, `${team(g)}大躍進，從第 ${from} 名衝到第 ${to} 名！`);
        if (scoredRun === 1 && streak(g, (p) => p === 0, rounds.length - 2) >= 2) say(5, `${team(g)}終於開張！`);
        if (dryRun >= 3) say(8, `${team(g)}已經連續 ${dryRun} 題沒拿分，加油！`);
    }
    if (perfect.length) say(4, `${teamList(perfect)}這題拿下滿分！`);
    const exact = groups.filter((g) => teams[g]?.year === 3);
    if (exact.length) say(7, `${teamList(exact)}年份一年不差！`);

    const [first, second] = now;
    const gap = scores[first] - scores[second];
    if (gap > 0 && gap <= 2) say(5, `${team(second)}仍緊追不放，只差 ${gap} 分！`);
    else if (gap >= 5 && first === was[0] && gap > before[first] - before[second]) {
        say(6, `${team(first)}領先擴大到 ${gap} 分！`);
    }
    const spread = scores[first] - scores[now.at(-1)];
    if (rounds.length >= 3 && spread > 0 && spread <= 3) say(7, `四組只差 ${spread} 分，戰況膠著！`);
    if (groups.every((g) => pts(last, g) > 0)) say(8, "四組都有拿分，這題大家都會！");

    return said
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 2)
        .map((n) => n.text);
}
