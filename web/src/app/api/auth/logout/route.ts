import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { handle } from "@/lib/api";

export const POST = handle(async () => {
  await destroySession();
  return NextResponse.json({ ok: true });
});
