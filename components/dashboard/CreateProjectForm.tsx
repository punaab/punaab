"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("My Game");
  const [mode, setMode] = useState("cloud");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      router.push(`/dashboard/projects/${data.project.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <h2>Create project</h2>
      <div className="form-row">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
      </div>
      <div className="form-row">
        <label htmlFor="mode">AI mode</label>
        <select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="cloud">Cloud</option>
          <option value="hybrid">Hybrid (soon)</option>
          <option value="local">Local (soon)</option>
        </select>
      </div>
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create project"}
      </button>
      {error ? <p className="banner-err" style={{ marginTop: "1rem" }}>{error}</p> : null}
    </form>
  );
}
