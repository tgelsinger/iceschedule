import { sql } from "@/lib/db";
import { TARGETS } from "@/lib/iceTables";

export type NotifyResult = { notified: number; skipped: string | null; error: string | null };

type NewSlot = {
  id: number;
  source: string;
  ice_date: string | null;
  start_time: string | null;
  end_time: string | null;
  rink: string | null;
  duration_minutes: number | null;
  details: Record<string, string>;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "?";
const line = (s: NewSlot) =>
  [fmtDate(s.ice_date), [s.start_time, s.end_time].filter(Boolean).join("–"), s.rink, s.duration_minutes && `${s.duration_minutes} min`,
    s.details.Cost, s.details.Status].filter(Boolean).join(" · ");

// Emails every available slot that has never been notified. notified_at is claimed atomically *before*
// sending, so overlapping runs can't double-send; on send failure the claim is released for the next run.
// A slot that drops off and reappears keeps its notified_at, so it is never emailed twice.
export async function notifyNew(): Promise<NotifyResult> {
  const { RESEND_API_KEY: key, NOTIFY_EMAIL_TO: to } = process.env;
  if (!key || !to) return { notified: 0, skipped: "RESEND_API_KEY or NOTIFY_EMAIL_TO not set", error: null };

  const slots = (await sql`
    UPDATE ice_availability SET notified_at = now()
    WHERE notified_at IS NULL AND is_available
    RETURNING id, source, ice_date::text, start_time, end_time, rink, duration_minutes, details`) as NewSlot[];
  if (!slots.length) return { notified: 0, skipped: null, error: null };

  const groups = TARGETS.map((t) => ({ t, rows: slots.filter((s) => s.source === t.key).sort((a, b) => (a.ice_date ?? "").localeCompare(b.ice_date ?? "")) }))
    .filter((g) => g.rows.length);
  const subject = `New ice: ${groups.map((g) => `${g.rows.length} ${g.t.iceType === "practice" ? "practice" : "game swap"}`).join(", ")}`;
  const text = groups.map((g) => `${g.t.label} (${g.t.url})\n${g.rows.map((s) => `- ${line(s)}`).join("\n")}`).join("\n\n");
  const html = groups.map((g) => `<h3><a href="${g.t.url}">${esc(g.t.label)}</a></h3><ul>${g.rows.map((s) => `<li>${esc(line(s))}</li>`).join("")}</ul>`).join("");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_EMAIL_FROM || "PSMHA Ice <onboarding@resend.dev>",
        to: to.split(",").map((s) => s.trim()),
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
    return { notified: slots.length, skipped: null, error: null };
  } catch (e) {
    await sql`UPDATE ice_availability SET notified_at = NULL WHERE id = ANY(${slots.map((s) => s.id)}::bigint[])`;
    return { notified: 0, skipped: null, error: e instanceof Error ? e.message : String(e) };
  }
}
