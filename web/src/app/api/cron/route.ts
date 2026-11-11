import { NextResponse } from "next/server";
import { runDueSources } from "@/lib/snapshots";

/**
 * For hosts without a long-running process (e.g. Vercel Cron).
 * Requires CRON_SECRET; send it as "Authorization: Bearer <secret>".
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runDueSources());
}
