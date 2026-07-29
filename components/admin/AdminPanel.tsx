"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loreCategoryMeta,
  type CommunityLoreListItem,
} from "@/lib/community-lore";

type Filter = "all" | "new" | "edits";

type ReviewPayload = {
  lore?: CommunityLoreListItem[];
  stats?: {
    newSubmissions: number;
    pendingEdits: number;
    acceptedLive: number;
  };
  error?: string;
};

export function AdminPanel() {
  const { isLoaded, isSignedIn } = useAuth();
  const [lore, setLore] = useState<CommunityLoreListItem[]>([]);
  const [stats, setStats] = useState({
    newSubmissions: 0,
    pendingEdits: 0,
    acceptedLive: 0,
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/community/lore/review");
      const data = (await res.json()) as ReviewPayload;
      if (!res.ok) {
        setError(data.error || "Forbidden.");
        setLore([]);
        return;
      }
      const next = data.lore || [];
      setLore(next);
      setStats({
        newSubmissions: data.stats?.newSubmissions ?? 0,
        pendingEdits: data.stats?.pendingEdits ?? 0,
        acceptedLive: data.stats?.acceptedLive ?? 0,
      });
      setSelectedId((prev) =>
        prev && next.some((item) => item.id === prev)
          ? prev
          : next[0]?.id ?? null
      );
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

  const visible = useMemo(() => {
    if (filter === "new") return lore.filter((item) => !item.hasPendingRevision);
    if (filter === "edits") return lore.filter((item) => item.hasPendingRevision);
    return lore;
  }, [filter, lore]);

  const selected =
    visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  const review = useCallback(async (id: string, action: "accept" | "deny") => {
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
      setLore((prev) => {
        const item = prev.find((row) => row.id === id);
        const next = prev.filter((row) => row.id !== id);
        setSelectedId(next[0]?.id ?? null);
        if (item) {
          setStats((s) => {
            if (item.hasPendingRevision) {
              return {
                ...s,
                pendingEdits: Math.max(0, s.pendingEdits - 1),
              };
            }
            return {
              ...s,
              newSubmissions: Math.max(0, s.newSubmissions - 1),
              acceptedLive:
                action === "accept" ? s.acceptedLive + 1 : s.acceptedLive,
            };
          });
        }
        return next;
      });
    } finally {
      setBusyId(null);
    }
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!selected || busyId) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        void review(selected.id, "accept");
      } else if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        void review(selected.id, "deny");
      } else if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const idx = visible.findIndex((item) => item.id === selected.id);
        const next = visible[Math.min(visible.length - 1, idx + 1)];
        if (next) setSelectedId(next.id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const idx = visible.findIndex((item) => item.id === selected.id);
        const next = visible[Math.max(0, idx - 1)];
        if (next) setSelectedId(next.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, busyId, visible, review]);

  return (
    <section className="admin-panel">
      <header className="admin-header">
        <div className="admin-header-copy">
          <p className="admin-eyebrow">Punaab · Private</p>
          <h1>Admin</h1>
          <p className="admin-lead">
            Approve Archive submissions and staged edits. Only your account can
            open this desk.
          </p>
        </div>
        <div className="admin-header-actions">
          <button
            type="button"
            className="btn soft"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </button>
          <Link className="btn ghost" href="/archive">
            Archive
          </Link>
        </div>
      </header>

      <div className="admin-stats" aria-label="Queue summary">
        <div className="admin-stat">
          <strong>{stats.newSubmissions}</strong>
          <span>New submissions</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.pendingEdits}</strong>
          <span>Pending edits</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.acceptedLive}</strong>
          <span>Live entries</span>
        </div>
        <div className="admin-stat admin-stat-hint">
          <strong>A / D</strong>
          <span>Accept / Deny</span>
        </div>
      </div>

      <div className="admin-toolbar" role="tablist" aria-label="Queue filter">
        {(
          [
            ["all", `All (${lore.length})`],
            ["new", `New (${stats.newSubmissions})`],
            ["edits", `Edits (${stats.pendingEdits})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={`admin-filter${filter === id ? " is-active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      {loading ? (
        <p className="admin-empty">Loading queue…</p>
      ) : visible.length === 0 ? (
        <div className="admin-empty-card">
          <h2>Queue clear</h2>
          <p>Nothing waiting. New Archive posts will land here.</p>
        </div>
      ) : (
        <div className="admin-desk">
          <ul className="admin-list" aria-label="Pending items">
            {visible.map((item) => {
              const active = selected?.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`admin-list-item${active ? " is-active" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                    aria-current={active ? "true" : undefined}
                  >
                    <span className="admin-list-kind">
                      {item.hasPendingRevision ? "Edit" : "New"}
                    </span>
                    <span className="admin-list-title">{item.title}</span>
                    <span className="admin-list-meta">
                      {loreCategoryMeta(item.category).label}
                      {" · "}
                      {item.authorName}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <article className="admin-detail" aria-live="polite">
              <div className="admin-detail-top">
                <p className="admin-detail-label">
                  {selected.hasPendingRevision
                    ? "Edit · awaiting approval"
                    : "Submission · pending review"}
                </p>
                <span className="admin-chip">
                  {loreCategoryMeta(selected.category).label}
                </span>
              </div>

              {selected.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.imageUrl}
                  alt=""
                  className="admin-detail-thumb"
                />
              ) : null}

              <h2>{selected.title}</h2>
              <p className="admin-detail-meta">
                {selected.authorName}
                {selected.tags.length > 0
                  ? ` · ${selected.tags.join(", ")}`
                  : ""}
              </p>
              {selected.summary ? (
                <p className="admin-detail-summary">{selected.summary}</p>
              ) : null}
              <div className="admin-detail-body">
                {selected.body.slice(0, 2400)}
                {selected.body.length > 2400 ? "…" : ""}
              </div>

              <div className="admin-detail-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busyId === selected.id}
                  onClick={() => void review(selected.id, "accept")}
                >
                  {busyId === selected.id ? "Working…" : "Accept"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busyId === selected.id}
                  onClick={() => void review(selected.id, "deny")}
                >
                  Deny
                </button>
                <Link className="btn soft" href={`/archive/${selected.id}`}>
                  Open entry
                </Link>
              </div>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}
