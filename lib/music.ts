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
  {
    id: "the-grass-grows-green",
    title: "The Grass Grows Green",
    blurb: "A meadow tune for green verges and quiet light on the road.",
    file: "the-grass-grows-green.mp3",
    durationHint: "~4:00",
    tags: ["meadow", "ballad", "travel"],
  },
  {
    id: "i-once-had-been-a-cat",
    title: "I Once Had Been a Cat",
    blurb: "A wry little tale for fireside grins and soft-footed mischief.",
    file: "i-once-had-been-a-cat.mp3",
    durationHint: "~4:00",
    tags: ["tale", "ballad", "whimsy"],
  },
];

export function musicUrl(file: string) {
  return `/music/${file}`;
}
