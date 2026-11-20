/**
 * Turn text read off a screenshot (OCR) into dated rows. No AI: rules for the shapes
 * analytics tables come in, e.g.
 *   "Oct 14, 2026   1,204   2,310   41%"
 *   "2026-10-14 | 1.2k | 2.3k"
 *   "Tue, Oct 14    312    598"
 *   "October 2026   12,400   20,100"
 * Pure functions, safe in the browser and on the server.
 */

export type OcrRow = { date: string; granularity: "day" | "month"; visitors: number | null; pageviews: number | null; bounce_rate: number | null };
export type OcrResult = { rows: OcrRow[]; columns: ("visitors" | "pageviews" | "bounce_rate")[]; headerFound: boolean; linesWithDates: number };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);
/** A written year: 2026, or '26. Two bare digits after a date are a number, not a year. */
const YEAR = "(?:((?:19|20)\\d{2})\\b|[''](\\d{2})\\b)";
const yearOf = (four?: string, two?: string) => (four ? +four : two ? 2000 + +two : null);

/** A year for a date shown without one: the latest year that doesn't put it after today. */
function inferYear(m: number, d: number, today: string) {
  const ty = Number(today.slice(0, 4));
  const iso = `${ty}-${pad(m)}-${pad(d)}`;
  return iso > today ? ty - 1 : ty;
}

type Found = { date: string; granularity: "day" | "month"; start: number; end: number };

/** Find the date in a line; returns where it sits so it can be cut out before reading numbers. */
export function findDate(line: string, today: string): Found | null {
  const l = line.toLowerCase();
  const tries: [RegExp, (m: RegExpExecArray) => { date: string; granularity: "day" | "month" } | null][] = [
    // 2026-10-14, 2026/10/14
    [/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/, (m) => (valid(+m[1], +m[2], +m[3]) ? { date: `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, granularity: "day" } : null)],
    // Oct 14, 2026 / Tue, Oct 14 / October 14th / Oct 14 '26  (a year is 4 digits or '26, so "Oct 14  312" isn't year 312)
    [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+${YEAR})?`), (m) => {
      const mo = MONTHS[m[1].replace(".", "")], d = +m[2];
      const y = yearOf(m[3], m[4]) ?? inferYear(mo, d, today);
      return valid(y, mo, d) ? { date: `${y}-${pad(mo)}-${pad(d)}`, granularity: "day" } : null;
    }],
    // 14 Oct 2026 / 14 Oct
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\b(?:,?\\s+${YEAR})?`), (m) => {
      const mo = MONTHS[m[2].replace(".", "")], d = +m[1];
      const y = yearOf(m[3], m[4]) ?? inferYear(mo, d, today);
      return valid(y, mo, d) ? { date: `${y}-${pad(mo)}-${pad(d)}`, granularity: "day" } : null;
    }],
    // 10/14/2026, 10/14/26 (US order; falls back to day-first when the month can't be > 12)
    [/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/, (m) => {
      let mo = +m[1], d = +m[2];
      if (mo > 12) [mo, d] = [d, mo];
      const y = fullYear(+m[3]);
      return valid(y, mo, d) ? { date: `${y}-${pad(mo)}-${pad(d)}`, granularity: "day" } : null;
    }],
    // 10/14 (no year)
    [/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/, (m) => {
      const mo = +m[1], d = +m[2];
      if (mo > 12) return null;
      const y = inferYear(mo, d, today);
      return valid(y, mo, d) ? { date: `${y}-${pad(mo)}-${pad(d)}`, granularity: "day" } : null;
    }],
    // October 2026 / Oct '26
    [new RegExp(`\\b${MON},?\\s+${YEAR}`), (m) => ({ date: `${yearOf(m[2], m[3])}-${pad(MONTHS[m[1].replace(".", "")])}`, granularity: "month" })],
    // 2026-10
    [/\b(20\d{2})-(\d{1,2})\b/, (m) => (+m[2] >= 1 && +m[2] <= 12 ? { date: `${m[1]}-${pad(+m[2])}`, granularity: "month" } : null)],
    // Today / Yesterday
    [/\b(today|yesterday)\b/, (m) => ({ date: new Date(Date.parse(today) - (m[1] === "yesterday" ? 864e5 : 0)).toISOString().slice(0, 10), granularity: "day" })],
  ];
  for (const [re, make] of tries) {
    const m = re.exec(l);
    if (!m) continue;
    const r = make(m);
    if (r && r.date.slice(0, 10) <= today) return { ...r, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

type Num = { value: number; pct: boolean; signed: boolean };

/** Numbers in what's left of a line: "1,204", "1.2k", "3.4M", "41%", "41.5 %". */
export function findNumbers(rest: string): Num[] {
  // OCR often reads 0 as O and 1 as l/I inside numbers
  // (only inside tokens that start with a digit, e.g. "12,4OO" → "12,400", "1l3" → "113")
  const s = rest.replace(/\b\d[\dOolI,.]*\b/g, (t) => t.replace(/[Oo]/g, "0").replace(/[lI]/g, "1"));
  const out: Num[] = [];
  // thousands separators: comma (OCR sometimes adds a space after it: "2, 241") or thin space;
  // a plain space on its own separates columns
  const re = /([+\-−▲▼↑↓]\s*)?(\d{1,3}(?:(?:, ?| )\d{3}(?!\d))+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kKmM])?\b\s*(%)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let v = Number(m[2].replace(/[,  ]/g, ""));
    // "2.241" with no k/% is 2,241: a comma OCR read as a dot (or a European thousands dot).
    // Counts are whole numbers, and a real decimal like 38.5 doesn't have exactly three digits after the dot.
    if (!m[3] && !m[4] && /^\d{1,3}(?:\.\d{3})+$/.test(m[2])) v = Number(m[2].replace(/\./g, ""));
    if (!Number.isFinite(v)) continue;
    if (m[3]) v *= /k/i.test(m[3]) ? 1e3 : 1e6;
    out.push({ value: v, pct: !!m[4], signed: !!m[1] });
  }
  return out;
}

/**
 * A percentage that can't be one: OCR often drops the decimal point ("42.5%" → "425%"),
 * so put it back before the last digit. Anything still over 100 is thrown away.
 */
export function fixPct(v: number): number | null {
  if (v <= 100) return v;
  if (Number.isInteger(v) && v < 1000) return v / 10;
  return null;
}

/** Which metric each column holds, from a header line like "Date  Visitors  Pageviews  Bounce rate". */
export function headerColumns(line: string): OcrResult["columns"] | null {
  const l = line.toLowerCase();
  const hits: { at: number; col: OcrResult["columns"][number] }[] = [];
  const add = (re: RegExp, col: OcrResult["columns"][number]) => {
    const m = re.exec(l);
    if (m && !hits.some((h) => h.col === col)) hits.push({ at: m.index, col });
  };
  add(/bounce/, "bounce_rate");
  add(/page\s*views?|pageviews?|views|pageloads?|hits/, "pageviews");
  add(/visitors?|uniques?|unique|users?|people|visits|sessions?/, "visitors");
  // "visits" inside "visitors" was already caught by the visitors pattern; skip lines that look like data
  if (!hits.length || /\d{2,}/.test(l.replace(/20\d{2}/g, ""))) return null;
  return hits.sort((a, b) => a.at - b.at).map((h) => h.col);
}

export function textToRows(text: string, today = new Date().toISOString().slice(0, 10)): OcrResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let columns: OcrResult["columns"] = ["visitors", "pageviews"];
  let headerFound = false;
  const byDate = new Map<string, OcrRow>();
  let linesWithDates = 0;

  for (const line of lines) {
    const date = findDate(line, today);
    if (!date) {
      const h = headerColumns(line);
      if (h) {
        columns = h;
        headerFound = true;
      }
      continue;
    }
    linesWithDates++;
    const rest = line.slice(0, date.start) + " " + line.slice(date.end);
    // signed values are changes ("+12%", "▲ 40"), not the numbers themselves
    const nums = findNumbers(rest).filter((n) => !n.signed);
    const counts = nums.filter((n) => !n.pct).map((n) => n.value);
    const pcts = nums.filter((n) => n.pct).map((n) => n.value);
    if (!counts.length && !pcts.length) continue;
    const row: OcrRow = { date: date.date, granularity: date.granularity, visitors: null, pageviews: null, bounce_rate: null };
    const countCols = columns.filter((c) => c !== "bounce_rate");
    countCols.forEach((c, i) => {
      if (counts[i] != null) row[c] = counts[i];
    });
    if (columns.includes("bounce_rate") && pcts[0] != null) row.bounce_rate = fixPct(pcts[0]);
    if (row.visitors == null && row.pageviews == null) continue;
    if (!byDate.has(row.date)) byDate.set(row.date, row);
  }

  return { rows: finish(byDate), columns, headerFound, linesWithDates };
}

/** A table is all days or all months: keep whichever there are more of, oldest first. */
function finish(byDate: Map<string, OcrRow>): OcrRow[] {
  let rows = [...byDate.values()];
  const days = rows.filter((r) => r.granularity === "day").length;
  rows = rows.filter((r) => r.granularity === (days >= rows.length - days ? "day" : "month"));
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------------- position-aware reading ---------------- */

export type OcrWord = { text: string; x0: number; x1: number; y0: number; y1: number };
export type OcrLine = { words: OcrWord[] };

const COL_WORD: Record<OcrResult["columns"][number], RegExp> = {
  bounce_rate: /bounce/i,
  pageviews: /views?|pageloads?|hits/i,
  visitors: /visit|users?|uniques?|people|sessions?/i,
};

/**
 * Like textToRows, but uses where each word sits on the image: every number is put under the
 * column heading above it. So if OCR misses one cell, the rest of the row doesn't slide into the
 * wrong columns. Falls back to textToRows when there's no header to line up with.
 */
export function layoutToRows(lines: OcrLine[], today = new Date().toISOString().slice(0, 10)): OcrResult {
  type Span = { col: OcrResult["columns"][number]; x0: number; x1: number };
  let spans: Span[] | null = null;
  const byDate = new Map<string, OcrRow>();
  let linesWithDates = 0;

  for (const line of lines) {
    const words = line.words.filter((w) => w.text.trim());
    if (!words.length) continue;
    // joined text, remembering where each word starts
    let text = "";
    const at: number[] = [];
    for (const w of words) {
      if (text) text += " ";
      at.push(text.length);
      text += w.text;
    }

    const date = findDate(text, today);
    if (!date) {
      const cols = headerColumns(text);
      if (cols) {
        // each heading's span: the matching word plus neighbours close enough to be one heading ("Page views")
        const h = (words[0].y1 - words[0].y0) || 10;
        spans = cols.map((col) => {
          const i = words.findIndex((w) => COL_WORD[col].test(w.text));
          let a = i, b = i;
          while (a > 0 && words[a].x0 - words[a - 1].x1 < h * 0.8 && !Object.values(COL_WORD).some((re) => re.test(words[a - 1].text))) a--;
          while (b < words.length - 1 && words[b + 1].x0 - words[b].x1 < h * 0.8 && !Object.values(COL_WORD).some((re) => re.test(words[b + 1].text))) b++;
          return { col, x0: words[a].x0, x1: words[b].x1 };
        }).filter((s) => s.x1 > 0).sort((p, q) => p.x0 - q.x0);
      }
      continue;
    }
    linesWithDates++;
    if (!spans?.length) continue;

    // number words outside the date. OCR sometimes splits one number at its thousands comma
    // ("2," "241", "2" ",241", or "2" "241" with the comma lost); pieces that sit closer than
    // about one character apart are one number
    const cells: { text: string; cx: number; x1: number }[] = [];
    const charW = ((words[0].y1 - words[0].y0) || 10) * 0.7;
    words.forEach((w, i) => {
      const s = at[i], e = s + w.text.length;
      if (e > date.start && s < date.end) return;
      const prev = cells.at(-1);
      if (prev && /^\d{1,3},?$/.test(prev.text) && /^,?\d{3}(?:[.,]\d+)?%?$/.test(w.text) && w.x0 - prev.x1 < charW * 1.2) {
        prev.text = prev.text.replace(/,$/, "") + "," + w.text.replace(/^,/, "");
        prev.cx = (prev.cx + (w.x0 + w.x1) / 2) / 2;
        prev.x1 = w.x1;
      } else cells.push({ text: w.text, cx: (w.x0 + w.x1) / 2, x1: w.x1 });
    });

    const row: OcrRow = { date: date.date, granularity: date.granularity, visitors: null, pageviews: null, bounce_rate: null };
    for (const c of cells) {
      const n = findNumbers(c.text)[0];
      if (!n || n.signed) continue;
      // the column whose region holds this number: regions split halfway between headings
      let k = spans.length - 1;
      for (let i = 0; i < spans.length - 1; i++) if (c.cx < (spans[i].x1 + spans[i + 1].x0) / 2) { k = i; break; }
      const col = spans[k].col;
      if (c.cx < spans[0].x0 - (spans[0].x1 - spans[0].x0) * 1.5) continue; // far left of every metric: not a metric
      const value = col === "bounce_rate" ? fixPct(n.value) : n.value;
      if (col === "bounce_rate" ? value == null : n.pct) continue; // a % under a count column is a change, not a count
      if (row[col] == null) row[col] = value;
    }
    if (row.visitors == null && row.pageviews == null) continue;
    if (!byDate.has(row.date)) byDate.set(row.date, row);
  }

  if (!spans?.length) return textToRows(lines.map((l) => l.words.map((w) => w.text).join("  ")).join("\n"), today);
  return { rows: finish(byDate), columns: spans.map((s) => s.col), headerFound: true, linesWithDates };
}

export function rowsToCsv(rows: OcrRow[]): string {
  const n = (v: number | null) => (v == null ? "" : String(Math.round(v * 100) / 100));
  return ["date,visitors,pageviews,bounce_rate", ...rows.map((r) => [r.date, n(r.visitors), n(r.pageviews), r.bounce_rate == null ? "" : `${n(r.bounce_rate)}%`].join(","))].join("\n");
}
