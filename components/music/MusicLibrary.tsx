"use client";

import { useRef, useState } from "react";
import { MUSIC_TRACKS, musicUrl, type MusicTrack } from "@/lib/music";

function TrackRow({
  track,
  playing,
  onToggle,
}: {
  track: MusicTrack;
  playing: boolean;
  onToggle: () => void;
}) {
  const href = musicUrl(track.file);

  return (
    <article className={`music-track${playing ? " is-playing" : ""}`}>
      <div className="music-track-info">
        <h3>{track.title}</h3>
        <span className="music-track-duration">{track.durationHint}</span>
      </div>
      <div className="music-track-actions">
        <button
          type="button"
          className="btn soft music-track-btn"
          onClick={onToggle}
          aria-pressed={playing}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <a className="btn primary music-track-btn" href={href} download={track.file}>
          Download
        </a>
      </div>
    </article>
  );
}

export function MusicLibrary() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  async function toggleTrack(track: MusicTrack) {
    const audio = audioRef.current;
    if (!audio) return;

    if (playingId === track.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }

    const href = musicUrl(track.file);
    if (audio.src !== new URL(href, window.location.origin).href) {
      audio.src = href;
    }

    try {
      await audio.play();
      setPlayingId(track.id);
    } catch {
      // File may not be uploaded yet — download still works once it is.
      setPlayingId(null);
    }
  }

  return (
    <div className="music-library">
      {MUSIC_TRACKS.map((track) => (
        <TrackRow
          key={track.id}
          track={track}
          playing={playingId === track.id}
          onToggle={() => void toggleTrack(track)}
        />
      ))}
      <audio
        ref={audioRef}
        preload="none"
        onEnded={() => setPlayingId(null)}
      />
    </div>
  );
}
