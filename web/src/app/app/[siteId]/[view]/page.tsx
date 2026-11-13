import { notFound } from "next/navigation";
import { requireUser, HttpError } from "@/lib/auth";
import { breakdownSummary, dailyMetrics, getSite, listSites, listSnapshots, listSources, monthlyMetrics } from "@/lib/data";
import { Dashboard } from "@/components/Dashboard";
import { VIEWS, type View } from "@/components/views";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ siteId: string; view: string }> }) {
  const user = await requireUser();
  const { siteId, view } = await params;
  const id = Number(siteId);
  if (!(VIEWS as readonly string[]).includes(view) || !Number.isInteger(id) || id <= 0) notFound();

  // One round trip for everything: the ownership check runs alongside the data queries.
  // Nothing is sent to the browser unless the site belongs to this user.
  const [site, sites, daily, monthly, sources, snapshots, breakdown] = await Promise.all([
    getSite(user.id, id).catch((e) => {
      if (e instanceof HttpError) return null;
      throw e;
    }),
    listSites(user.id),
    dailyMetrics(id),
    monthlyMetrics(id),
    listSources(id),
    listSnapshots(id),
    breakdownSummary(id),
  ]);
  if (!site) notFound();

  // Turn Dates and driver row objects into plain JSON before handing them to the client component.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return (
    <Dashboard
      view={view as View}
      user={{ email: user.email }}
      site={plain(site)}
      sites={plain(sites)}
      daily={plain(daily)}
      monthly={plain(monthly)}
      sources={plain(sources)}
      snapshots={plain(snapshots)}
      breakdown={plain(breakdown)}
    />
  );
}
