"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  loreCategoryMeta,
  type CommunityLoreListItem,
} from "@/lib/community-lore";

export function LoreReviewQueue() {
  const { isLoaded, isSignedIn } = useAuth();
  const [lore, setLore] = useState<CommunityLoreListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/community/lore/review");
      const data = (await res.json()) as {
        lore?: CommunityLoreListItem[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Forbidden.");
        setLore([]);
        return;
      }
      setLore(data.lore || []);
    } catch {
      setError("Could not load the review queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void load();
  }, [isLoaded, isSignedIn, load]);

  async function review(id: string, action: "accept" | "deny") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/community/lore/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Review failed.");
        return;
      }
      setLore((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p>
        <Link className="btn ghost" href="/archive">
          ← Back to lore
        </Link>
      </p>

      {error && <p className="lore-error">{error}</p>}
      {loading ? (
        <p className="lore-empty">Loading queue…</p>
      ) : lore.length === 0 ? (
        <div className="lore-empty-card">
          <h3>Queue clear</h3>
          <p>No pending submissions right now.</p>
        </div>
      ) : (
        <ul className="lore-submission-grid">
          {lore.map((item) => (
            <li key={item.id} className="lore-submission-card">
              <p className="lore-submission-label">
                {item.hasPendingRevision
                  ? "Edit · awaiting approval"
                  : "Submission · pending review"}
              </p>
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt=""
                  className="lore-submission-thumb"
                />
              )}
              <span className="lore-chip">
                {loreCategoryMeta(item.category).label}
              </span>
              <h3 className="lore-card-title">{item.title}</h3>
              <p className="lore-card-preview">
                {item.summary || item.body.slice(0, 220)}
              </p>
              <p className="lore-card-meta">
                {item.authorName}
                {item.tags.length > 0 ? ` · ${item.tags.join(", ")}` : ""}
              </p>
              <div className="hero-actions" style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busyId === item.id}
                  onClick={() => review(item.id, "accept")}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busyId === item.id}
                  onClick={() => review(item.id, "deny")}
                >
                  Deny
                </button>
                <Link className="btn soft" href={`/archive/${item.id}`}>
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
