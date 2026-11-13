import { NextResponse } from "next/server";
import { databaseUrl, q } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health → is the database reachable, and how fast?
 * Also reports which region the function runs in and the database's region
 * (the region part of the Neon host only, never the host or credentials), so a
 * cross-region setup is easy to spot.
 */
export async function GET() {
  const started = Date.now();
  const url = databaseUrl();
  // e.g. ep-abc-123-pooler.us-east-2.aws.neon.tech -> "us-east-2.aws"
  const dbRegion = url ? (/\.([a-z]{2}-[a-z]+-\d)\.(aws|azure|gcp)\./.exec(url)?.slice(1, 3).join(".") ?? "unknown") : "local";
  try {
    await q("SELECT 1"); // includes connecting on a cold start
    const timings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      await q("SELECT 1");
      timings.push(Date.now() - t);
    }
    timings.sort((a, b) => a - b);
    return NextResponse.json({
      ok: true,
      functionRegion: process.env.VERCEL_REGION ?? "local",
      dbRegion,
      firstQueryMs: Date.now() - started - timings.reduce((a, b) => a + b, 0),
      queryMs: timings[1],
    });
  } catch {
    return NextResponse.json({ ok: false, functionRegion: process.env.VERCEL_REGION ?? "local", dbRegion }, { status: 503 });
  }
}
