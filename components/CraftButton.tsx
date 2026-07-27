"use client";

import { useState } from "react";

export function CraftButton({ definitionId }: { definitionId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function craft() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/items/craft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition_id: definitionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Craft failed");
      setStatus(
        data.source === "local" || data.ok
          ? "Craft recorded. Connect Supabase on Vercel for persistent instances."
          : "Crafted."
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Craft failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button type="button" className="btn primary" onClick={craft} disabled={busy}>
        {busy ? "Crafting…" : "Craft Quill"}
      </button>
      {status ? <p>{status}</p> : null}
    </div>
  );
}
