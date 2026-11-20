import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { body, handle, int } from "@/lib/api";
import { getSite } from "@/lib/data";
import { readScreenshot, toCsv } from "@/lib/screenshot";

type Ctx = { params: Promise<{ siteId: string }> };

// Reading an image takes a few seconds to ~a minute.
export const maxDuration = 120;

/** GET → { ai } : whether screenshots can be read by AI here (otherwise the browser uses text recognition). */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await apiUser();
  await getSite(user.id, int((await ctx.params).siteId));
  return NextResponse.json({ ai: !!process.env.ANTHROPIC_API_KEY });
});

/**
 * POST { image: base64, mediaType } → { csv, filename, notes, method, provider }.
 * Nothing is saved here: the client sends the CSV through the normal import preview, so the
 * user checks every number before it goes into their history.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  await getSite(user.id, int((await ctx.params).siteId));
  const { image, mediaType } = await body<{ image?: string; mediaType?: string }>(req);
  if (!image || typeof image !== "string") throw new HttpError(400, "No image received.");
  const reading = await readScreenshot(image.replace(/^data:[^,]+,/, ""), mediaType || "image/png");
  if (!reading.is_analytics) throw new HttpError(422, "That doesn't look like an analytics dashboard. Try a screenshot of a traffic chart or table.");
  if (!reading.rows.length) throw new HttpError(422, reading.notes || "No dated numbers found. The screenshot needs visitors or page views per day or month.");
  const provider = reading.provider && reading.provider !== "unknown" ? reading.provider : "dashboard";
  return NextResponse.json({
    csv: toCsv(reading),
    filename: `Screenshot · ${provider} (read by AI${reading.method === "estimated" ? ", estimated from chart" : ""}).csv`,
    notes: reading.notes,
    method: reading.method,
    provider,
  });
});
