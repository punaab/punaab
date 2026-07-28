"use client";

import { useRef, useState } from "react";
import { MUSIC_TRACKS, musicUrl, type MusicTrack } from "@/lib/music";

function TrackRow({ track }: { track: MusicTrack }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const href = musicUrl(track.file);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (playing) {
        audio.pause();
        setPlaying(false);
        return;
      }
      await audio.play();
      setPlaying(true);
    } catch {
      // File may not be uploaded yet — download still works once it is.
      setPlaying(false);
    }
  }

  return (
    <article className="card music-track">
      <div className="music-track-main">
        <div>
          <p className="meta">{track.tags.join(" · ")}</p>
          <h3>{track.title}</h3>
          <p>{track.blurb}</p>
          <p className="music-track-meta">
            <code>{track.file}</code>
            <span>{track.durationHint}</span>
          </p>
        </div>
        <div className="music-track-actions">
          <button
            type="button"
            className="btn soft"
            onClick={togglePlay}
            aria-pressed={playing}
          >
            {playing ? "Pause" : "Preview"}
          </button>
          <a className="btn primary" href={href} download={track.file}>
            Download MP3
          </a>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={href}
        preload="none"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
    </article>
  );
}

export function MusicLibrary() {
  return (
    <div className="music-library">
      {MUSIC_TRACKS.map((track) => (
        <TrackRow key={track.id} track={track} />
      ))}
    </div>
  );
}
