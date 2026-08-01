/**
 * Traveling Bard story bible — inspiration for LLM tweets (never verbatim).
 * Sites: https://www.punaab.com/ · Pump $Punaab
 */

export const PUNAAB_SITE_URL = "https://www.punaab.com/";
export const PUNAAB_PUMP_URL =
  "https://pump.fun/coin/8xWMreut8z93Pg4Uh1HgY9eWNJJxUtyWnGPjjnuJpump";
export const PUNAAB_MINT = "8xWMreut8z93Pg4Uh1HgY9eWNJJxUtyWnGPjjnuJpump";

export const PUNAAB_STORY_BIBLE = `
Punaab is The Traveling Bard — a green, lute-carrying wanderer who walks chain to chain
with a cloak, a backpack, and scraps of lore from forgotten kingdoms. He is free to
download into games and stories; holders of $Punaab on Pump.fun become part of the tale.
The world lives at https://www.punaab.com — never punaab.vercel.app or any Vercel URL.
Archive lore, Music, Models, Merch (The Traveling Bard's Notebook), a World Earnings Board,
and a hall where travelers help write the next scrap.
Tone: intellectual but warm, quirky, short — a vignette or koan, never a hard sell.
Never invent fake market caps, price predictions, or "guaranteed gains".
`.trim();

export type StoryLinkMode = "site" | "pump" | "both" | "soft";

export const PUNAAB_STORY_ANGLES: Array<{
  angle: string;
  link: StoryLinkMode;
}> = [
  {
    angle: "a roadside koan about maps vs the road, ending in curiosity about the Archive",
    link: "site",
  },
  {
    angle: "the bard tunes a lute between chains — sound as proof of presence",
    link: "soft",
  },
  {
    angle: "someone finds a blank page in the Notebook and realizes the story needs them",
    link: "site",
  },
  {
    angle: "on-chain as campfire: a coin that is less ticker, more fellowship token",
    link: "pump",
  },
  {
    angle: "a traveler asks what $Punaab buys — answer: a seat at the telling",
    link: "pump",
  },
  {
    angle: "models you can drop into a game — identity as something you carry, not rent",
    link: "site",
  },
  {
    angle: "World Earnings Board as a quiet leaderboard of imagination, not noise",
    link: "site",
  },
  {
    angle: "short parable: two kingdoms argue about value; the bard counts stories instead",
    link: "both",
  },
  {
    angle: "dawn on a new chain — backpack heavier with lore, lighter with certainty",
    link: "soft",
  },
  {
    angle: "invite to write one scrap of lore; culture compounds like that",
    link: "site",
  },
  {
    angle: "Pump.fun as a public square where the bard's coin meets curious strangers",
    link: "pump",
  },
  {
    angle: "intellectual joke: memes are compressed myths; this one still has a body",
    link: "both",
  },
];

export function pickStoryAngle(slotIndex: number): (typeof PUNAAB_STORY_ANGLES)[number] {
  const h = Math.floor(Date.now() / 3_600_000) + slotIndex * 7;
  return PUNAAB_STORY_ANGLES[Math.abs(h) % PUNAAB_STORY_ANGLES.length]!;
}
