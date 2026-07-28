"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RevokeKeyButton({ keyId }: { keyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    await fetch("/api/v1/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key_id: keyId }),
    });
    router.refresh();
    setBusy(false);
  }

  return (
    <button type="button" className="btn danger" onClick={revoke} disabled={busy}>
      {busy ? "…" : "Revoke"}
    </button>
  );
}
