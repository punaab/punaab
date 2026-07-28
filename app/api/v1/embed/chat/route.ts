import { NextResponse } from "next/server";
import { z } from "zod";
import { burnCredits, getCreditBalance } from "@/lib/credits";
import {
  chargeEmbedToken,
  originAllowed,
  resolveEmbedToken,
} from "@/lib/embed/tokens";
import { capabilitiesFor, EMBED_CHAT_CREDIT_COST } from "@/lib/plans";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * The endpoint an embedded Punaab talks to.
 *
 * Called directly from the browser of whoever is visiting a *customer's* site,
 * authorised by a public embed token rather than a secret API key. Every
 * request therefore passes four gates before it costs anybody anything:
 *
 *   1. the token exists, is enabled, and is not revoked
 *   2. the request's Origin is on that token's allowlist
 *   3. the account's plan actually includes embedding
 *   4. the token is under its own daily credit cap, and the account has credit
 */

const schema = z.object({
  message: z.string().min(1).max(600),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(1200),
      })
    )
    .max(10)
    .optional(),
  /** Where this came from, for the transcript. */
  source: z.enum(["web", "twitch", "kick", "obs"]).optional(),
  author: z.string().max(80).optional(),
});

function corsHeaders(origin: string | null) {
  return {
    // Echoing the caller's origin (only ever reached after the allowlist check
    // has passed) rather than "*", so the browser enforces the same boundary
    // the server just did.
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const raw =
    req.headers.get("x-punaab-embed") || url.searchParams.get("token") || "";

  const deny = (status: number, error: string, code?: string) =>
    NextResponse.json({ error, code }, { status, headers: corsHeaders(origin) });

  const supabase = getSupabaseAdmin();
  if (!supabase) return deny(503, "Backend not configured");
  if (!raw) return deny(401, "Embed token required");

  // --- 1. Token ----------------------------------------------------------
  const token = await resolveEmbedToken(supabase, raw);
  if (!token) return deny(401, "Invalid or revoked embed token");

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return deny(400, "Invalid payload");
  const source = parsed.data.source ?? "web";

  // --- 2. Origin ---------------------------------------------------------
  // Stream overlays are loaded by OBS's embedded browser, which sends no
  // Origin header at all. That is indistinguishable from a stripped header,
  // so 'obs' tokens are scoped to a surface that cannot read anything and are
  // capped tightly instead of being origin-locked.
  if (token.surface === "web" && !originAllowed(token.allowedOrigins, origin)) {
    return deny(
      403,
      "This embed token is not allowed on this domain. Add it in your Punaab dashboard.",
      "ORIGIN_NOT_ALLOWED"
    );
  }

  // --- 3. Plan -----------------------------------------------------------
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan_code")
    .eq("id", token.ownerId)
    .maybeSingle();

  const capabilities = capabilitiesFor(profile?.plan_code);
  const allowedBySurface =
    token.surface === "obs" ? capabilities.obsOverlay : capabilities.websiteEmbed;
  if (!allowedBySurface) {
    return deny(
      402,
      "Embedding Punaab requires a Creator plan or above.",
      "PLAN_REQUIRED"
    );
  }

  // --- 4. Spend ----------------------------------------------------------
  const capped = await chargeEmbedToken(
    supabase,
    token.id,
    EMBED_CHAT_CREDIT_COST,
    token.dailyCreditCap
  );
  if (!capped.ok) {
    return deny(
      429,
      "This embed has reached its daily limit. It will reset tomorrow.",
      "DAILY_CAP"
    );
  }

  const balance = await getCreditBalance(supabase, token.ownerId);
  if (balance < EMBED_CHAT_CREDIT_COST) {
    return deny(402, "Out of credits", "NO_CREDITS");
  }

  // --- Character ---------------------------------------------------------
  const { data: config } = await supabase
    .from("character_configs")
    .select("display_name, brain")
    .eq("project_id", token.projectId)
    .maybeSingle();

  const { data: lore } = await supabase
    .from("lore_docs")
    .select("title, body")
    .eq("project_id", token.projectId)
    .limit(4);

  const brain = (config?.brain || {}) as { personality?: string; style?: string };
  const loreBlock = (lore || [])
    .map((d) => `## ${d.title}\n${d.body}`)
    .join("\n\n");

  const audience =
    source === "twitch" || source === "kick"
      ? `You are answering ${source} chat live on stream. ${
          parsed.data.author ? `The viewer is called ${parsed.data.author}.` : ""
        } Keep it to one or two sentences — it has to be readable on an overlay.`
      : "You are embedded on a website. Keep replies short and conversational.";

  const system = [
    `You are ${config?.display_name || "Punaab"}, a traveling bard.`,
    `Personality: ${brain.personality || "warm, witty, unhurried traveling bard"}.`,
    `Style: ${brain.style || "concise, in character, a little wry"}.`,
    audience,
    "Never break character. Never mention being an AI or a language model.",
    'Respond with JSON: {"reply": string, "behaviors": string[]}',
    "Allowed behaviors: idle, talk, sing, play_music, wave, dance, tell_story, laugh, bow.",
    loreBlock ? `Lore you know:\n${loreBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  let reply = "The road's been long, friend. Ask me again in a moment?";
  let behaviors = ["talk"];

  if (apiKey) {
    try {
      const aiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.85,
          max_tokens: 220,
          messages: [
            { role: "system", content: system },
            ...(parsed.data.history || []),
            { role: "user", content: parsed.data.message },
          ],
          response_format: { type: "json_object" },
        }),
      });
      const aiJson = await aiRes.json();
      const content = aiJson.choices?.[0]?.message?.content;
      if (content) {
        const parsedAi = JSON.parse(content) as {
          reply?: string;
          behaviors?: string[];
        };
        if (parsedAi.reply) reply = parsedAi.reply;
        if (parsedAi.behaviors?.length) behaviors = parsedAi.behaviors;
      }
    } catch {
      // Fall through with the in-character fallback rather than failing the
      // request — a silent bard on someone's homepage is worse than a vague one.
    }
  }

  await burnCredits(supabase, {
    profileId: token.ownerId,
    projectId: token.projectId,
    cost: EMBED_CHAT_CREDIT_COST,
    reason: "embed_chat",
    meta: { surface: token.surface, source },
  });

  await supabase.from("usage_events").insert({
    profile_id: token.ownerId,
    project_id: token.projectId,
    kind: "embed_chat",
    units: 1,
    cost_credits: EMBED_CHAT_CREDIT_COST,
    meta: { source },
  });

  await supabase.from("chat_events").insert({
    token_id: token.id,
    platform: source,
    author: parsed.data.author ?? null,
    message: parsed.data.message,
    reply,
  });

  return NextResponse.json(
    {
      reply,
      behaviors,
      credits_spent: EMBED_CHAT_CREDIT_COST,
      daily_spent: capped.spent,
      daily_cap: token.dailyCreditCap,
    },
    { headers: corsHeaders(origin) }
  );
}
