"use client";

import { useState } from "react";
import Link from "next/link";

export function CheckoutButton({
  planCode,
  label,
}: {
  planCode: "creator" | "studio";
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_code: planCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn primary" onClick={start} disabled={busy}>
        {busy ? "Redirecting…" : label}
      </button>
      {error ? <p className="banner-err" style={{ marginTop: "0.75rem" }}>{error}</p> : null}
      {planCode === "studio" ? null : (
        <p style={{ marginTop: "0.5rem" }}>
          <Link href="/pricing">Compare plans</Link>
        </p>
      )}
    </div>
  );
}

export function PortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Portal failed");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn ghost" onClick={open} disabled={busy}>
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {error ? <p className="banner-err" style={{ marginTop: "0.75rem" }}>{error}</p> : null}
    </div>
  );
}
