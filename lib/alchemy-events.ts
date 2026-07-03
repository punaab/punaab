import { createRedisClient } from "./redis";

const EVENTS_KEY = "moltbook:alchemy:events";
const MAX_EVENTS = 80;

export interface AlchemyWebhookEvent {
  id: string;
  timestamp: string;
  type: string;
  network?: string;
  summary: string;
  raw: unknown;
}

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

function summarizeEvent(payload: unknown): { type: string; network?: string; summary: string } {
  if (!payload || typeof payload !== "object") {
    return { type: "unknown", summary: "Webhook event" };
  }
  const p = payload as Record<string, unknown>;
  const webhookType = typeof p.type === "string" ? p.type : undefined;

  // Custom Webhook (GRAPHQL) — event.data.block.transactions | logs
  if (webhookType === "GRAPHQL" || p.event && typeof p.event === "object") {
    const event = p.event as Record<string, unknown>;
    const data = event.data as Record<string, unknown> | undefined;
    const block = data?.block as Record<string, unknown> | undefined;
    const txs = Array.isArray(block?.transactions) ? block.transactions : [];
    const logs = Array.isArray(block?.logs) ? block.logs : [];

    if (txs.length > 0) {
      const tx = txs[0] as Record<string, unknown>;
      const from = (tx.from as { address?: string } | undefined)?.address;
      const to = (tx.to as { address?: string } | undefined)?.address;
      const hash = String(tx.hash ?? "");
      const value = tx.value != null ? String(tx.value) : "";
      const summary = hash
        ? `tx ${from?.slice(0, 8) ?? "?"}→${to?.slice(0, 8) ?? "?"} ${value ? `value ${value}` : ""} (${hash.slice(0, 10)}…)`
        : `block tx activity (${txs.length})`;
      return { type: webhookType ?? "GRAPHQL", summary };
    }

    if (logs.length > 0) {
      const log = logs[0] as Record<string, unknown>;
      const tx = log.transaction as Record<string, unknown> | undefined;
      const hash = String(tx?.hash ?? "");
      const account = (log.account as { address?: string } | undefined)?.address;
      const summary = hash
        ? `log ${account?.slice(0, 10) ?? "contract"}… (${hash.slice(0, 10)}…)`
        : `block log activity (${logs.length})`;
      return { type: webhookType ?? "GRAPHQL", summary };
    }

    return {
      type: webhookType ?? "GRAPHQL",
      summary: "Custom webhook block (no matching txs/logs)",
    };
  }

  const event = (p.event ?? p) as Record<string, unknown>;
  const network =
    typeof event.network === "string"
      ? event.network
      : typeof p.network === "string"
        ? p.network
        : undefined;
  const activity = Array.isArray(event.activity) ? event.activity : [];
  const first = activity[0] as Record<string, unknown> | undefined;
  const asset = first?.asset ?? first?.value;
  const category = String(first?.category ?? event.type ?? p.type ?? "activity");
  const hash = first?.hash ?? first?.transactionHash;
  const summary = hash
    ? `${category}: ${String(asset ?? "tx")} (${String(hash).slice(0, 10)}…)`
    : `${category} on ${network ?? "chain"}`;
  return {
    type: String(event.type ?? p.type ?? "webhook"),
    network,
    summary,
  };
}

export async function storeAlchemyWebhookEvent(payload: unknown): Promise<AlchemyWebhookEvent> {
  const { type, network, summary } = summarizeEvent(payload);
  const entry: AlchemyWebhookEvent = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    network,
    summary,
    raw: payload,
  };
  try {
    const r = getRedis();
    await r.lpush(EVENTS_KEY, JSON.stringify(entry));
    await r.ltrim(EVENTS_KEY, 0, MAX_EVENTS - 1);
  } catch (error) {
    console.error("[alchemy-events] store failed:", error);
  }
  return entry;
}

export async function getRecentAlchemyEvents(limit = 15): Promise<AlchemyWebhookEvent[]> {
  try {
    const items = await getRedis().lrange(EVENTS_KEY, 0, limit - 1);
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        try {
          return JSON.parse(String(item)) as AlchemyWebhookEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is AlchemyWebhookEvent => e !== null);
  } catch {
    return [];
  }
}
