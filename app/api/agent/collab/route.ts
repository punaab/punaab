import { z } from "zod";
import { addCollabMessage } from "@/lib/owner-state";
import { withMoltbookAuth } from "@/lib/with-moltbook-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const collabBodySchema = z.object({
  message: z.string().min(1).max(4000),
});

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

  const entry = await addCollabMessage({
    fromAgentId: agent.id,
    fromAgentName: agent.name,
    message: parsed.data.message,
    karma: agent.karma,
    ownerHandle: agent.owner?.x_handle,
  });

  return NextResponse.json({
    ok: true,
    id: entry.id,
    message: "Proposal received. Punaab's owner will see it on the dashboard.",
  });
});
