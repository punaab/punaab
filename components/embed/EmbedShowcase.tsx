"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import {
  EmbedPlatformMark,
  type EmbedPlatform,
} from "@/components/embed/EmbedPlatformMark";

type EmbedOption = {
  id: EmbedPlatform;
  meta: string;
  title: string;
  blurb: string;
  preview: string;
  badge?: string;
};

const OPTIONS: EmbedOption[] = [
  {
    id: "web",
    meta: "website",
    title: "Website embed",
    blurb:
      "Drop one script tag on your site. Visitors chat with Punaab in place — songs, shops, and stories included.",
    preview: `<script src="https://punaab.com/embed.js" data-punaab="YOUR_TOKEN" async></script>`,
  },
  {
    id: "obs",
    meta: "streaming",
    title: "OBS browser source",
    blurb:
      "Add Punaab as a transparent overlay in OBS or Streamlabs. He walks, talks, and sings over your stream.",
    preview: `Sources → + → Browser\nURL: https://punaab.com/obs/YOUR_TOKEN\nSize: 480 × 640 · transparent BG`,
    badge: "Subscriber",
  },
  {
    id: "twitch",
    meta: "live chat",
    title: "Twitch chat bridge",
    blurb:
      "Point him at your Twitch channel. He reads chat and answers viewers — he never posts as you.",
    preview: `Platform: Twitch\nChannel: your_channel\nMode: mentions · !punaab · or all`,
    badge: "Subscriber",
  },
  {
    id: "kick",
    meta: "live chat",
    title: "Kick chat bridge",
    blurb:
      "Same live bridge for Kick. Mentions, commands, or full chat — you pick how talkative he is.",
    preview: `Platform: Kick\nChannel: your_channel\nMode: mentions · !punaab · or all`,
    badge: "Subscriber",
  },
];

export function EmbedShowcase({
  unlocked = false,
}: {
  /** True when the visitor can already manage embeds in the dashboard. */
  unlocked?: boolean;
}) {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <div className="embed-showcase">
      {OPTIONS.map((option) => {
        const locked = !unlocked;
        return (
          <article key={option.id} className="card embed-option">
            <div className="embed-option-head">
              <div className="embed-option-brand">
                <EmbedPlatformMark platform={option.id} />
                <p className="meta">{option.meta}</p>
              </div>
              {locked ? (
                <span className="embed-lock-badge">Locked</span>
              ) : option.badge ? (
                <span className="embed-lock-badge">{option.badge}</span>
              ) : null}
            </div>
            <h2>{option.title}</h2>
            <p>{option.blurb}</p>
            <pre className="embed-option-preview">{option.preview}</pre>

            {locked ? (
              <div className="hero-actions" style={{ marginTop: "1rem" }}>
                {isLoaded && isSignedIn ? (
                  <Link className="btn primary" href="/dashboard/billing">
                    See plans
                  </Link>
                ) : (
                  <>
                    <SignUpButton mode="modal">
                      <button type="button" className="btn primary">
                        Sign up
                      </button>
                    </SignUpButton>
                    <SignInButton mode="modal">
                      <button type="button" className="btn ghost">
                        Sign in
                      </button>
                    </SignInButton>
                  </>
                )}
              </div>
            ) : (
              <div className="hero-actions" style={{ marginTop: "1rem" }}>
                <Link className="btn primary" href="/dashboard/embeds">
                  Manage in dashboard
                </Link>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
