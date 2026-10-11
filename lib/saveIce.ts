import { sql } from "@/lib/db";
import { TARGETS, checkAll, type IceType, type TableCheck } from "@/lib/iceTables";

type SlotRow = {
  source: string;
  ice_type: IceType;
  slot_key: string;
  ice_date: string | null;
  start_time: string | null;
  end_time: string | null;
  rink: string | null;
  duration_minutes: number | null;
  details: Record<string, string>;
};

export type SaveResult = { source: string; readable: boolean; saved: number; markedUnavailable: number; error: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const todayRegina = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Regina" }).format(new Date());

const pick = (row: Record<string, string>, re: RegExp) => {
  const k = Object.keys(row).find((h) => re.test(h));
  return k && row[k] ? row[k] : null;
};

// Dates on the site look like "Saturday, October 10" (no year). Pick the year that puts the date
// closest to today, so listings around New Year land in the right year.
export function parseIceDate(s: string | null): string | null {
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1, day = +m[2];
  if (m[3]) return ymd(+m[3], month, day);
  const today = todayRegina(), y = +today.slice(0, 4);
  const dist = (yr: number) => Math.abs(Date.parse(ymd(yr, month, day)) - Date.parse(today));
  return ymd([y - 1, y, y + 1].reduce((a, b) => (dist(b) < dist(a) ? b : a)), month, day);
}

// "135", "120 min", "2 hrs", "1h 30m" -> minutes
export function parseDuration(s: string | null): number | null {
  if (!s) return null;
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/i), min = s.match(/(\d+)\s*m/i);
  if (h) return Math.round(+h[1] * 60 + (min ? +min[1] : 0));
  const n = s.match(/\d+/);
  return n ? +n[0] : null;
}

// "4:30 PM" + 135 -> "6:45 PM"
export function addMinutes(time: string | null, minutes: number | null): string | null {
  const m = time?.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!m || minutes == null) return null;
  const start = ((+m[1] % 12) + (m[3].toLowerCase() === "p" ? 12 : 0)) * 60 + +m[2];
  const t = (start + minutes) % 1440, h = Math.floor(t / 60);
  return `${h % 12 || 12}:${pad(t % 60)} ${h < 12 ? "AM" : "PM"}`;
}

export function toSlot(source: string, ice_type: IceType, row: Record<string, string>): SlotRow {
  const rawDate = pick(row, /^date$/i), start = pick(row, /^start/i), rink = pick(row, /^(location|rink|arena)/i);
  const ice_date = parseIceDate(rawDate), duration_minutes = parseDuration(pick(row, /^duration/i));
  return {
    source,
    ice_type,
    // Identity of a slot: same day, start and rink = same ice, even if cost/status changes.
    slot_key: [ice_date ?? rawDate, start, rink].map((v) => (v ?? "").toLowerCase()).join("|"),
    ice_date,
    start_time: start,
    end_time: addMinutes(start, duration_minutes),
    rink,
    duration_minutes,
    details: row,
  };
}

async function saveTable(check: TableCheck, seenAt: string): Promise<SaveResult> {
  const base = { source: check.key, readable: check.readable, saved: 0, markedUnavailable: 0, error: check.error };
  // Never mark listings unavailable from a failed read — only a readable table is authoritative.
  if (!check.readable || !check.table) return base;

  const iceType = TARGETS.find((t) => t.key === check.key)!.iceType;
  const slots = [...new Map(check.table.rows.map((r) => toSlot(check.key, iceType, r)).map((s) => [s.slot_key, s])).values()];
  if (slots.length) {
    await sql`
      INSERT INTO ice_availability (source, ice_type, slot_key, ice_date, start_time, end_time, rink, duration_minutes, details, first_seen_at, last_seen_at, is_available)
      SELECT x.*, ${seenAt}::timestamptz, ${seenAt}::timestamptz, true
      FROM jsonb_to_recordset(${JSON.stringify(slots)}::jsonb) AS x(
        source text, ice_type text, slot_key text, ice_date date, start_time text, end_time text, rink text, duration_minutes int, details jsonb)
      ON CONFLICT (source, slot_key) DO UPDATE SET
        ice_type = EXCLUDED.ice_type, ice_date = EXCLUDED.ice_date, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, rink = EXCLUDED.rink,
        duration_minutes = EXCLUDED.duration_minutes, details = EXCLUDED.details,
        last_seen_at = EXCLUDED.last_seen_at, is_available = true`;
  }
  const gone = await sql`
    UPDATE ice_availability SET is_available = false
    WHERE source = ${check.key} AND is_available AND last_seen_at < ${seenAt}::timestamptz
    RETURNING id`;
  return { ...base, saved: slots.length, markedUnavailable: gone.length };
}

export async function saveAll(): Promise<SaveResult[]> {
  const seenAt = new Date().toISOString();
  const checks = await checkAll();
  return Promise.all(checks.map((c) => saveTable(c, seenAt).catch((e) => ({
    source: c.key, readable: c.readable, saved: 0, markedUnavailable: 0, error: e instanceof Error ? e.message : String(e),
  }))));
}
