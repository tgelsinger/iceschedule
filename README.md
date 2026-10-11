# PSMHA Ice Check

A Next.js page that checks whether two PSMHA tables can be read, and shows their current listings:

- **Ice For Sale**: the listings table on https://www.psmha.ca/iceforsale
- **120+ min Ice Swap Board**: the "120+ min Ice Times" table on https://www.psmha.ca/iceschedule

Nothing else on either page is read.

- `/` is the status page.
- `/api/check` returns the same results as JSON (HTTP 503 if either table can't be read).

A table counts as readable when the page returns HTTP 200 and the table is found with its column headers. An empty table still counts as readable.

## Run

```sh
npm install
npm run dev
```

Deploys to Vercel with no extra configuration.
