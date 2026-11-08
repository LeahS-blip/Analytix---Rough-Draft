/**
 * Turns a messy CSV / TSV / JSON export into clean dated rows.
 * Pure functions — no I/O — so they can be unit-tested and reused.
 */

export type Granularity = "day" | "month";
export type ParsedRow = {
  granularity: Granularity;
  date: string; // YYYY-MM-DD, or YYYY-MM-01 for months
  visitors: number | null;
  pageviews: number | null;
  bounce_rate: number | null;
};
export type ParseResult = {
  format: "csv" | "json";
  columns: { date: string; visitors?: string; pageviews?: string; bounce_rate?: string };
  rows: ParsedRow[];
  skipped: { line: number; reason: string }[];
  merged: number;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && y >= 1990 && y <= 2100;
}

/** Parse a date cell. Returns null when it can't be read unambiguously. */
export function parseDate(raw: unknown): { granularity: Granularity; date: string } | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    // unix seconds or ms
    const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : NaN;
    if (Number.isNaN(ms)) return null;
    return { granularity: "day", date: new Date(ms).toISOString().slice(0, 10) };
  }
  const s = String(raw).trim().replace(/^["']|["']$/g, "");
  if (!s) return null;
  let m: RegExpMatchArray | null;

  // 2026-08-26, 2026/08/26, 2026-08-26T00:00:00Z
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return validDay(y, mo, d) ? { granularity: "day", date: `${y}-${pad(mo)}-${pad(d)}` } : null;
  }
  // 2026-08 (month)
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})$/))) {
    const [y, mo] = [+m[1], +m[2]];
    return mo >= 1 && mo <= 12 ? { granularity: "month", date: `${y}-${pad(mo)}-01` } : null;
  }
  // 8/26/2026 or 8/26/26 (US order)
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    let [mo, d] = [+m[1], +m[2]];
    const y = fullYear(+m[3]);
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]; // clearly D/M/Y
    return validDay(y, mo, d) ? { granularity: "day", date: `${y}-${pad(mo)}-${pad(d)}` } : null;
  }
  // 8/26 → Aug 2026 (month/yy, as people type in spreadsheets)
  if ((m = s.match(/^(\d{1,2})\/(\d{2})$/))) {
    const mo = +m[1];
    return mo >= 1 && mo <= 12 ? { granularity: "month", date: `${fullYear(+m[2])}-${pad(mo)}-01` } : null;
  }
  // "Jun '26", "June 2026", "jun-26", "Jun 26, 2026", "26 Jun 2026"
  const words = s.toLowerCase().replace(/[,']/g, " ").replace(/\s+/g, " ").trim();
  if ((m = words.match(/^([a-z]{3,9})[\s-]+(\d{1,2})\s+(\d{4})$/))) {
    const mo = MONTHS[m[1].slice(0, 3)];
    if (mo && validDay(+m[3], mo, +m[2])) return { granularity: "day", date: `${m[3]}-${pad(mo)}-${pad(+m[2])}` };
  }
  if ((m = words.match(/^(\d{1,2})[\s-]+([a-z]{3,9})[\s-]+(\d{4})$/))) {
    const mo = MONTHS[m[2].slice(0, 3)];
    if (mo && validDay(+m[3], mo, +m[1])) return { granularity: "day", date: `${m[3]}-${pad(mo)}-${pad(+m[1])}` };
  }
  if ((m = words.match(/^([a-z]{3,9})[\s-]+(\d{2}|\d{4})$/))) {
    const mo = MONTHS[m[1].slice(0, 3)];
    if (mo) return { granularity: "month", date: `${fullYear(+m[2])}-${pad(mo)}-01` };
  }
  return null;
}

/** Parse a numeric cell: "1,234", "15.2k", "15,2k", "42.1%", 1234. */
export function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim().toLowerCase().replace(/^["']|["']$/g, "").replace(/\s/g, "");
  if (!s || s === "-" || s === "—" || s === "n/a") return null;
  s = s.replace(/%$/, "");
  let mult = 1;
  if (/[km]$/.test(s)) {
    mult = s.endsWith("k") ? 1e3 : 1e6;
    s = s.slice(0, -1).replace(",", "."); // "15,2k" → 15.2k
  } else {
    s = s.replace(/,(?=\d{3}(\D|$))/g, ""); // thousands separators
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * mult * 100) / 100;
}

/* ---------------- column detection ---------------- */

const PATTERNS: [keyof ParseResult["columns"], RegExp][] = [
  ["date", /^(date|day|time|timestamp|period|month|week|key)$|date|day|time/],
  ["pageviews", /page.?views?|pageviews|^views$|^hits$|pv$/],
  ["bounce_rate", /bounce/],
  ["visitors", /visitors?|uniques?|unique.?visitors?|users|people|^visits$|sessions/],
];

export function detectColumns(headers: string[]): ParseResult["columns"] | null {
  const used = new Set<string>();
  const cols: Partial<ParseResult["columns"]> = {};
  for (const [key, re] of PATTERNS) {
    const h = headers.find((x) => !used.has(x) && re.test(x.toLowerCase().trim()));
    if (h) {
      cols[key] = h;
      used.add(h);
    }
  }
  if (!cols.date || (!cols.visitors && !cols.pageviews)) return null;
  return cols as ParseResult["columns"];
}

/* ---------------- CSV ---------------- */

export function splitCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", "\t", ";"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best
  );
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

/* ---------------- main entry ---------------- */

export function parseImport(text: string, filename = ""): ParseResult {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) throw new Error("The file is empty.");
  const isJson = /\.json$/i.test(filename) || /^[[{]/.test(trimmed);
  let records: Record<string, unknown>[];
  let format: ParseResult["format"];

  if (isJson) {
    format = "json";
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error("That JSON file couldn't be read — check it's valid JSON.");
    }
    records = jsonRecords(data);
  } else {
    format = "csv";
    const grid = splitCsv(trimmed);
    if (grid.length < 2) throw new Error("Need a header row plus at least one data row.");
    const headers = grid[0].map((h) => h.trim());
    records = grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  }
  if (!records.length) throw new Error("No rows found in the file.");

  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const columns = detectColumns(headers);
  if (!columns)
    throw new Error(
      `Couldn't find a date column plus a visitors or page-views column. Columns seen: ${headers.join(", ") || "none"}.`
    );

  const skipped: ParseResult["skipped"] = [];
  const byKey = new Map<string, ParsedRow>();
  let merged = 0;
  records.forEach((r, idx) => {
    const line = format === "csv" ? idx + 2 : idx + 1;
    const d = parseDate(r[columns.date]);
    if (!d) {
      skipped.push({ line, reason: `unreadable date "${String(r[columns.date] ?? "")}"` });
      return;
    }
    const visitors = columns.visitors ? parseNumber(r[columns.visitors]) : null;
    const pageviews = columns.pageviews ? parseNumber(r[columns.pageviews]) : null;
    const bounce = columns.bounce_rate ? parseNumber(r[columns.bounce_rate]) : null;
    if (visitors == null && pageviews == null) {
      skipped.push({ line, reason: "no visitor or page-view number" });
      return;
    }
    const bounce_rate = bounce != null && bounce <= 1 && bounce > 0 && !String(r[columns.bounce_rate!]).includes("%") ? bounce * 100 : bounce;
    const key = d.granularity + d.date;
    const prev = byKey.get(key);
    if (prev) {
      merged++;
      prev.visitors = sumN(prev.visitors, visitors);
      prev.pageviews = sumN(prev.pageviews, pageviews);
    } else {
      byKey.set(key, {
        ...d,
        visitors: visitors == null ? null : Math.round(visitors),
        pageviews: pageviews == null ? null : Math.round(pageviews),
        bounce_rate: bounce_rate == null ? null : Math.round(bounce_rate * 10) / 10,
      });
    }
  });

  const rows = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error("None of the rows had a readable date and number.");
  return { format, columns, rows, skipped, merged };
}

function sumN(a: number | null, b: number | null) {
  if (a == null) return b == null ? null : Math.round(b);
  return a + (b == null ? 0 : Math.round(b));
}

/** Accepts arrays of objects, {data:[...]} wrappers (e.g. the Vercel API), or {date: number} maps. */
function jsonRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    if (data.every((x) => x && typeof x === "object" && !Array.isArray(x))) return data as Record<string, unknown>[];
    throw new Error("JSON array must contain objects (one per day or month).");
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["data", "rows", "results", "items", "timeseries", "series"]) {
      if (Array.isArray(o[k])) return jsonRecords(o[k]);
    }
    const entries = Object.entries(o);
    if (entries.length && entries.every(([k, v]) => parseDate(k) && (typeof v === "number" || typeof v === "string")))
      return entries.map(([date, visitors]) => ({ date, visitors }));
  }
  throw new Error("Unrecognized JSON shape — expected a list of {date, visitors, ...} objects.");
}
