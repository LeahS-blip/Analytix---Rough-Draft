import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { handle, int } from "@/lib/api";
import { getSourceForUser } from "@/lib/data";
import { runSource } from "@/lib/snapshots";

type Ctx = { params: Promise<{ sourceId: string }> };

/** POST — capture a snapshot now. */
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const src = getSourceForUser(user.id, int((await ctx.params).sourceId));
  const r = await runSource(src.id);
  if (!r.ok) throw new HttpError(502, r.error || "Snapshot failed.");
  return NextResponse.json(r);
});
