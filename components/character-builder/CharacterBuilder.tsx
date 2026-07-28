"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Config = {
  display_name?: string;
  brain?: Record<string, unknown>;
  loadout?: Record<string, unknown>;
};

/** Punaab has one look — never configurable per project. */
const PUNAAB_APPEARANCE = "classic";

export function CharacterBuilder({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("Punaab");
  const [personality, setPersonality] = useState(
    "traveling bard who sings, trades, and tells stories"
  );
  const [hat, setHat] = useState("");
  const [instrument, setInstrument] = useState("lute");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/characters?project_id=${projectId}`)
      .then((r) => r.json())
      .then((data) => {
        const cfg = data.config as Config | null;
        if (cfg) {
          setDisplayName(cfg.display_name || "Punaab");
          const brain = cfg.brain || {};
          if (typeof brain.personality === "string") {
            setPersonality(brain.personality);
          }
          const loadout = cfg.loadout || {};
          if (typeof loadout.hat === "string") setHat(loadout.hat);
          if (typeof loadout.instrument === "string") {
            setInstrument(loadout.instrument);
          }
        }
      })
      .catch(() => setStatus("Failed to load config"));
  }, [projectId]);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          display_name: displayName,
          appearance_id: PUNAAB_APPEARANCE,
          voice: "punaab",
          brain: { personality, style: "warm, witty, helpful" },
          loadout: { hat, instrument, cape: "", weapon: "" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus("Saved. Runtime config will pick this up on next GET /config.");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dash-content">
      <article className="card">
        <h2>Identity</h2>
        <div className="form-row">
          <label htmlFor="display">Display name</label>
          <input
            id="display"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label htmlFor="personality">Personality (brain)</label>
          <textarea
            id="personality"
            rows={3}
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
          />
        </div>
      </article>

      <article className="card">
        <h2>Loadout</h2>
        <div className="form-row">
          <label htmlFor="hat">Hat</label>
          <input id="hat" value={hat} onChange={(e) => setHat(e.target.value)} placeholder="feathered cap" />
        </div>
        <div className="form-row">
          <label htmlFor="instrument">Instrument</label>
          <input
            id="instrument"
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
          />
        </div>
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save character"}
        </button>
        {status ? <p style={{ marginTop: "0.85rem" }}>{status}</p> : null}
      </article>
    </div>
  );
}
