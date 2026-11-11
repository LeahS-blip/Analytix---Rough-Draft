import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { body, handle, int } from "@/lib/api";
import { getSite } from "@/lib/data";
import { q } from "@/lib/db";
import { encrypt } from "@/lib/secret";
import { runSource } from "@/lib/snapshots";
import type { VercelConfig } from "@/lib/vercel";

type Ctx = { params: Promise<{ siteId: string }> };

/** POST { kind: 'vercel', token, projectId, projectName, teamId } → connects and runs the first backfill. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const site = await getSite(user.id, int((await ctx.params).siteId));
  const p = await body<{ kind?: string; token?: string; projectId?: string; projectName?: string; teamId?: string | null }>(req);
  if (p.kind !== "vercel") throw new HttpError(400, "Only Vercel can be connected right now.");
  if (!p.token?.trim() || !p.projectId) throw new HttpError(400, "Pick a Vercel project first.");

  const cfg: VercelConfig = {
    token: p.token.trim(),
    projectId: p.projectId,
    projectName: p.projectName || p.projectId,
    teamId: p.teamId || null,
  };
  const [{ id }] = await q<{ id: number }>(
    "INSERT INTO sources (site_id, kind, label, config_enc) VALUES ($1, 'vercel', $2, $3) RETURNING id",
    [site.id, `Vercel · ${cfg.projectName}`, await encrypt(cfg)]
  );
  const first = await runSource(id);
  return NextResponse.json({ id, first });
});
