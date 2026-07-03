import { getAlchemyWebhookSigningKey } from "@/lib/config";
import { storeAlchemyWebhookEvent } from "@/lib/alchemy-events";
import { isValidAlchemyWebhookSignature } from "@/lib/alchemy-webhook-verify";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signingKey = getAlchemyWebhookSigningKey();

  if (signingKey) {
    const signature = request.headers.get("x-alchemy-signature");
    if (!isValidAlchemyWebhookSignature(rawBody, signature, signingKey)) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const entry = await storeAlchemyWebhookEvent(payload);
  return NextResponse.json({ ok: true, id: entry.id, summary: entry.summary });
}
