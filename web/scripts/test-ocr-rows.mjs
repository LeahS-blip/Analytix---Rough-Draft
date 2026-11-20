// Checks the no-AI screenshot reader's text → rows rules. Run: node scripts/test-ocr-rows.mjs
import assert from "node:assert/strict";
const { textToRows, findNumbers, rowsToCsv } = await import("../src/lib/ocrRows.ts");
const today = "2026-11-17";

// A typical table, header first, with deltas and a bounce column
let r = textToRows(`Traffic overview
Date        Visitors   Pageviews   Bounce rate
Nov 14, 2026   1,204     2,310       41%
Nov 15, 2026   1.2k      2.3k        38.5 %
Nov 16, 2026   980 ▲ 12%  1,870      40%
Total 3,384  6,480`, today);
assert.equal(r.headerFound, true);
assert.deepEqual(r.columns, ["visitors", "pageviews", "bounce_rate"]);
assert.deepEqual(r.rows.map((x) => [x.date, x.visitors, x.pageviews, x.bounce_rate]), [
  ["2026-11-14", 1204, 2310, 41],
  ["2026-11-15", 1200, 2300, 38.5],
  ["2026-11-16", 980, 1870, 40],
]);

// Column order from the header: views before visitors
r = textToRows(`Day  Page views  Unique visitors\n2026-11-01  500  210\n2026-11-02  640  260`, today);
assert.deepEqual(r.rows.map((x) => [x.visitors, x.pageviews]), [[210, 500], [260, 640]]);

// No year shown: dates after today belong to last year; weekday prefixes are fine
r = textToRows(`Tue, Nov 11   312   598\nDec 30   40   70\n14 Oct  99  150`, today);
assert.deepEqual(r.rows.map((x) => x.date), ["2025-12-30", "2026-10-14", "2026-11-11"]);

// Months, and OCR mistakes (O for 0)
r = textToRows(`Month Visitors\nSeptember 2026  12,4OO\nOctober 2026  13,900`, today);
assert.deepEqual(r.rows.map((x) => [x.date, x.granularity, x.visitors]), [["2026-09", "month", 12400], ["2026-10", "month", 13900]]);

// US dates, plain space-separated columns aren't glued into one number
r = textToRows(`10/14/2026 312 598\n10/15/26 1 2`, today);
assert.deepEqual(r.rows.map((x) => [x.date, x.visitors, x.pageviews]), [["2026-10-14", 312, 598], ["2026-10-15", 1, 2]]);

// OCR put a space after a thousands comma ("2, 241"); two separate columns stay apart
r = textToRows(`Date  Visitors  Pageviews\nNov 13, 2026   1,114     2, 241\nNov 14, 2026   12   2412`, today);
assert.deepEqual(r.rows.map((x) => [x.visitors, x.pageviews]), [[1114, 2241], [12, 2412]]);

// Lines without a date or numbers are ignored; future dates are ignored
r = textToRows(`Visitors 5,200 last 30 days\nNov 20, 2026  10  20`, today);
assert.equal(r.rows.length, 0);

assert.deepEqual(findNumbers("+12% 3.4M 41%").map((n) => [n.value, n.pct, n.signed]), [[12, true, true], [3400000, false, false], [41, true, false]]);
assert.equal(rowsToCsv([{ date: "2026-11-14", granularity: "day", visitors: 5, pageviews: null, bounce_rate: 40 }]), "date,visitors,pageviews,bounce_rate\n2026-11-14,5,,40%");
// Position-aware: a missed cell leaves a gap instead of shifting the row
const { layoutToRows } = await import("../src/lib/ocrRows.ts");
const W = (text, x0, w = 60, y = 0) => ({ text, x0, x1: x0 + w, y0: y, y1: y + 14 });
const lines = [
  { words: [W("Date", 24, 30), W("Visitors", 260, 55), W("Page", 440, 30), W("views", 474, 40), W("Bounce", 640, 45), W("rate", 689, 25)] },
  { words: [W("Nov", 24, 25), W("9,", 52, 14), W("2026", 70, 30), /* visitors missed */ W("1,835", 440, 40), W("42.5%", 640, 40)] },
  { words: [W("Nov", 24, 25), W("10,", 52, 18), W("2026", 74, 30), W("950", 260, 26), W("2,", 440, 12), W("013", 455, 26), W("▲", 520, 8), W("+4%", 530, 28)] },
];
r = layoutToRows(lines, today);
assert.deepEqual(r.columns, ["visitors", "pageviews", "bounce_rate"]);
assert.deepEqual(r.rows.map((x) => [x.date, x.visitors, x.pageviews, x.bounce_rate]), [
  ["2026-11-09", null, 1835, 42.5],
  ["2026-11-10", 950, 2013, null],
]);
// one number split into two words, with or without its comma; far-apart numbers stay separate
r = layoutToRows([lines[0],
  { words: [W("Nov", 24, 25), W("12,", 52, 18), W("2026", 74, 30), W("1", 260, 8), W("114", 270, 24), W("2", 440, 8), W(",241", 449, 30)] },
], today);
assert.deepEqual([r.rows[0].visitors, r.rows[0].pageviews], [1114, 2241]);

// a thousands comma read as a dot ("2.241") is still 2,241; real decimals and k values are kept
assert.deepEqual(findNumbers("2.241 38.5% 1.2k 12.5").map((n) => n.value), [2241, 38.5, 1200, 12.5]);

// a dropped decimal point in a bounce rate ("425%") is put back
r = layoutToRows([lines[0], { words: [W("Nov", 24, 25), W("11,", 52, 18), W("2026", 74, 30), W("900", 260, 26), W("1,800", 440, 40), W("425%", 640, 36)] }], today);
assert.equal(r.rows[0].bounce_rate, 42.5);
assert.equal(textToRows("Date Visitors Bounce rate\nNov 11, 2026 900 1250%", today).rows[0].bounce_rate, null);

// no header → falls back to the text rules
r = layoutToRows([{ words: [W("2026-11-01", 0, 80), W("12", 120, 20), W("30", 200, 20)] }], today);
assert.deepEqual(r.rows.map((x) => [x.visitors, x.pageviews]), [[12, 30]]);
console.log("OCR row rules: all checks passed");
