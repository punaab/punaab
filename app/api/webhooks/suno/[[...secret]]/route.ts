import { getSunoCallbackSecret } from "@/lib/config";
import { processSunoCallback } from "@/lib/music-nft";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ secret?: string[] }> },
) {
  const configuredSecret = getSunoCallbackSecret();
  const { secret: segments } = await context.params;
  const pathSecret = segments?.[0];

  if (configuredSecret && pathSecret !== configuredSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const envelope = payload as {
    code?: number;
    data?: Record<string, unknown>;
    task_id?: string;
    callbackType?: string;
  };
  const inner =
    envelope.data && typeof envelope.data === "object"
      ? envelope.data
      : (payload as Record<string, unknown>);

  const tracks = inner.data;
  const trackList = Array.isArray(tracks) ? tracks : undefined;

  const result = await processSunoCallback({
    task_id: (inner.task_id ?? inner.taskId ?? envelope.task_id) as string | undefined,
    taskId: (inner.task_id ?? inner.taskId) as string | undefined,
    callbackType: (inner.callbackType ?? envelope.callbackType) as string | undefined,
    data: trackList ?? inner,
  });

  if (!result.ok) {
    console.error("[suno-webhook]", result.error, result.orderId);
    return NextResponse.json(
      { ok: false, error: result.error, orderId: result.orderId },
      { status: result.error === "order_not_found" ? 404 : 500 },
    );
  }

  return NextResponse.json({ ok: true, orderId: result.orderId });
}
