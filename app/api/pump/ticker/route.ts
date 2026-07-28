import { PUMP_MINT } from "@/lib/community";
import {
  PUMP_COIN_API,
  PUMP_SOL_API,
  type PumpTickerPayload,
} from "@/lib/pump";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Proxies Pump.fun public coin data for the site ticker.
 * Cached briefly so the bar can poll without hammering their API.
 */
export async function GET() {
  try {
    const headers = {
      Accept: "application/json",
      "User-Agent": "PunaabWebsite/1.0 (+https://punaab.com)",
    };

    const [coinRes, solRes] = await Promise.all([
      fetch(PUMP_COIN_API, { headers, next: { revalidate: 20 } }),
      fetch(PUMP_SOL_API, { headers, next: { revalidate: 60 } }),
    ]);

    if (!coinRes.ok) {
      return Response.json(
        { error: "Pump.fun coin lookup failed", status: coinRes.status },
        { status: 502 }
      );
    }

    const coin = (await coinRes.json()) as Record<string, unknown>;
    const solJson = solRes.ok
      ? ((await solRes.json()) as Record<string, unknown>)
      : null;

    const payload: PumpTickerPayload = {
      mint: PUMP_MINT,
      name: typeof coin.name === "string" ? coin.name : "Punaab",
      symbol: typeof coin.symbol === "string" ? coin.symbol : "Punaab",
      marketCapUsd: num(coin.usd_market_cap),
      marketCapSol: num(coin.market_cap),
      solPriceUsd: num(solJson?.solPrice),
      isLive: coin.is_currently_live === true,
      imageUri: typeof coin.image_uri === "string" ? coin.image_uri : null,
      url: `https://pump.fun/coin/${PUMP_MINT}`,
      updatedAt: Date.now(),
    };

    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40",
      },
    });
  } catch {
    return Response.json(
      { error: "Could not reach Pump.fun" },
      { status: 502 }
    );
  }
}
