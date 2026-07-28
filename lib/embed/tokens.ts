import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Embed tokens: the credential that lives in someone else's web page.
 *
 * This is a fundamentally different security problem from `lib/api-keys.ts`.
 * An API key is a secret held on a server and is hashed at rest. An embed
 * token is *published* — it sits in the HTML of a customer's site and in the
 * URL of an OBS browser source, and anyone can read it. It cannot be secret,
 * so it is defended differently:
 *
 *  - It authorises exactly one action: talk to one character. It can't read
 *    keys, list projects, or spend outside its own cap.
 *  - It is bound to an origin allowlist, checked server-side against the
 *    request's `Origin` header.
 *  - It carries its own daily credit ceiling, so a token scraped off a public
 *    page cannot drain the owner's balance.
 *
 * Because it is not a secret, it is stored in plaintext — hashing it would
 * buy nothing and would make the dashboard unable to show the customer the
 * value they need to paste.
 */

export type EmbedSurface = "web" | "obs";

export type EmbedToken = {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  token: string;
  allowedOrigins: string[];
  surface: EmbedSurface;
  dailyCreditCap: number;
};

export function generateEmbedToken(surface: EmbedSurface): string {
  // Prefixed so a leaked token is immediately identifiable in logs and so it
  // can never be confused with a `pg_` secret API key.
  const prefix = surface === "obs" ? "pobs" : "pweb";
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

/**
 * Normalises an origin for comparison: scheme + host + port, lowercased, no
 * trailing slash or path. `HTTPS://Example.com/widget` and
 * `https://example.com` must compare equal or the allowlist is unusable.
 */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    );
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

/**
 * Is `origin` permitted by this allowlist?
 *
 * Supports a single leading-wildcard form (`https://*.example.com`) because
 * customers routinely need preview deploys, and telling them to add fifty
 * Vercel URLs by hand guarantees they will instead add `*` and disable the
 * protection entirely.
 */
export function originAllowed(
  allowed: string[],
  origin: string | null
): boolean {
  // An empty allowlist denies everything. This is the default for a new token
  // on purpose: a credential in public HTML should not work anywhere until
  // its owner has said where.
  if (!allowed.length) return false;
  if (allowed.includes("*")) return true;
  if (!origin) return false;

  const candidate = normalizeOrigin(origin);
  if (!candidate) return false;

  for (const entry of allowed) {
    if (entry.includes("*")) {
      const pattern = normalizeOrigin(entry.replace("*.", ""));
      if (!pattern) continue;
      // `https://*.example.com` matches any subdomain, and example.com itself.
      const bare = pattern.replace(/^https?:\/\//, "");
      const candidateHost = candidate.replace(/^https?:\/\//, "");
      if (candidateHost === bare || candidateHost.endsWith(`.${bare}`)) {
        return true;
      }
      continue;
    }
    if (normalizeOrigin(entry) === candidate) return true;
  }
  return false;
}

/** Looks up a live token and the project it belongs to. */
export async function resolveEmbedToken(
  supabase: SupabaseClient,
  raw: string
): Promise<EmbedToken | null> {
  if (!raw) return null;

  const { data } = await supabase
    .from("embed_tokens")
    .select(
      "id, project_id, name, token, allowed_origins, surface, daily_credit_cap, enabled, revoked_at, projects(owner_id)"
    )
    .eq("token", raw)
    .maybeSingle();

  if (!data || !data.enabled || data.revoked_at) return null;

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  const ownerId = (project as { owner_id?: string } | null)?.owner_id;
  if (!ownerId) return null;

  return {
    id: data.id as string,
    projectId: data.project_id as string,
    ownerId,
    name: data.name as string,
    token: data.token as string,
    allowedOrigins: (data.allowed_origins as string[]) ?? [],
    surface: (data.surface as EmbedSurface) ?? "web",
    dailyCreditCap: Number(data.daily_credit_cap ?? 0),
  };
}

export type CapCheck =
  | { ok: true; spent: number }
  | { ok: false; spent: number; reason: "daily_cap" };

/**
 * Records a token's spend for today and enforces its ceiling.
 *
 * Read-then-write is not atomic here, so two simultaneous requests can each
 * see the same "before" figure and both pass. That is an accepted trade: the
 * worst case is overshooting the cap by a handful of credits on a burst, and
 * the alternative is a database function and a round trip on every chat
 * message. The account-level balance check downstream is the real backstop.
 */
export async function chargeEmbedToken(
  supabase: SupabaseClient,
  tokenId: string,
  cost: number,
  cap: number
): Promise<CapCheck> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("embed_usage_daily")
    .select("credits_spent, messages")
    .eq("token_id", tokenId)
    .eq("day", today)
    .maybeSingle();

  const spent = Number(existing?.credits_spent ?? 0);
  if (spent + cost > cap) {
    return { ok: false, spent, reason: "daily_cap" };
  }

  await supabase.from("embed_usage_daily").upsert(
    {
      token_id: tokenId,
      day: today,
      credits_spent: spent + cost,
      messages: Number(existing?.messages ?? 0) + 1,
    },
    { onConflict: "token_id,day" }
  );

  await supabase
    .from("embed_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenId);

  return { ok: true, spent: spent + cost };
}
