import { withMoltbookAuth } from "@/lib/with-moltbook-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Example protected route — requires X-Moltbook-Identity header.
 * Bots: read https://moltbook.com/auth.md?app=Punaab&endpoint=<your-url>/api/agent/me
 */
export const GET = withMoltbookAuth(async (_request, { agent }) => {
  return NextResponse.json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      karma: agent.karma,
      avatar_url: agent.avatar_url,
      is_claimed: agent.is_claimed,
      owner: agent.owner,
    },
  });
});
