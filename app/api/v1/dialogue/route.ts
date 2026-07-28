import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiKey } from "@/lib/api-keys";
import { burnCredits, getCreditBalance } from "@/lib/credits";
import { DIALOGUE_CREDIT_COST } from "@/lib/plans";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const schema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      })
    )
    .optional(),
});

function getKey(req: Request) {
  return (
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  );
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();
  const raw = getKey(req);
  if (!supabase || !raw) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  const authz = await resolveApiKey(supabase, raw);
  if (!authz) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  if (authz.mode === "local") {
    return NextResponse.json(
      {
        error: "Local AI mode is on the roadmap. Use cloud mode for MVP.",
        code: "LOCAL_NOT_IMPLEMENTED",
      },
      { status: 501 }
    );
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const balance = await getCreditBalance(supabase, authz.ownerId);
  if (balance < DIALOGUE_CREDIT_COST) {
    return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
  }

  const { data: config } = await supabase
    .from("character_configs")
    .select("display_name, brain")
    .eq("project_id", authz.projectId)
    .maybeSingle();

  const { data: lore } = await supabase
    .from("lore_docs")
    .select("title, body")
    .eq("project_id", authz.projectId)
    .limit(5);

  const brain = (config?.brain || {}) as { personality?: string; style?: string };
  const loreBlock = (lore || [])
    .map((d) => `## ${d.title}\n${d.body}`)
    .join("\n\n");

  const system = [
    `You are ${config?.display_name || "Punaab"}, a traveling bard NPC in a video game.`,
    `Personality: ${brain.personality || "warm, witty, helpful traveling bard"}.`,
    `Style: ${brain.style || "concise in-world dialogue"}.`,
    "Stay in character. Suggest music, quests, or shop when natural.",
    "Respond with JSON: {\"reply\": string, \"behaviors\": string[]}",
    "Allowed behaviors: idle, talk, sing, play_music, open_shop, tell_story, start_quest, wave, dance.",
    loreBlock ? `Lore knowledge:\n${loreBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  let reply =
    "Ah, traveler! The roads between worlds hum tonight. Shall I sing, trade, or tell a tale?";
  let behaviors = ["talk", "wave"];

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
          temperature: 0.8,
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
      // keep fallback reply
    }
  }

  await burnCredits(supabase, {
    profileId: authz.ownerId,
    projectId: authz.projectId,
    cost: DIALOGUE_CREDIT_COST,
    reason: "dialogue_chat",
    meta: { model },
  });

  await supabase.from("usage_events").insert({
    profile_id: authz.ownerId,
    project_id: authz.projectId,
    kind: "dialogue",
    units: 1,
    cost_credits: DIALOGUE_CREDIT_COST,
  });

  return NextResponse.json({
    reply,
    behaviors,
    credits_spent: DIALOGUE_CREDIT_COST,
  });
}
