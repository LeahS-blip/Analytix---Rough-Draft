import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { body, handle } from "@/lib/api";
import { createSite } from "@/lib/data";

export const POST = handle(async (req: Request) => {
  const user = await apiUser();
  const { name, timezone } = await body<{ name?: string; timezone?: string }>(req);
  const n = (name ?? "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!n || n.length > 80) throw new HttpError(400, "Give the site a name (e.g. mysite.com).");
  const id = await createSite(user.id, n, timezone || "UTC");
  return NextResponse.json({ id });
});
