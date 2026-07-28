"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useState } from "react";
import {
  PUNAAB_DOWNLOADS,
  type PunaabDownloadId,
  type PunaabDownloadItem,
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

const MODEL_PACKS = PUNAAB_DOWNLOADS.filter((item) => item.kind === "model");
const EXTRAS = PUNAAB_DOWNLOADS.filter((item) => item.kind !== "model");

function itemById(id: PunaabDownloadId): PunaabDownloadItem {
  return PUNAAB_DOWNLOADS.find((item) => item.id === id) ?? PUNAAB_DOWNLOADS[0];
}

/**
 * Download shelf for static Punaab meshes, props, and the reference still.
 */
export function BardDownload() {
  const [pack, setPack] = useState<PunaabDownloadId>("2k");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = itemById(pack);

  const handleDownload = useCallback(
    async (item: PunaabDownloadItem) => {
      setBusy(true);
      setStatus(`Fetching ${item.label}…`);
      try {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`Could not fetch ${item.filename}`);
        const blob = await res.blob();

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = item.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);

        const mb = (blob.size / (1024 * 1024)).toFixed(1);
        setStatus(`Downloaded ${item.filename} — ${mb} MB.`);
      } catch (error) {
        setStatus(
          error instanceof Error
            ? `Download failed: ${error.message}`
            : "Download failed."
        );
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return (
    <div className="bard-download">
      <div className="bard-download-stage">
        <BardPreview />
      </div>

      <div className="bard-download-panel">
        <fieldset className="bard-field">
          <legend>Character mesh</legend>
          <div className="bard-chip-row">
            {MODEL_PACKS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`bard-chip${pack === item.id ? " is-active" : ""}`}
                onClick={() => setPack(item.id)}
                aria-pressed={pack === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="bard-field-note">{selected.blurb}</p>
        </fieldset>

        <button
          type="button"
          className="btn primary btn-glow bard-download-button"
          onClick={() => handleDownload(selected)}
          disabled={busy}
        >
          {busy ? "Downloading…" : `Download ${selected.label}`}
        </button>

        <fieldset className="bard-field">
          <legend>Props & reference</legend>
          <div className="bard-extras">
            {EXTRAS.map((item) => (
              <div key={item.id} className="bard-extra-card">
                {item.preview && (
                  <div className="bard-extra-thumb">
                    <Image
                      src={item.preview}
                      alt=""
                      width={160}
                      height={160}
                      className="bard-extra-image"
                      unoptimized={item.preview.endsWith(".svg")}
                    />
                  </div>
                )}
                <div className="bard-extra-copy">
                  <strong>{item.label}</strong>
                  <span>{item.blurb}</span>
                  <button
                    type="button"
                    className="btn soft"
                    disabled={busy}
                    onClick={() => handleDownload(item)}
                  >
                    {item.kind === "image" ? "Download PNG" : "Download .glb"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {status && (
          <p className="bard-download-status" role="status">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
