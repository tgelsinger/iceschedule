# AGENTS.md — Repo memory

This is the reference for anyone, human or agent, working in this repo. Read it before you make changes.
**After any change, update the "Current state" sections if they no longer match, and add an entry to the Change log.**

## What this is

**PSMHA Ice Check** (`psmha-ice-check`) is a Next.js app. It checks whether two tables on the PSMHA (SportsEngine) site can be read, and shows their current listings:

| Key | Label | Ice type | Source | How it's located |
| --- | --- | --- | --- | --- |
| `iceforsale` | Ice For Sale | `practice` | https://www.psmha.ca/iceforsale | The only `table.dataTable` on the page |
| `swap120` | 120+ min Ice Swap Board | `game_swap` | https://www.psmha.ca/iceschedule | The `.pageElement.tableElement` whose `h3` matches `/^120\+\s*min/i` |

The app parses nothing else on either page. A table counts as **readable** when the page returns HTTP 200 and the table is found with its column headers. An empty table still counts as readable.

A Vercel Cron job (twice a day) also saves the listings to the Neon Postgres table `ice_availability` (see **Database**) and emails any newly added listings (see **Notifications**).

## Stack

- Next.js 15 (App Router), React 19, TypeScript (strict)
- `cheerio` parses the HTML on the server
- `@neondatabase/serverless`: the Neon Postgres driver (HTTP)
- Deploys to Vercel. `vercel.json` only defines the cron job. `next.config` is not used.
- Path alias: `@/*` resolves to the repo root

## Layout

```
app/
  layout.tsx          Root layout and metadata
  page.tsx            "/" status page (server component, force-dynamic). Runs checkAll() and renders a card plus a table for each target
  globals.css         Styles (.card, .badge, .ok/.bad, .muted, .scroll)
  api/check/route.ts  GET /api/check returns JSON { ok, results }, with status 200, or 503 if any table isn't readable. Read-only, writes nothing
  api/cron/save-ice/route.ts  GET runs saveAll() then notifyNew(), and returns JSON { ok, results: SaveResult[], notify: NotifyResult }, with status 200, or 503 on any read, DB or email error. Returns 401 if CRON_SECRET is set and the Bearer token doesn't match
lib/
  iceTables.ts        TARGETS (each one sets an iceType), fetching and parsing (checkTable, checkAll), types TableCheck, ParsedTable and IceType
  saveIce.ts          Maps parsed rows to ice_availability and upserts them (saveAll). Parsers: parseIceDate, parseDuration, addMinutes, toSlot
  notify.ts           notifyNew(): emails never-notified available slots via Resend, deduped by ice_availability.notified_at
  db.ts               Neon client: exports `sql` tagged template. Throws on import if DATABASE_URL is missing
vercel.json           Cron: /api/cron/save-ice at 05:00 and 20:00 Saskatchewan time (11:00 and 02:00 UTC). These are two once-a-day entries, `?run=am` and `?run=pm`; the route ignores the query
```

## Key behaviour (lib/iceTables.ts)

- Fetches use `cache: "no-store"`, a 10 s timeout and a custom User-Agent (`PSMHA-ice-checker/1.0`).
- SportsEngine markup: `.pageElement.tableElement > h3 + .tableWrapper > table.dataTable`.
- Each row is returned as `Record<header, cellText>`, with whitespace collapsed.
- Error strings: `HTTP <status>`, `Table not found — page layout may have changed`, `Table found but no headers parsed`, or the error message from the fetch.
- Times are displayed in the `America/Regina` time zone.

## Database

- Client: `import { sql } from "@/lib/db"`, then ``await sql`SELECT ... WHERE id = ${id}` ``. Values in the template are passed as parameters.
- Env: `DATABASE_URL` is the Neon connection string. Locally it goes in `.env.local` (gitignored). On Vercel, set it as a project env var.
- Env: `CRON_SECRET` is optional but recommended on Vercel. When it's set, Vercel Cron sends it as `Authorization: Bearer …` and the save route rejects requests without it. When it isn't set, the route is open to anyone.
- The connection string must start with `postgresql://`. A malformed scheme fails with `Wrong URL scheme or missing user, host or database`.
- The schema is managed by hand in Neon. The repo has no migrations.

### Table `public.ice_availability`

| Column | Type | Source |
| --- | --- | --- |
| `id` | bigserial PK | |
| `source` | text NOT NULL | Target key: `iceforsale` or `swap120` |
| `ice_type` | text NOT NULL | Comes from the target's `iceType`: `practice` for Ice For Sale, `game_swap` for the 120+ min swap board. Allowed values are enforced by CHECK `ice_availability_ice_type_check` |
| `slot_key` | text NOT NULL | `ice_date\|start_time\|rink`, lowercased. `UNIQUE (source, slot_key)` |
| `ice_date` | date | `Date` column, e.g. "Saturday, October 10". The site gives no year, so the year closest to today (Regina time) is used |
| `start_time` | text | `Start Time`, as displayed, e.g. "4:30 PM" |
| `end_time` | text | Start plus duration, same format |
| `rink` | text | `Location` |
| `duration_minutes` | int | `Duration`, e.g. "135" |
| `details` | jsonb | The whole raw row (`Cost`, `Status`, `Posted`, and so on) |
| `first_seen_at` / `last_seen_at` | timestamptz | When the slot was first and last seen |
| `is_available` | bool | `false` once the slot drops off the site |
| `notified_at` | timestamptz, nullable | When the new-listing email for this slot was sent. `NULL` means not yet emailed. Rows that existed before notifications were added were backfilled to `first_seen_at` |

### Save semantics (`saveAll`)

- Each run uses one `seenAt` timestamp. Rows are upserted in one statement using `jsonb_to_recordset`, with `ON CONFLICT (source, slot_key)`, which refreshes the fields, sets `last_seen_at`, and sets `is_available = true`.
- Afterwards, rows from that source with `last_seen_at < seenAt` are set to `is_available = false`. Rows are never deleted.
- A source that isn't readable is skipped completely, so a failed fetch never marks listings unavailable. A readable, empty table does mark them all unavailable.
- Column headers are matched by regex (`/^date$/`, `/^start/`, `/^duration/`, `/^(location|rink|arena)/`), so small header changes still work.
- Current headers: Ice For Sale has `Date, Start Time, Duration, Location, Cost`. The swap board has `Date, Day of Week, Start Time, Duration, Location, Status, Posted`.

## Notifications (lib/notify.ts)

- After saving, `notifyNew()` sends **one** email listing every row with `notified_at IS NULL AND is_available`, grouped by source.
- Dedup: it claims rows first (`UPDATE … SET notified_at = now() … RETURNING`) and then sends. If the send fails, it sets the claimed rows back to `NULL`, and the next run retries them. A slot that drops off and later reappears keeps its `notified_at`, so it's never emailed twice. A slot is "new" when its `(source, slot_key)` is new, so a changed date, start time or rink counts as a new slot.
- It only ever notifies about additions. Removals and changes to `details` (cost, status) don't send anything.
- Sent via the Resend HTTP API with `fetch`, with no SDK dependency. Env: `RESEND_API_KEY` and `NOTIFY_EMAIL_TO` (comma-separated). Optional `NOTIFY_EMAIL_FROM`, default `PSMHA Ice <onboarding@resend.dev>`; that sender can only deliver to the Resend account owner's own address until you verify a domain. If either required var is missing, notifications are skipped (`notify.skipped`) and no rows are claimed.

## Deployment

- GitHub `tgelsinger/iceschedule` is connected to a single Vercel project, `iceschedule`, under the `bigt2` team. A second project, `psmhaiceschedule`, was a duplicate and was deleted on 2026-10-11.
- Pushing a non-`main` branch creates a **Preview** deployment, and pushing to `main` creates **Production**. Vercel runs cron jobs **only on Production**, so the save cron job runs only once this code is on `main`.
- Every deployment URL, preview and production, is behind Vercel Authentication (SSO). Calls from outside, such as `curl`, get a 302 redirect to `vercel.com/sso-api`. Vercel's own cron calls aren't affected.
- Env vars needed in the project: `DATABASE_URL`, plus `CRON_SECRET`, which is recommended, and `RESEND_API_KEY` and `NOTIFY_EMAIL_TO` for emails. `lib/db.ts` throws on import if `DATABASE_URL` is missing, so a missing value makes the build fail during "Collecting page data".
- To confirm saves are running, check that `max(last_seen_at)` in `ice_availability` moves forward after each run (11:00 and 02:00 UTC), or look at the cron logs in Vercel → Project → Settings → Cron Jobs.
- `npm warn deprecated whatwg-encoding@3.1.1` during install comes from `cheerio → encoding-sniffer → whatwg-encoding`. It's harmless and we can't act on it until cheerio updates.

### Deployment status (2026-10-11 15:14 UTC)

- Production (`iceschedule`) is `9855ebe` and built successfully at 15:13 UTC. The alias is `iceschedule-bigt2.vercel.app`, behind SSO. It includes `/api/cron/save-ice` and the old single cron job at 12:00 UTC. The new 05:00/20:00 schedule takes effect only after it's deployed to `main`.
- Not yet verified that the cron job has written to the database. The first write from Vercel will be from a manual run (Vercel → Settings → Cron Jobs → Run) or the first scheduled run after the new schedule is deployed.
- `psmhaiceschedule` still built a failed preview of `9855ebe` at 15:13 UTC, while it was being deleted.

## Commands

```sh
npm install
npm run dev     # local dev
npm run build   # production build
npm start
```

There are no tests and no lint config yet. To run a save locally, start `npm run dev` and then `curl localhost:3000/api/cron/save-ice`. If `CRON_SECRET` is set in `.env.local`, add `-H "Authorization: Bearer $CRON_SECRET"`.

## Conventions

- Keep the scraping narrow: read only the two target tables.
- Write server components and route handlers with `export const dynamic = "force-dynamic"` so the data is always live.
- Code style is small, dense TypeScript, with comments only where the reason isn't obvious.
- Only the cron route writes to the database. Pages and `/api/check` stay read-only.
- Vercel Hobby only allows each cron entry to run once a day, so separate run times are separate entries. Hobby may also fire the job at any point within the scheduled hour (for example 05:00–05:59). If you need exact times or a higher frequency, use Pro or an external scheduler that calls the route with the secret.
- Cron schedules are in UTC. Saskatchewan (`America/Regina`) is UTC−6 all year, with no daylight saving, so the conversion never changes.

## Change log

Newest first. Use the format `YYYY-MM-DD: summary (files)`.

- **2026-10-11**: Added email notifications for new listings. Added `lib/notify.ts`, which the cron route calls after `saveAll()`. In Neon, added `ice_availability.notified_at` (timestamptz, nullable) and backfilled the 3 existing rows to `first_seen_at`. Tested locally: with no new rows nothing is sent, and when the send fails (fake key, Resend 401) the claim is released. A real email was sent through Resend (test sender `onboarding@resend.dev`), and a second run right after sent nothing. (`lib/notify.ts`, `app/api/cron/save-ice/route.ts`, `AGENTS.md`)
- **2026-10-11**: Changed the cron schedule from once a day at 12:00 UTC to twice a day, at 05:00 and 20:00 Saskatchewan time (`0 11 * * *` and `0 2 * * *` UTC). (`vercel.json`, `AGENTS.md`)
- **2026-10-11**: Merged `add-neon-db` into `main` (fast-forward to `9855ebe`). The `iceschedule` Production deployment succeeded. (`AGENTS.md`)
- **2026-10-11**: Deleted the duplicate Vercel project `psmhaiceschedule`. Only `iceschedule` remains. (`AGENTS.md`)
- **2026-10-11**: Checked the deployment after the user redeployed. Production on both Vercel projects is still `4760d84` and has no save route. The `3aca5a6` preview built on `iceschedule` and failed on `psmhaiceschedule`. Previews are behind SSO and don't run crons, so nothing has saved from Vercel yet. Added the Deployment section and documented the `whatwg-encoding` warning. (`AGENTS.md`)
- **2026-10-11**: Added the `ice_type` column to `ice_availability` (text NOT NULL, CHECK in (`practice`, `game_swap`)), ran in Neon as a transaction. The 3 existing `iceforsale` rows were backfilled to `practice`. `TARGETS` now has `iceType` and the upsert writes it. To add a new ice type, update the CHECK constraint and the `IceType` union together. (`lib/iceTables.ts`, `lib/saveIce.ts`, `AGENTS.md`)
- **2026-10-11**: Listings are now saved to Neon `ice_availability`. Added `lib/saveIce.ts`, which upserts by `(source, slot_key)` and marks missing slots unavailable, plus the cron route `app/api/cron/save-ice/route.ts` and a daily cron in `vercel.json`. The table was created by hand in Neon before this change. Tested against live data: 3 Ice For Sale rows saved, re-runs don't create duplicates, and a stale row was marked unavailable. Also fixed a `ppostgresql://` typo in the local `.env.local` `DATABASE_URL`. (`lib/saveIce.ts`, `app/api/cron/save-ice/route.ts`, `vercel.json`, `AGENTS.md`)
- **2026-10-11**: Added this AGENTS.md as the repo memory.
- **2026-10-11**: Added the Neon database helper `lib/db.ts`, which exports `sql` from `neon(DATABASE_URL)`. Added `.env*.local` to `.gitignore`.
- **2026-10-11**: Installed `@neondatabase/serverless` ^1.2.0 (`package.json`, `package-lock.json`). `npm install` reported audit warnings, which are not yet addressed.
- **2026-10-11**: Initial commit (`4760d84`): the Next.js app, the status page, `/api/check`, and the cheerio table parser in `lib/iceTables.ts`.
- **2026-10-11**: Repo initialized (`ae3f40d`).
