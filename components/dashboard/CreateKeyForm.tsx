"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateKeyForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("Godot key");
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createKey() {
    setBusy(true);
    setError(null);
    setRaw(null);
    try {
      const res = await fetch("/api/v1/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setRaw(data.raw);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Create API key</h3>
      <div className="form-row">
        <label htmlFor="key-name">Name</label>
        <input
          id="key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <button type="button" className="btn primary" onClick={createKey} disabled={busy}>
        {busy ? "Creating…" : "Generate key"}
      </button>
      {raw ? (
        <div className="key-reveal">
          Copy now — shown once:
          <br />
          {raw}
        </div>
      ) : null}
      {error ? <p className="banner-err" style={{ marginTop: "0.75rem" }}>{error}</p> : null}
    </div>
  );
}
