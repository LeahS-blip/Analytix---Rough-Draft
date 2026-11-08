import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { body, handle } from "@/lib/api";
import { listProjects, VercelError } from "@/lib/vercel";

/** POST { token } → projects that token can see (token is not stored here). */
export const POST = handle(async (req: Request) => {
  await apiUser();
  const { token } = await body<{ token?: string }>(req);
  if (!token?.trim()) throw new HttpError(400, "Paste a Vercel access token.");
  try {
    return NextResponse.json({ projects: await listProjects(token.trim()) });
  } catch (e) {
    if (e instanceof VercelError) throw new HttpError(e.status === 401 || e.status === 403 ? 400 : 502, e.message);
    throw new HttpError(502, "Couldn't reach Vercel. Check your connection and try again.");
  }
});
