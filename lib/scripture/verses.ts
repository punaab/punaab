/**
 * Curated refs from the standard works of
 * The Church of Jesus Christ of Latter-day Saints.
 * Fetched at tweet time via Open Scripture API.
 */
export interface ScriptureRef {
  /** Open Scripture API book id, e.g. "alma", "1nephi", "john" */
  bookId: string;
  chapter: number;
  verse: number;
  /** Human label for fallbacks */
  label: string;
}

export const SCRIPTURE_POOL: ScriptureRef[] = [
  { bookId: "1nephi", chapter: 3, verse: 7, label: "1 Nephi 3:7" },
  { bookId: "2nephi", chapter: 2, verse: 25, label: "2 Nephi 2:25" },
  { bookId: "2nephi", chapter: 31, verse: 20, label: "2 Nephi 31:20" },
  { bookId: "mosiah", chapter: 2, verse: 17, label: "Mosiah 2:17" },
  { bookId: "mosiah", chapter: 4, verse: 9, label: "Mosiah 4:9" },
  { bookId: "alma", chapter: 32, verse: 21, label: "Alma 32:21" },
  { bookId: "alma", chapter: 37, verse: 6, label: "Alma 37:6" },
  { bookId: "alma", chapter: 37, verse: 37, label: "Alma 37:37" },
  { bookId: "helaman", chapter: 5, verse: 12, label: "Helaman 5:12" },
  { bookId: "3nephi", chapter: 11, verse: 10, label: "3 Nephi 11:10–11" },
  { bookId: "3nephi", chapter: 11, verse: 11, label: "3 Nephi 11:11" },
  { bookId: "3nephi", chapter: 27, verse: 27, label: "3 Nephi 27:27" },
  { bookId: "moroni", chapter: 7, verse: 45, label: "Moroni 7:45" },
  { bookId: "moroni", chapter: 7, verse: 48, label: "Moroni 7:48" },
  { bookId: "moroni", chapter: 10, verse: 4, label: "Moroni 10:4" },
  { bookId: "moroni", chapter: 10, verse: 32, label: "Moroni 10:32" },
  { bookId: "ether", chapter: 12, verse: 27, label: "Ether 12:27" },
  { bookId: "ether", chapter: 12, verse: 4, label: "Ether 12:4" },
  { bookId: "doctrineandcovenants", chapter: 6, verse: 36, label: "D&C 6:36" },
  { bookId: "doctrineandcovenants", chapter: 18, verse: 10, label: "D&C 18:10" },
  { bookId: "doctrineandcovenants", chapter: 58, verse: 27, label: "D&C 58:27" },
  { bookId: "doctrineandcovenants", chapter: 64, verse: 33, label: "D&C 64:33" },
  { bookId: "doctrineandcovenants", chapter: 88, verse: 124, label: "D&C 88:124" },
  { bookId: "doctrineandcovenants", chapter: 121, verse: 45, label: "D&C 121:45" },
  { bookId: "moses", chapter: 1, verse: 39, label: "Moses 1:39" },
  { bookId: "abraham", chapter: 3, verse: 25, label: "Abraham 3:25" },
  { bookId: "matthew", chapter: 5, verse: 16, label: "Matthew 5:16" },
  { bookId: "matthew", chapter: 11, verse: 28, label: "Matthew 11:28" },
  { bookId: "john", chapter: 3, verse: 16, label: "John 3:16" },
  { bookId: "john", chapter: 14, verse: 27, label: "John 14:27" },
  { bookId: "john", chapter: 15, verse: 12, label: "John 15:12" },
  { bookId: "romans", chapter: 8, verse: 28, label: "Romans 8:28" },
  { bookId: "philippians", chapter: 4, verse: 13, label: "Philippians 4:13" },
  { bookId: "james", chapter: 1, verse: 5, label: "James 1:5" },
  { bookId: "proverbs", chapter: 3, verse: 5, label: "Proverbs 3:5–6" },
  { bookId: "proverbs", chapter: 3, verse: 6, label: "Proverbs 3:6" },
  { bookId: "psalm", chapter: 23, verse: 1, label: "Psalm 23:1" },
  { bookId: "isaiah", chapter: 1, verse: 18, label: "Isaiah 1:18" },
  { bookId: "joshua", chapter: 1, verse: 9, label: "Joshua 1:9" },
  { bookId: "joshua", chapter: 24, verse: 15, label: "Joshua 24:15" },
];

/** Deterministic pick for a UTC day so retries don't reshuffle mid-day. */
export function pickScriptureForDay(day: string): ScriptureRef {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0;
  return SCRIPTURE_POOL[h % SCRIPTURE_POOL.length]!;
}
