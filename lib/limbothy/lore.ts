/**
 * Jimothy & Limbothy meme lore snippets for occasional X posts.
 * CA: 9CtQhxDcNd3nzHE2h6v2zc2STZKXT9MYwY2e3AWapump
 */

export const LIMBOTHY_MINT =
  "9CtQhxDcNd3nzHE2h6v2zc2STZKXT9MYwY2e3AWapump";

/** Short standalone bits — pick one (or stitch lightly) into a tweet. */
export const LIMBOTHY_BITS: string[] = [
  "There are only two primal meme beings. Jimothy the raccoon. Limbothy the borzoi. Perfect opposites.",
  "Jimothy has short little legs. Limbothy has legs so long that nobody has ever confirmed where they actually end.",
  "Jimothy spends all day running around trying to get somewhere. Limbothy takes one step and arrives next week.",
  "Jimothy climbs into garbage cans. Limbothy simply steps over the garbage can.",
  "Jimothy needs ladders. Limbothy accidentally reaches the second floor.",
  "Jimothy buys the top because he couldn't see over the candle. Limbothy's legs are so long he saw the next bull run before it happened.",
  'The old prophecy reads: "When the short legs panic... the long legs prosper."',
  "Jimothy is powered by caffeine. Limbothy is powered by stretching once every six hours.",
  "Jimothy's portfolio is measured in percentages. Limbothy's portfolio is measured in leg length.",
  "Scientists attempted to calculate Limbothy's inseam. The equation became recursive.",
  "Jimothy represents FOMO. Limbothy represents LONGO.",
  "When the market dips... Jimothy runs in tiny circles. Limbothy simply extends one majestic leg and casually steps over the bear market.",
  'Jimothy: "How are you always ahead of me?"\nLimbothy: "Long-term thinking."\n"No... long-leg thinking."',
  "Short legs panic. Long legs prosper. Limbothy lore.",
  "Limbothy didn't moonwalk. He just walked — and the moon was closer than expected.",
  "Update from the field: Jimothy still in the can. Limbothy still over it.",
];

export function pickLimbothyBit(seed?: string): string {
  const day = seed ?? new Date().toISOString().slice(0, 10);
  const noise = `${day}:${Date.now()}:${Math.random()}`;
  let h = 0;
  for (let i = 0; i < noise.length; i++) h = (h * 31 + noise.charCodeAt(i)) >>> 0;
  return LIMBOTHY_BITS[h % LIMBOTHY_BITS.length]!;
}
