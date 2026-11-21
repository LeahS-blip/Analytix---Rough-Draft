import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { handle, int } from "@/lib/api";
import { exploreDims, exploreHistory, exploreItems, getSite } from "@/lib/data";

type Ctx = { params: Promise<{ siteId: string }> };

const DIMS = ["requestPath", "referrerHostname", "country", "deviceType", "browser", "os", "utmSource", "utmCampaign"];

/**
 * GET                    → which breakdowns have data
 * GET ?dim=requestPath   → every page kept, with totals and trend
 * GET ?dim=...&key=/blog → that one page's history, day by day
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const site = await getSite(user.id, int((await ctx.params).siteId));
  const u = new URL(req.url);
  const dim = u.searchParams.get("dim");
  const key = u.searchParams.get("key");
  if (!dim) return NextResponse.json({ dims: await exploreDims(site.id) });
  if (!DIMS.includes(dim)) throw new HttpError(400, "Unknown breakdown.");
  if (key == null) return NextResponse.json({ items: await exploreItems(site.id, dim) });
  return NextResponse.json(await exploreHistory(site.id, dim, key.slice(0, 300)));
});
