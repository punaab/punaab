/**
 * Applies supabase/migrations/001_punaab_core.sql via the Supabase SQL API
 * using the management approach: runs statements through pg via DATABASE_URL
 * if set, otherwise prints instructions.
 *
 * Preferred: use Supabase MCP apply_migration or Dashboard SQL editor.
 */
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const sqlPath = path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "001_punaab_core.sql"
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.log("No DATABASE_URL / SUPABASE_DB_URL set.");
    console.log("Apply this file in the Supabase SQL editor:");
    console.log(sqlPath);
    console.log("\nOr: npx supabase db push (if linked)");
    process.exit(0);
  }

  let pg;
  try {
    pg = require("pg");
  } catch {
    console.error("Install pg: npm i -D pg");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Applied 001_punaab_core.sql");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
