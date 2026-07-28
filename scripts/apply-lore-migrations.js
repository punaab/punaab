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
  const dbUrl =
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL;

  if (!dbUrl) {
    console.error("No database URL found.");
    process.exit(1);
  }

  let pg;
  try {
    pg = require("pg");
  } catch {
    console.error("Install pg: npm i -D pg");
    process.exit(1);
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const files = [
    "004_community_lore.sql",
    "005_community_lore_category.sql",
    "006_lore_graph.sql",
  ];

  for (const file of files) {
    const sqlPath = path.join(__dirname, "..", "supabase", "migrations", file);
    const sql = fs.readFileSync(sqlPath, "utf8");
    try {
      await client.query(sql);
      console.log("Applied", file);
    } catch (error) {
      console.error("Failed", file, error.message);
      process.exitCode = 1;
    }
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
