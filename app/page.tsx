import { checkAll, type TableCheck, type ParsedTable } from "@/lib/iceTables";

export const dynamic = "force-dynamic";

export default async function Home() {
  const results = await checkAll();
  const allOk = results.every((r) => r.readable);

  return (
    <main>
      <header>
        <h1>PSMHA Ice Check</h1>
        <p className={allOk ? "ok" : "bad"}>
          {allOk ? "Both tables are readable" : "One or more tables could not be read"}
        </p>
        <p className="muted">
          Checked {new Date(results[0].checkedAt).toLocaleString("en-CA", { timeZone: "America/Regina" })} ·{" "}
          <a href="/">Re-check</a> · <a href="/api/check">JSON</a>
        </p>
      </header>

      {results.map((r) => (
        <Result key={r.key} r={r} />
      ))}
    </main>
  );
}

function Result({ r }: { r: TableCheck }) {
  return (
    <section className="card">
      <div className="row">
        <h2>
          {r.label}
          {r.table && (
            <span className="muted">
              {" "}({r.table.rows.length} {r.table.rows.length === 1 ? "listing" : "listings"})
            </span>
          )}
        </h2>
        <span className={`badge ${r.readable ? "ok" : "bad"}`}>{r.readable ? "Readable" : "Not readable"}</span>
      </div>
      <p className="muted">
        <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a> · HTTP {r.status ?? "—"} · {r.durationMs} ms
      </p>
      {r.error && <p className="bad">{r.error}</p>}

      {r.table && <DataTable t={r.table} />}
    </section>
  );
}

function DataTable({ t }: { t: ParsedTable }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>{t.headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.rows.length === 0 ? (
            <tr><td colSpan={t.headers.length} className="muted">No listings posted</td></tr>
          ) : (
            t.rows.map((row, j) => (
              <tr key={j}>{t.headers.map((h) => <td key={h}>{row[h]}</td>)}</tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
