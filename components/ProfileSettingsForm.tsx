"use client";

import { useState } from "react";

type LocaleOption = { code: string; label: string };
type ProfessionOption = { id: string; name: string; blurb: string };

export function ProfileSettingsForm({
  locales,
  professions,
}: {
  locales: LocaleOption[];
  professions: ProfessionOption[];
}) {
  const [locale, setLocale] = useState("en");
  const [profession, setProfession] = useState(professions[0]?.id ?? "chronicler");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, profession }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus("Saved. Locale and profession preference recorded.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSave}>
      <div className="form-row">
        <label htmlFor="locale">Language</label>
        <select
          id="locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
        >
          {locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="profession">Starting profession focus</label>
        <select
          id="profession"
          value={profession}
          onChange={(e) => setProfession(e.target.value)}
        >
          {professions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.blurb}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn primary" disabled={saving}>
        {saving ? "Saving…" : "Save settings"}
      </button>
      {status ? <p style={{ marginTop: "0.85rem" }}>{status}</p> : null}
    </form>
  );
}
