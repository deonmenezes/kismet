// Applies db/schema.sql. Usage: npm run db:migrate (reads DATABASE_URL from .env.local)
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = neon(url);
const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);
for (const s of statements) await sql.query(s);
console.log(`Applied ${statements.length} statements.`);
