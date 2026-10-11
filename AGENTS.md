# AGENTS.md — Repo memory

This is the reference for anyone, human or agent, working in this repo. Read it before you make changes.
**After any change, update the "Current state" sections if they no longer match, and add an entry to the Change log.**

## What this is

**PSMHA Ice Check** (`psmha-ice-check`) is a Next.js app. It checks whether two tables on the PSMHA (SportsEngine) site can be read, and shows their current listings:

| Key | Label | Source | How it's located |
| --- | --- | --- | --- |
| `iceforsale` | Ice For Sale | https://www.psmha.ca/iceforsale | The only `table.dataTable` on the page |
| `swap120` | 120+ min Ice Swap Board | https://www.psmha.ca/iceschedule | The `.pageElement.tableElement` whose `h3` matches `/^120\+\s*min/i` |

The app parses nothing else on either page. A table counts as **readable** when the page returns HTTP 200 and the table is found with its column headers. An empty table still counts as readable.

## Stack

- Next.js 15 (App Router), React 19, TypeScript (strict)
- `cheerio` parses the HTML on the server
- `@neondatabase/serverless`: the Neon Postgres driver (HTTP)
- Deploys to Vercel with no extra configuration. `next.config` is not used.
- Path alias: `@/*` resolves to the repo root

## Layout

```
app/
  layout.tsx          Root layout and metadata
  page.tsx            "/" status page (server component, force-dynamic). Runs checkAll() and renders a card plus a table for each target
  globals.css         Styles (.card, .badge, .ok/.bad, .muted, .scroll)
  api/check/route.ts  GET /api/check returns JSON { ok, results }, with status 200, or 503 if any table isn't readable
lib/
  iceTables.ts        TARGETS, fetching and parsing (checkTable, checkAll), types TableCheck and ParsedTable
  db.ts               Neon client: exports `sql` tagged template. Throws on import if DATABASE_URL is missing
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
- No schema or tables exist yet, and nothing imports `lib/db.ts` yet.

## Commands

```sh
npm install
npm run dev     # local dev
npm run build   # production build
npm start
```

There are no tests and no lint config yet.

## Conventions

- Keep the scraping narrow: read only the two target tables.
- Write server components and route handlers with `export const dynamic = "force-dynamic"` so the data is always live.
- Code style is small, dense TypeScript, with comments only where the reason isn't obvious.

## Change log

Newest first. Use the format `YYYY-MM-DD: summary (files)`.

- **2026-10-11**: Added this AGENTS.md as the repo memory.
- **2026-10-11**: Added the Neon database helper `lib/db.ts`, which exports `sql` from `neon(DATABASE_URL)`. Added `.env*.local` to `.gitignore`.
- **2026-10-11**: Installed `@neondatabase/serverless` ^1.2.0 (`package.json`, `package-lock.json`). `npm install` reported audit warnings, which are not yet addressed.
- **2026-10-11**: Initial commit (`4760d84`): the Next.js app, the status page, `/api/check`, and the cheerio table parser in `lib/iceTables.ts`.
- **2026-10-11**: Repo initialized (`ae3f40d`).
