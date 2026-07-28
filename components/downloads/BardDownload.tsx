"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { getAppearance } from "@/lib/bard/palettes";
import {
  PUNAAB_IDLE_URL,
  PUNAAB_STRUM_IDLE_URL,
  PUNAAB_WALK_URL,
} from "@/lib/bard/punaab-model";

const BardPreview = dynamic(
  () => import("./BardPreview").then((m) => m.BardPreview),
  {
    ssr: false,
    loading: () => (
      <div className="bard-preview bard-preview-loading">
        <div className="bard-world-spinner" />
      </div>
    ),
  }
);

const ENGINES = [
  {
    id: "godot",
    name: "Godot 4",
    note: "Drop the .glb into res://, then add the Punaab node from the addon.",
  },
  {
    id: "unity",
    name: "Unity",
    note: "Import with glTFast or UnityGLTF. Scale is already metres.",
  },
  {
    id: "unreal",
    name: "Unreal 5",
    note: "Use Interchange glTF import. +Y up is converted automatically.",
  },
  {
    id: "web",
    name: "Web (three.js / Babylon)",
    note: "Load with GLTFLoader or SceneLoader. Bone names match across clips.",
  },
] as const;

type ModelPack = "idle" | "walk" | "strum-idle";

const PACKS: Record<
  ModelPack,
  { url: string; filename: string; label: string }
> = {
  idle: {
    url: PUNAAB_IDLE_URL,
    filename: "punaab-idle.glb",
    label: "Idle",
  },
  walk: {
    url: PUNAAB_WALK_URL,
    filename: "punaab-walk.glb",
    label: "Walk",
  },
  "strum-idle": {
    url: PUNAAB_STRUM_IDLE_URL,
    filename: "punaab-strum-idle.glb",
    label: "Strum",
  },
};

/**
 * Download panel for the authored Punaab GLBs (idle + walk).
 */
export function BardDownload() {
  const appearance = getAppearance("classic");
  const [pack, setPack] = useState<ModelPack>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleDownload = useCallback(async () => {
    setBusy(true);
    setStatus("Fetching model…");
    try {
      const selected = PACKS[pack];
      const res = await fetch(selected.url);
      if (!res.ok) throw new Error(`Could not fetch ${selected.filename}`);
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = selected.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      const mb = (blob.size / (1024 * 1024)).toFixed(1);
      setStatus(`Downloaded ${selected.filename} — ${mb} MB.`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Download failed: ${error.message}`
          : "Download failed."
      );
    } finally {
      setBusy(false);
    }
  }, [pack]);

  return (
    <div className="bard-download">
      <div className="bard-download-stage">
        <BardPreview palette={appearance.palette} anim={pack} />
      </div>

      <div className="bard-download-panel">
        <fieldset className="bard-field">
          <legend>Animation pack</legend>
          <div className="bard-chip-row">
            {(Object.keys(PACKS) as ModelPack[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`bard-chip${pack === id ? " is-active" : ""}`}
                onClick={() => setPack(id)}
                aria-pressed={pack === id}
              >
                {PACKS[id].label} .glb
              </button>
            ))}
          </div>
          <p className="bard-field-note">
            Preview plays the selected pack. Idle / walk for travel; strum while
            he plays music (he stops to play). Same skeleton in all three —
            ~1.7m tall, 1 unit = 1 metre, +Y up.
          </p>
        </fieldset>

        <button
          type="button"
          className="btn primary btn-glow bard-download-button"
          onClick={handleDownload}
          disabled={busy}
        >
          {busy ? "Downloading…" : `Download ${PACKS[pack].label}`}
        </button>

        {status && (
          <p className="bard-download-status" role="status">
            {status}
          </p>
        )}

        <ul className="bard-engine-list">
          {ENGINES.map((engine) => (
            <li key={engine.id}>
              <strong>{engine.name}</strong>
              <span>{engine.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
