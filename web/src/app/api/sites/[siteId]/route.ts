import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { body, handle, int } from "@/lib/api";
import { deleteSite, getSite, updateSite } from "@/lib/data";

type Ctx = { params: Promise<{ siteId: string }> };

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const site = await getSite(user.id, int((await ctx.params).siteId));
  const p = await body<{ name?: string; timezone?: string; auto_snapshot?: boolean }>(req);
  if (p.name !== undefined && !p.name.trim()) throw new HttpError(400, "Site name can't be empty.");
  await updateSite(site.id, { ...p, name: p.name?.trim() });
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const site = await getSite(user.id, int((await ctx.params).siteId));
  await deleteSite(site.id);
  return NextResponse.json({ ok: true });
});
