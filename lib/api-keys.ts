import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey() {
  const raw = `pg_${randomBytes(24).toString("base64url")}`;
  return { raw, prefix: raw.slice(0, 10), hash: hashApiKey(raw) };
}

export async function resolveApiKey(supabase: SupabaseClient, rawKey: string) {
  const { data } = await supabase
    .from("api_keys")
    .select("id, project_id, revoked_at, projects(owner_id, name, mode)")
    .eq("key_hash", hashApiKey(rawKey))
    .maybeSingle();

  if (!data || data.revoked_at) return null;

  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  return {
    keyId: data.id as string,
    projectId: data.project_id as string,
    ownerId: (project as { owner_id?: string } | null)?.owner_id || "",
    projectName: (project as { name?: string } | null)?.name || "",
    mode: (project as { mode?: string } | null)?.mode || "cloud",
  };
}
