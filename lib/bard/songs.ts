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
];

/** Every stop / quest that asks for a song resolves here. */
export const DEFAULT_SONG_ID = SONGS[0].id;

export function getSong(id: string): Song {
  return SONGS.find((s) => s.id === id) ?? SONGS[0];
}
