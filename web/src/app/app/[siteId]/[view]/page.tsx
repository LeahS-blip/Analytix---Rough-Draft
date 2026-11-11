import { notFound } from "next/navigation";
import { requireUser, HttpError } from "@/lib/auth";
import { dailyMetrics, getSite, listSites, listSnapshots, listSources, monthlyMetrics } from "@/lib/data";
import { Dashboard } from "@/components/Dashboard";
import { VIEWS, type View } from "@/components/views";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ siteId: string; view: string }> }) {
  const user = await requireUser();
  const { siteId, view } = await params;
  if (!(VIEWS as readonly string[]).includes(view)) notFound();
  let site;
  try {
    site = await getSite(user.id, Number(siteId));
  } catch (e) {
    if (e instanceof HttpError) notFound();
    throw e;
  }
  // Turn Dates and driver row objects into plain JSON before handing them to the client component.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const [sites, daily, monthly, sources, snapshots] = await Promise.all([
    listSites(user.id),
    dailyMetrics(site.id),
    monthlyMetrics(site.id),
    listSources(site.id),
    listSnapshots(site.id),
  ]);
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
    />
  );
}
