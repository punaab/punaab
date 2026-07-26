/**
 * Jimothy & Limbothy universe — lore for LLM-crafted tweets (not copy-paste).
 * CA: 9CtQhxDcNd3nzHE2h6v2zc2STZKXT9MYwY2e3AWapump
 */

export const LIMBOTHY_MINT =
  "9CtQhxDcNd3nzHE2h6v2zc2STZKXT9MYwY2e3AWapump";

/** Canon for generating fresh posts — never tweet these lines verbatim. */
export const LIMBOTHY_LORE_BIBLE = `
The Tale of Jimothy & Limbothy — two primal meme beings, perfect opposites.
Jimothy: raccoon, short little legs, FOMO energy, caffeine-powered, climbs garbage cans,
needs ladders, runs in tiny circles when the market dips, buys tops because he can't
see over the candle, portfolio measured in percentages.
Limbothy: borzoi, legs so long nobody confirmed where they end, LONGO energy, stretches
once every six hours, steps over garbage cans / bear markets / second floors by accident,
sees the next bull run from altitude, portfolio measured in leg length, scientists who
tried to calculate his inseam got a recursive equation.
Prophecy: "When the short legs panic… the long legs prosper."
Bit: Jimothy asks how Limbothy is always ahead → "Long-term thinking." / "No… long-leg thinking."
Tone: absurdist meme lore, dry humor, crypto-adjacent without hard sell.
`.trim();

/** Angle seeds so each craft request explores a different joke. */
export const LIMBOTHY_ANGLES: string[] = [
  "field report comparing their legs in a ridiculous scenario",
  "mini prophecy tablet / ancient meme scripture vibe",
  "science lab fails to measure Limbothy",
  "market dip: FOMO vs LONGO reaction",
  "Jimothy stuck in a garbage can, Limbothy walking past",
  "candle chart sightlines / bull run altitude joke",
  "portfolio units: percent vs inseam",
  "dialogue snip between Jimothy and Limbothy",
  "Limbothy accidentally reaches a new floor / dimension",
  "one majestic step over the bear market",
  "caffeine vs stretch schedule as power sources",
  "recursive inseam equation going feral",
];

export function pickLimbothyAngle(): string {
  const noise = `${Date.now()}:${Math.random()}`;
  let h = 0;
  for (let i = 0; i < noise.length; i++) h = (h * 31 + noise.charCodeAt(i)) >>> 0;
  return LIMBOTHY_ANGLES[h % LIMBOTHY_ANGLES.length]!;
}
