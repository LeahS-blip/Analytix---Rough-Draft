import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listSites } from "@/lib/data";
import { NewSiteForm } from "@/components/NewSiteForm";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const user = await requireUser();
  const sites = listSites(user.id);
  if (sites.length) redirect(`/app/${sites[0].id}/overview`);
  return <NewSiteForm first />;
}
