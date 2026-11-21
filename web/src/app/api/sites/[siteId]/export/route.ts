import { apiUser } from "@/lib/auth";
import { handle, int } from "@/lib/api";
import { dailyMetrics, getSite, monthlyMetrics } from "@/lib/data";
import { q } from "@/lib/db";

const DIM_LABEL: Record<string, string> = {
  requestPath: "page",
  referrerHostname: "referrer",
  country: "country",
  deviceType: "device",
  browser: "browser",
  os: "os",
  utmSource: "utm_source",
  utmCampaign: "utm_campaign",
};

type Ctx = { params: Promise<{ siteId: string }> };

const cell = (v: unknown) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET ?granularity=day|month|breakdowns → CSV download */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const site = await getSite(user.id, int((await ctx.params).siteId));
  const param = new URL(req.url).searchParams.get("granularity");
  const safe = site.name.replace(/[^a-z0-9.-]+/gi, "_");

  // every kept breakdown row: which page / referrer / country / ... and how many, per period
  if (param === "breakdowns") {
    const rows = await q<{ dimension: string; date_from: string; date_to: string; key: string; visitors: number | null; pageviews: number | null }>(
      `SELECT dimension, date_from, date_to, key, visitors, pageviews FROM breakdowns
       WHERE site_id = $1 AND dimension <> 'spikeReferrer' ORDER BY date_from, dimension, visitors DESC NULLS LAST`,
      [site.id]
    );
    const lines = ["kind,from,to,name,visitors,page_views", ...rows.map((r) => [DIM_LABEL[r.dimension] ?? r.dimension, r.date_from, r.date_to, r.key, r.visitors, r.pageviews].map(cell).join(","))];
    return new Response(lines.join("\n") + "\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}-breakdowns.csv"` },
    });
  }

  const g = param === "day" ? "day" : "month";
  const lines =
    g === "day"
      ? [
          "date,visitors,page_views,bounce_rate,avg_visit_seconds",
          ...(await dailyMetrics(site.id)).map((r) =>
            [r.date, r.visitors, r.pageviews, r.bounce_rate, r.avg_duration == null ? null : Math.round(r.avg_duration)].map(cell).join(",")
          ),
        ]
      : [
          "month,visitors,page_views,bounce_rate,days_of_data",
          ...(await monthlyMetrics(site.id)).map((r) =>
            [r.month, r.visitors, r.pageviews, r.bounce_rate == null ? null : r.bounce_rate.toFixed(1), r.granularity === "day" ? r.days : "monthly total"]
              .map(cell)
              .join(",")
          ),
        ];
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}-${g}ly-history.csv"`.replace("dayly", "daily"),
    },
  });
});
