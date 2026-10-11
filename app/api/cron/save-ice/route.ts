import { NextResponse } from "next/server";
import { saveAll } from "@/lib/saveIce";

export const dynamic = "force-dynamic";

// Called by Vercel Cron (see vercel.json). When CRON_SECRET is set, Vercel sends it as a Bearer token.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await saveAll();
  const ok = results.every((r) => r.readable && !r.error);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 503 });
}
