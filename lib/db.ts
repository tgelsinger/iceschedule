import { neon } from "@neondatabase/serverless";

// Neon serverless driver over HTTP. Set DATABASE_URL to the Neon connection string
// (.env.local locally, project env vars on Vercel).
// Usage: const rows = await sql`SELECT * FROM listings WHERE id = ${id}`;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = neon(url);
