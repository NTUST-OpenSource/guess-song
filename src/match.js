import { pinyin } from "pinyin-pro";

// Ignore case, full-width forms, whitespace and punctuation.
export const norm = (s) =>
    String(s)
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]/gu, "");

// For matching only, also drop accents and invisible characters such as zero-width spaces.
const fold = (s) =>
    norm(s)
        .normalize("NFD")
        .replace(/[\u0300-\u036f\p{Cf}]/gu, "")
        .normalize("NFC");

const hasHan = (s) => /\p{Script=Han}/u.test(s);

// Toneless readings of one Han character, with zh/z, ch/c, sh/s and -ng/-n merged as in Taiwanese Mandarin.
// Cached, since every request that grades repeats the same characters.
const readings = new Map();
const sounds = (c) => {
    if (!readings.has(c)) {
        const all = hasHan(c) ? pinyin(c, { toneType: "none", type: "array", multiple: true }) : [];
        readings.set(c, all.map((p) => p.replace(/^([zcs])h/, "$1").replace(/ng$/, "n")));
    }
    return readings.get(c);
};

// pinyin-pro is slow on its first call, so make that call at startup rather than inside a request.
sounds("一");

// Same length, and each character is the same or shares a reading: 同話 passes for 童話 and 說愛妳 for 說愛你.
const soundsAlike = (a, b) => {
    const [x, y] = [[...a], [...b]];
    return x.length === y.length && x.every((c, i) => c === y[i] || sounds(c).some((s) => sounds(y[i]).includes(s)));
};

// Edit distance that also counts swapping two neighbors as one edit.
// Keeps only the last three rows, since grading a full history runs this thousands of times.
function editDistance(a, b) {
    let [before, prev] = [[], [...Array(b.length + 1).keys()]];
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
        }
        [before, prev] = [prev, row];
    }
    return prev[b.length];
}

// Typos allowed in letters and digits, by the length of the accepted answer: none up to 4, one up to 8, then two.
const typoLimit = (n) => (n <= 4 ? 0 : n <= 8 ? 1 : 2);
const digits = (s) => s.replace(/\D/g, "");

// The check for one field, folding its accepted answers once per grading.
// Chinese passes only by sound, never with a character more, less or different, so 我們的歌 fails for 我們的愛.
// Digits must match exactly, so Blink-183 fails for Blink-182.
export function matcher(accepted) {
    const keys = accepted.map(fold).filter(Boolean);
    const han = keys.filter(hasHan);
    const latin = keys.filter((k) => /^[a-z0-9]+$/.test(k));
    return (answer) => {
        const a = fold(answer);
        if (!a) return false;
        return (
            keys.includes(a) ||
            han.some((k) => soundsAlike(a, k)) ||
            latin.some((k) => {
                const limit = typoLimit(k.length);
                return digits(a) === digits(k) && Math.abs(a.length - k.length) <= limit && editDistance(a, k) <= limit;
            })
        );
    };
}
