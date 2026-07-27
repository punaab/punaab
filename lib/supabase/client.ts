import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) return null;
  if (!browserClient) {
    browserClient = createClient(url, key);
  }
  return browserClient;
}
