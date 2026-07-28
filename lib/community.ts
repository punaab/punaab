/**
 * Public community links. Safe to show on marketing pages and in the footer.
 * Keep secrets out of this file — only public URLs belong here.
 */

/** Pump.fun mint for the Punaab coin (Solana). */
export const PUMP_MINT =
  "8xWMreut8z93Pg4Uh1HgY9eWNJJxUtyWnGPjjnuJpump";

export const COMMUNITY = {
  /** Official X / Twitter. */
  x: "https://x.com/notbitcoinceo",
  /** Punaab coin on Pump.fun */
  pump: `https://pump.fun/coin/${PUMP_MINT}`,
  /** Community Telegram group. */
  telegram: "https://t.me/+KqRFKkAiSLo1YjFh",
} as const;

export const COMMUNITY_PITCH =
  "Punaab is free to download. Use him in your own story or game, change him, and monetize what you make. Share lore in the hall — this is a community project.";

/** Lore line that scrolls in the Pump.fun ticker. */
export const PUMP_TICKER_LORE =
  "$PUNAAB is the official coin. Support us by buying and holding. Send some to your friends. Tag us on Twitter @notbitcoinceo. Punaab The Travelling Bard wanders chain to chain with nothing but an ancient lute, a cloak, backpack, and stories from forgotten kingdoms — every holder becomes part of the tale.";
