import { apiUser } from "@/lib/auth";
import { handle, int } from "@/lib/api";
import { dailyMetrics, getSite, monthlyMetrics } from "@/lib/data";

type Ctx = { params: Promise<{ siteId: string }> };

const cell = (v: unknown) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET ?granularity=day|month → CSV download */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const site = getSite(user.id, int((await ctx.params).siteId));
  const g = new URL(req.url).searchParams.get("granularity") === "day" ? "day" : "month";
  const lines =
    g === "day"
      ? [
          "date,visitors,page_views,bounce_rate",
          ...dailyMetrics(site.id).map((r) => [r.date, r.visitors, r.pageviews, r.bounce_rate].map(cell).join(",")),
        ]
      : [
          "month,visitors,page_views,bounce_rate,days_of_data",
          ...monthlyMetrics(site.id).map((r) =>
            [r.month, r.visitors, r.pageviews, r.bounce_rate == null ? null : r.bounce_rate.toFixed(1), r.granularity === "day" ? r.days : "monthly total"]
              .map(cell)
              .join(",")
          ),
        ];
  const safe = site.name.replace(/[^a-z0-9.-]+/gi, "_");
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}-${g}ly-history.csv"`.replace("dayly", "daily"),
    },
  });
});
