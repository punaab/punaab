/**
 * Punaab's repertoire.
 *
 * Only songs with a recording in `public/music/` are listed. There is no
 * synthesized fallback — if it is not in the music folder, he does not play it.
 */

export type Song = {
  id: string;
  title: string;
  /** What the song is about — shown in the UI and fed to the AI as context. */
  blurb: string;
  /** Recording under `/music/` — required for playback. */
  audioFile: string;
};

export const SONGS: Song[] = [
  {
    id: "until-it-leads-me-home",
    title: "Until It Leads Me Home",
    blurb: "Punaab's walking ballad — the road, the longing, and the way back.",
    audioFile: "until-it-leads-me-home.mp3",
  },
  {
    id: "the-grass-grows-green",
    title: "The Grass Grows Green",
    blurb: "A soft meadow air — green shoulders of the road, and light on the verge.",
    audioFile: "the-grass-grows-green.mp3",
  },
];

/** Every stop / quest that asks for a song resolves here. */
export const DEFAULT_SONG_ID = SONGS[0].id;

export function getSong(id: string): Song {
  return SONGS.find((s) => s.id === id) ?? SONGS[0];
}

/** One track from the repertoire, avoiding an immediate repeat when possible. */
export function pickRandomSong(excludeId?: string): Song {
  const pool =
    excludeId && SONGS.length > 1
      ? SONGS.filter((song) => song.id !== excludeId)
      : SONGS;
  return pool[Math.floor(Math.random() * pool.length)] ?? SONGS[0];
}
