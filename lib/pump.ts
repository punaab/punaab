import { PUMP_MINT } from "@/lib/community";

export type PumpTickerPayload = {
  mint: string;
  name: string;
  symbol: string;
  marketCapUsd: number | null;
  marketCapSol: number | null;
  solPriceUsd: number | null;
  /** True when the coin owner has an active Pump.fun livestream. */
  isLive: boolean;
  imageUri: string | null;
  url: string;
  updatedAt: number;
};

export const PUMP_COIN_API = `https://frontend-api-v3.pump.fun/coins/${PUMP_MINT}`;
export const PUMP_SOL_API = "https://frontend-api-v3.pump.fun/sol-price";
