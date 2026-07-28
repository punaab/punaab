/**
 * Free downloadable tracks for the Music page.
 *
 * Only list files that actually exist under `public/music/`.
 */
export type MusicTrack = {
  id: string;
  title: string;
  blurb: string;
  /** Filename under /music/ */
  file: string;
  durationHint: string;
  tags: string[];
};

export const MUSIC_TRACKS: MusicTrack[] = [
  {
    id: "until-it-leads-me-home",
    title: "Until It Leads Me Home",
    blurb: "Punaab's walking ballad — the theme he plays on the road.",
    file: "until-it-leads-me-home.mp3",
    durationHint: "~3:30",
    tags: ["theme", "ballad", "travel"],
  },
];

export function musicUrl(file: string) {
  return `/music/${file}`;
}
