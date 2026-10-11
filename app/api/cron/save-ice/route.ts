import { NextResponse } from "next/server";
import { notifyNew } from "@/lib/notify";
import { saveAll } from "@/lib/saveIce";

export const dynamic = "force-dynamic";

// Called by Vercel Cron (see vercel.json). When CRON_SECRET is set, Vercel sends it as a Bearer token.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await saveAll();
  // Runs even if one source failed: the other source's new rows are still worth sending.
  const notify = await notifyNew().catch((e) => ({ notified: 0, skipped: null, error: e instanceof Error ? e.message : String(e) }));
  const ok = results.every((r) => r.readable && !r.error) && !notify.error;
  return NextResponse.json({ ok, results, notify }, { status: ok ? 200 : 503 });
}
