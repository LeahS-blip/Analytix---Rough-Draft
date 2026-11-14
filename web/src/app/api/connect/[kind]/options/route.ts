import { NextResponse } from "next/server";
import { apiUser, HttpError } from "@/lib/auth";
import { body, handle } from "@/lib/api";
import { provider } from "@/lib/providers";
import { ProviderError, type Fields } from "@/lib/providers/types";

type Ctx = { params: Promise<{ kind: string }> };

/** POST { fields } → the projects / websites / properties those credentials can see. Nothing is stored. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await apiUser();
  const { kind } = await ctx.params;
  const { fields } = await body<{ fields?: Fields }>(req);
  try {
    const p = provider(kind);
    if (!p.options) return NextResponse.json({ choices: [] });
    return NextResponse.json({ choices: await p.options(fields ?? {}) });
  } catch (e) {
    if (e instanceof ProviderError) throw new HttpError(e.status === 401 || e.status === 403 || e.status === 404 ? 400 : e.status >= 500 ? 502 : 400, e.message);
    throw e;
  }
});
