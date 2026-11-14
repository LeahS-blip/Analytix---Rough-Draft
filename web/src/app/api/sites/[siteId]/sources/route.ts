import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { apiUser, HttpError } from "@/lib/auth";
import { body, handle, int } from "@/lib/api";
import { getSite } from "@/lib/data";
import { q } from "@/lib/db";
import { encrypt } from "@/lib/secret";
import { runSource } from "@/lib/snapshots";
import { provider } from "@/lib/providers";
import { ProviderError, type Fields } from "@/lib/providers/types";

type Ctx = { params: Promise<{ siteId: string }> };

/**
 * POST { kind, fields, choice } → connects a source and runs the first backfill.
 * kind "push" instead returns a key your own script uses with POST /api/ingest (shown once).
 * (Older clients send Vercel fields at the top level; still accepted.)
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await apiUser();
  const site = await getSite(user.id, int((await ctx.params).siteId));
  const p = await body<{ kind?: string; fields?: Fields; choice?: string | null; token?: string; projectId?: string; projectName?: string; teamId?: string | null; label?: string }>(req);
  const kind = p.kind || "";

  if (kind === "push") {
    const key = "ks_" + randomBytes(24).toString("base64url");
    const label = (p.label || p.fields?.label || "").trim().slice(0, 60) || "Push API";
    const [{ id }] = await q<{ id: number }>(
      "INSERT INTO sources (site_id, kind, label, config_enc, ingest_hash, last_success_at) VALUES ($1, 'push', $2, $3, $4, NULL) RETURNING id",
      [site.id, `Push · ${label}`, await encrypt({}), createHash("sha256").update(key).digest("hex")]
    );
    return NextResponse.json({ id, key, first: { ok: true, rows: 0 } });
  }

  let fields = p.fields ?? {};
  let choice = p.choice ?? null;
  if (kind === "vercel" && !p.fields && p.token) {
    fields = { token: p.token };
    choice = JSON.stringify([p.projectId, p.teamId ?? null, p.projectName ?? p.projectId]);
  }

  let made: { cfg: unknown; label: string };
  try {
    made = await provider(kind).configure(fields, choice);
  } catch (e) {
    if (e instanceof ProviderError) throw new HttpError(e.status >= 500 ? 502 : 400, e.message);
    throw e;
  }
  const [{ id }] = await q<{ id: number }>(
    "INSERT INTO sources (site_id, kind, label, config_enc) VALUES ($1, $2, $3, $4) RETURNING id",
    [site.id, kind, made.label.slice(0, 120), await encrypt(made.cfg)]
  );
  const first = await runSource(id);
  return NextResponse.json({ id, first });
});
