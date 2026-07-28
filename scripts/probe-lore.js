const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.log("url?", Boolean(url), "key?", Boolean(key));
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const a = await sb
    .from("community_lore")
    .select("id,title,category,slug,is_hub")
    .limit(3);
  console.log("simple", a.error?.message || "ok", a.data?.length);

  const b = await sb
    .from("community_lore")
    .select(
      "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, profiles!community_lore_author_id_fkey(display_name)"
    )
    .limit(3);
  console.log("join", b.error?.message || "ok", b.data?.length, b.error);

  const c = await sb
    .from("community_lore_links")
    .select("from_id,to_id,kind")
    .limit(3);
  console.log("links", c.error?.message || "ok", c.data?.length);

  const d = await sb
    .from("profiles")
    .select("id,clerk_user_id")
    .eq("clerk_user_id", "system:punaab-hub")
    .maybeSingle();
  console.log("hub profile", d.error?.message || "ok", d.data);

  const e = await sb
    .from("community_lore")
    .select("id,slug,is_hub,title")
    .or("slug.eq.punaab,is_hub.eq.true")
    .limit(1);
  console.log("hub lore", e.error?.message || "ok", e.data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
