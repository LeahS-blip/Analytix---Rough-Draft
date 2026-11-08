import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { body, handle, int } from "@/lib/api";
import { getSourceForUser } from "@/lib/data";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ sourceId: string }> };

/** PATCH { active } — pause / resume daily snapshots for this source. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const src = getSourceForUser(user.id, int((await ctx.params).sourceId));
  const { active } = await body<{ active?: boolean }>(req);
  db().prepare("UPDATE sources SET active = ? WHERE id = ?").run(active ? 1 : 0, src.id);
  return NextResponse.json({ ok: true });
});

/** DELETE — disconnects the source. Data it already saved stays in your history. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const src = getSourceForUser(user.id, int((await ctx.params).sourceId));
  db().prepare("DELETE FROM sources WHERE id = ?").run(src.id);
  return NextResponse.json({ ok: true });
});
