import { redirect } from "next/navigation";

export default async function SiteRoot({ params }: { params: Promise<{ siteId: string }> }) {
  redirect(`/app/${(await params).siteId}/overview`);
}
