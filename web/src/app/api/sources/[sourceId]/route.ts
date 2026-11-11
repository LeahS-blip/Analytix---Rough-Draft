import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { body, handle, int } from "@/lib/api";
import { getSourceForUser } from "@/lib/data";
import { q } from "@/lib/db";

type Ctx = { params: Promise<{ sourceId: string }> };

/** PATCH { active } — pause / resume daily snapshots for this source. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const src = await getSourceForUser(user.id, int((await ctx.params).sourceId));
  const { active } = await body<{ active?: boolean }>(req);
  await q("UPDATE sources SET active = $1 WHERE id = $2", [!!active, src.id]);
  return NextResponse.json({ ok: true });
});

/** DELETE — disconnects the source. Data it already saved stays in your history. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const src = await getSourceForUser(user.id, int((await ctx.params).sourceId));
  await q("DELETE FROM sources WHERE id = $1", [src.id]);
  return NextResponse.json({ ok: true });
});
