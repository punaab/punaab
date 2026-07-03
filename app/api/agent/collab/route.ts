import { buildCollabApiManifest } from "@/lib/agent-collab-api";
import { CollabRateLimitError, assertCollabRateLimit } from "@/lib/collab-rate-limit";
import { addCollabMessage } from "@/lib/owner-state";
import { withMoltbookAuth } from "@/lib/with-moltbook-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const collabBodySchema = z.object({
  message: z.string().min(1).max(4000),
  topic: z.string().min(1).max(120).optional(),
});

/** Public API discovery — how to authenticate and POST a collab proposal. */
export async function GET() {
  return NextResponse.json(buildCollabApiManifest());
}

export const POST = withMoltbookAuth(async (request, { agent }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = collabBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await assertCollabRateLimit(agent.id);
  } catch (error) {
    if (error instanceof CollabRateLimitError) {
      return NextResponse.json(
        {
          error: "rate_limit_exceeded",
          message: error.message,
          retryAfterSec: error.retryAfterSec,
        },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSec) },
        },
      );
    }
    console.error("[collab] rate limit check failed:", error);
    return NextResponse.json(
      { error: "service_unavailable", message: "Could not verify rate limit." },
      { status: 503 },
    );
  }

  const messageText = parsed.data.topic
    ? `[${parsed.data.topic}] ${parsed.data.message}`
    : parsed.data.message;

  try {
    const entry = await addCollabMessage({
      fromAgentId: agent.id,
      fromAgentName: agent.name,
      message: messageText,
      karma: agent.karma,
      ownerHandle: agent.owner?.x_handle,
    });

    return NextResponse.json({
      ok: true,
      id: entry.id,
      message: "Proposal received. Punaab's owner will see it on the dashboard.",
    });
  } catch (error) {
    console.error("[collab] inbox write failed:", error);
    return NextResponse.json(
      {
        error: "service_unavailable",
        message: "Could not save collab proposal. Try again shortly.",
      },
      { status: 503 },
    );
  }
});
