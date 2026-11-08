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
    site = getSite(user.id, Number(siteId));
  } catch (e) {
    if (e instanceof HttpError) notFound();
    throw e;
  }
  // node:sqlite rows have a null prototype; React only serializes plain objects to the client.
  const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return (
    <Dashboard
      view={view as View}
      user={{ email: user.email }}
      site={plain(site)}
      sites={plain(listSites(user.id))}
      daily={plain(dailyMetrics(site.id))}
      monthly={plain(monthlyMetrics(site.id))}
      sources={plain(listSources(site.id))}
      snapshots={plain(listSnapshots(site.id))}
    />
  );
}
