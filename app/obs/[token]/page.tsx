import { PunaabEmbed } from "@/components/embed/PunaabEmbed";

/**
 * The OBS / Streamlabs browser source.
 *
 * Two things make this different from the website embed, and both matter for
 * it to be usable on a stream:
 *
 *  1. **The background is genuinely transparent.** OBS composites the page
 *     over the rest of the scene, so any background colour here would appear
 *     as a solid rectangle sitting on the streamer's gameplay.
 *  2. **There is no chat box.** The streamer's viewers are already talking in
 *     Twitch or Kick chat; the overlay listens to that and replies. An input
 *     field nobody can reach would just take up screen space.
 */

export const metadata = {
  title: "Punaab overlay",
  robots: { index: false, follow: false },
};

export default async function ObsOverlayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="punaab-overlay-root">
      <PunaabEmbed token={token} surface="obs" />
    </div>
  );
}
