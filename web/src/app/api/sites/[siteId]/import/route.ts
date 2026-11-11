import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { body, handle, int, MAX_IMPORT_BYTES } from "@/lib/api";
import { getSite, recordSnapshot, upsertMetrics } from "@/lib/data";
import { parseImport } from "@/lib/parseImport";

type Ctx = { params: Promise<{ siteId: string }> };

/**
 * POST { text, filename, confirm?: boolean }
 * Without confirm: returns a preview of the parsed rows. With confirm: saves them.
 * The file is always re-parsed on the server, so the client can't inject rows.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const site = await getSite(user.id, int((await ctx.params).siteId));
  const { text, filename = "upload", confirm } = await body<{ text?: string; filename?: string; confirm?: boolean }>(req);
  if (typeof text !== "string") throw new HttpError(400, "No file contents received.");
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new HttpError(413, "File is larger than 5 MB.");

  let parsed;
  try {
    parsed = parseImport(text, filename);
  } catch (e) {
    throw new HttpError(422, e instanceof Error ? e.message : "Couldn't read that file.");
  }

  if (!confirm) return NextResponse.json(parsed);

  const days = parsed.rows.filter((r) => r.granularity === "day");
  const months = parsed.rows.filter((r) => r.granularity === "month");
  const origin = `import:${parsed.format}`;
  if (days.length) await upsertMetrics(site.id, "day", days, origin);
  if (months.length) await upsertMetrics(site.id, "month", months, origin);
  await recordSnapshot({
    siteId: site.id,
    kind: parsed.format,
    label: filename.slice(0, 120),
    status: "ok",
    rows: parsed.rows.length,
    rangeFrom: parsed.rows[0].date,
    rangeTo: parsed.rows.at(-1)!.date,
    visitors: parsed.rows.reduce((a, r) => a + (r.visitors ?? 0), 0),
    raw: text,
  });
  return NextResponse.json({ saved: parsed.rows.length });
});
