import * as cheerio from "cheerio";

// The only two tables this app reads:
//  - Ice For Sale: the single listings table on /iceforsale
//  - 120+ min Ice Swap Board: the table under the "120+ min Ice Times" heading on /iceschedule
// Nothing else on either page is parsed.
export const TARGETS = [
  {
    key: "iceforsale",
    label: "Ice For Sale",
    url: "https://www.psmha.ca/iceforsale",
    heading: null,
    iceType: "practice",
  },
  {
    key: "swap120",
    label: "120+ min Ice Swap Board",
    url: "https://www.psmha.ca/iceschedule",
    heading: /^120\+\s*min/i,
    iceType: "game_swap",
  },
] as const satisfies readonly { key: string; label: string; url: string; heading: RegExp | null; iceType: IceType }[];

// Stored in ice_availability.ice_type (CHECK constraint allows only these).
export type IceType = "practice" | "game_swap";

type Target = (typeof TARGETS)[number];

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export type TableCheck = {
  key: string;
  label: string;
  url: string;
  readable: boolean;
  status: number | null;
  durationMs: number;
  table: ParsedTable | null;
  error: string | null;
  checkedAt: string;
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

// SportsEngine renders tables server-side as
// .pageElement.tableElement > h3 + .tableWrapper > table.dataTable
function findTable($: cheerio.CheerioAPI, heading: RegExp | null) {
  if (!heading) {
    const tables = $("table.dataTable");
    return tables.length === 1 ? tables.first() : null;
  }
  const el = $(".pageElement.tableElement")
    .filter((_, pe) => heading.test(clean($(pe).children("h3").first().text())))
    .first()
    .find("table.dataTable")
    .first();
  return el.length ? el : null;
}

function readTable(html: string, heading: RegExp | null): ParsedTable | null {
  const $ = cheerio.load(html);
  const table = findTable($, heading);
  if (!table) return null;

  const headers = table.find("thead th").map((_, th) => clean($(th).text())).get();
  const rows = table
    .find("tbody tr")
    .toArray()
    .map((tr) => {
      const cells = $(tr).find("td").map((_, td) => clean($(td).text())).get();
      return Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ""]));
    });

  return { headers, rows };
}

export async function checkTable(target: Target): Promise<TableCheck> {
  const started = Date.now();
  const base = { key: target.key, label: target.label, url: target.url, checkedAt: new Date().toISOString() };

  try {
    const res = await fetch(target.url, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PSMHA-ice-checker/1.0)",
        Accept: "text/html",
      },
    });
    const table = res.ok ? readTable(await res.text(), target.heading) : null;

    // "Readable" = 200 response AND the target table was found with headers.
    // An empty table (no listings) still counts as readable.
    let error: string | null = null;
    if (!res.ok) error = `HTTP ${res.status}`;
    else if (!table) error = "Table not found — page layout may have changed";
    else if (table.headers.length === 0) error = "Table found but no headers parsed";

    return { ...base, readable: error === null, status: res.status, durationMs: Date.now() - started, table, error };
  } catch (e) {
    return {
      ...base,
      readable: false,
      status: null,
      durationMs: Date.now() - started,
      table: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const checkAll = () => Promise.all(TARGETS.map(checkTable));
