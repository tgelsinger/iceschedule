import { NextResponse } from "next/server";
import { checkAll } from "@/lib/iceTables";

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await checkAll();
  const ok = results.every((r) => r.readable);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 503 });
}
