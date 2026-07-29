"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LORE_CATEGORIES,
  LORE_LINK_KINDS,
  loreCategoryMeta,
  loreLinkKindLabel,
  type CommunityLoreListItem,
  type LoreCategoryId,
  type LoreLinkKind,
} from "@/lib/community-lore";

export type LoreLinkDraft = {
  toId: string;
  kind: LoreLinkKind;
  note?: string;
};

export type LoreLinkKnown = {
  id: string;
  title: string;
  category: LoreCategoryId;
};

type LoreConnectionsEditorProps = {
  category: LoreCategoryId;
  links: LoreLinkDraft[];
  onChange: (links: LoreLinkDraft[]) => void;
  /** Exclude self when editing. */
  excludeId?: string;
  /** Titles for already-linked entries (so pills survive filter changes). */
  known?: LoreLinkKnown[];
};

async function fetchChoices(opts: {
  q: string;
  category: LoreCategoryId | "all";
  excludeId?: string;
}): Promise<CommunityLoreListItem[]> {
  const params = new URLSearchParams({
    sort: "alpha",
    limit: "200",
  });
  if (opts.q.trim()) params.set("q", opts.q.trim());
  if (opts.category !== "all") params.set("category", opts.category);
  const res = await fetch(`/api/community/lore?${params}`);
  const data = (await res.json()) as { lore?: CommunityLoreListItem[] };
  return (data.lore || []).filter(
    (item) => !item.isHub && item.id !== opts.excludeId
  );
}

function upsertLink(
  links: LoreLinkDraft[],
  next: LoreLinkDraft,
  singleKind?: boolean
): LoreLinkDraft[] {
  const without =
    singleKind
      ? links.filter((link) => link.kind !== next.kind)
      : links.filter(
          (link) => !(link.toId === next.toId && link.kind === next.kind)
        );
  return [...without, next];
}

const EMPTY_KINDS: LoreLinkKind[] = [];
const QUEST_HIDE_KINDS: LoreLinkKind[] = ["given_by", "involves"];

/**
 * Tag other Archive entries onto a draft — with quest-specific character roles
 * (giver / involves) plus a general connect picker for everything else.
 */
export function LoreConnectionsEditor({
  category,
  links,
  onChange,
  excludeId,
  known = [],
}: LoreConnectionsEditorProps) {
  const isQuest = category === "quests";

  const [knownMap, setKnownMap] = useState<Map<string, LoreLinkKnown>>(() => {
    const map = new Map<string, LoreLinkKnown>();
    for (const row of known) map.set(row.id, row);
    return map;
  });

  useEffect(() => {
    setKnownMap((prev) => {
      const next = new Map(prev);
      for (const row of known) next.set(row.id, row);
      return next;
    });
  }, [known]);

  function remember(item: Pick<CommunityLoreListItem, "id" | "title" | "category">) {
    setKnownMap((prev) => {
      const next = new Map(prev);
      next.set(item.id, {
        id: item.id,
        title: item.title,
        category: item.category,
      });
      return next;
    });
  }

  function resolve(toId: string): LoreLinkKnown | null {
    return knownMap.get(toId) ?? null;
  }

  function setGiver(item: CommunityLoreListItem | null) {
    if (item) remember(item);
    onChange(
      item
        ? upsertLink(links, { toId: item.id, kind: "given_by" }, true)
        : links.filter((link) => link.kind !== "given_by")
    );
  }

  function toggleInvolves(item: CommunityLoreListItem) {
    remember(item);
    const exists = links.some(
      (link) => link.toId === item.id && link.kind === "involves"
    );
    if (exists) {
      onChange(
        links.filter(
          (link) => !(link.toId === item.id && link.kind === "involves")
        )
      );
      return;
    }
    onChange(upsertLink(links, { toId: item.id, kind: "involves" }));
  }

  function toggleGeneral(item: CommunityLoreListItem, kind: LoreLinkKind) {
    remember(item);
    const exists = links.some(
      (link) => link.toId === item.id && link.kind === kind
    );
    if (exists) {
      onChange(
        links.filter((link) => !(link.toId === item.id && link.kind === kind))
      );
      return;
    }
    onChange(upsertLink(links, { toId: item.id, kind }));
  }

  function removeLink(toId: string, kind: LoreLinkKind) {
    onChange(
      links.filter((link) => !(link.toId === toId && link.kind === kind))
    );
  }

  const giver = links.find((link) => link.kind === "given_by") ?? null;
  const involves = links.filter((link) => link.kind === "involves");
  const otherLinks = links.filter(
    (link) => link.kind !== "given_by" && link.kind !== "involves"
  );

  return (
    <div className="lore-links-block">
      {isQuest && (
        <>
          <CharacterRolePicker
            label="Quest giver"
            hint="Who hands out this job? Pick an existing character or NPC."
            excludeId={excludeId}
            selectedIds={giver ? [giver.toId] : []}
            single
            onPick={(item) => setGiver(item)}
            onClear={() => setGiver(null)}
            resolve={resolve}
          />
          <CharacterRolePicker
            label="Also involves"
            hint="Delivery target, ally, rival — tag other characters in the quest."
            excludeId={excludeId}
            selectedIds={involves.map((link) => link.toId)}
            onPick={toggleInvolves}
            onClearId={(id) => removeLink(id, "involves")}
            resolve={resolve}
          />
        </>
      )}

      <GeneralConnectionsPicker
        excludeId={excludeId}
        links={isQuest ? otherLinks : links}
        allLinks={links}
        onToggle={toggleGeneral}
        onRemove={removeLink}
        resolve={resolve}
        defaultKind={isQuest ? "leads_to" : "related"}
        hideKinds={isQuest ? QUEST_HIDE_KINDS : EMPTY_KINDS}
        heading={
          isQuest
            ? "Also connect (places, items, quests…)"
            : "Connect across the Archive"
        }
      />
    </div>
  );
}

function CharacterRolePicker({
  label,
  hint,
  excludeId,
  selectedIds,
  single,
  onPick,
  onClear,
  onClearId,
  resolve,
}: {
  label: string;
  hint: string;
  excludeId?: string;
  selectedIds: string[];
  single?: boolean;
  onPick: (item: CommunityLoreListItem) => void;
  onClear?: () => void;
  onClearId?: (id: string) => void;
  resolve: (id: string) => LoreLinkKnown | null;
}) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<CommunityLoreListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      void fetchChoices({
        q: query,
        category: "characters",
        excludeId,
      })
        .then((rows) => {
          if (!cancelled) setChoices(rows);
        })
        .catch(() => {
          if (!cancelled) setChoices([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query.trim() ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, excludeId]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className="lore-role-block">
      <div className="lore-links-head">
        <span>{label}</span>
        {single && selectedIds.length > 0 && onClear && (
          <button type="button" className="btn soft" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <p className="meta lore-role-hint">{hint}</p>
      {selectedIds.length > 0 && (
        <div className="lore-link-selected">
          {selectedIds.map((id) => {
            const item = resolve(id) || choices.find((c) => c.id === id);
            const title = item?.title || "Character";
            return (
              <button
                key={id}
                type="button"
                className="lore-link-pill is-on"
                onClick={() => {
                  if (single && onClear) onClear();
                  else onClearId?.(id);
                }}
              >
                Characters: {title} ×
              </button>
            );
          })}
        </div>
      )}
      <input
        className="lore-link-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search characters…"
        aria-label={`Search for ${label}`}
      />
      <div className="lore-link-picker lore-role-picker">
        {loading && choices.length === 0 ? (
          <p className="meta">Loading characters…</p>
        ) : choices.length === 0 ? (
          <p className="meta">
            No characters yet — publish one under Characters, then tag them here.
          </p>
        ) : (
          <div className="lore-link-options">
            {choices.slice(0, 60).map((item) => {
              const on = selectedSet.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`lore-link-pill${on ? " is-on" : ""}`}
                  onClick={() => onPick(item)}
                  aria-pressed={on}
                >
                  {item.title}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function GeneralConnectionsPicker({
  excludeId,
  links,
  allLinks,
  onToggle,
  onRemove,
  resolve,
  defaultKind,
  hideKinds,
  heading,
}: {
  excludeId?: string;
  links: LoreLinkDraft[];
  allLinks: LoreLinkDraft[];
  onToggle: (item: CommunityLoreListItem, kind: LoreLinkKind) => void;
  onRemove: (toId: string, kind: LoreLinkKind) => void;
  resolve: (id: string) => LoreLinkKnown | null;
  defaultKind: LoreLinkKind;
  hideKinds: LoreLinkKind[];
  heading: string;
}) {
  const kindOptions = useMemo(
    () => LORE_LINK_KINDS.filter((k) => !hideKinds.includes(k)),
    [hideKinds]
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LoreCategoryId | "all">("all");
  const [kind, setKind] = useState<LoreLinkKind>(defaultKind);
  const [choices, setChoices] = useState<CommunityLoreListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setKind((prev) =>
      kindOptions.includes(prev) ? prev : kindOptions[0] || "related"
    );
  }, [kindOptions]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      void fetchChoices({ q: query, category: filter, excludeId })
        .then((rows) => {
          if (!cancelled) setChoices(rows);
        })
        .catch(() => {
          if (!cancelled) setChoices([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query.trim() ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, filter, excludeId]);

  const selectedKeys = useMemo(
    () => new Set(allLinks.map((link) => `${link.toId}:${link.kind}`)),
    [allLinks]
  );

  const choicesByCategory = useMemo(() => {
    const groups: Array<{
      category: LoreCategoryId;
      label: string;
      items: CommunityLoreListItem[];
    }> = [];
    for (const area of LORE_CATEGORIES) {
      const items = choices.filter((item) => item.category === area.id);
      if (items.length === 0) continue;
      groups.push({ category: area.id, label: area.label, items });
    }
    return groups;
  }, [choices]);

  return (
    <div className="lore-role-block">
      <div className="lore-links-head">
        <span>{heading}</span>
        {links.length > 0 && (
          <span className="meta">{links.length} selected</span>
        )}
      </div>
      <label className="lore-field lore-link-kind">
        <span className="meta">How they connect</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as LoreLinkKind)}
        >
          {kindOptions.map((k) => (
            <option key={k} value={k}>
              {loreLinkKindLabel(k)}
            </option>
          ))}
        </select>
      </label>
      <input
        className="lore-link-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search art, characters, quests, items…"
        aria-label="Search submissions to connect"
      />
      <div className="lore-link-filters" role="group" aria-label="Filter by area">
        <button
          type="button"
          className={`lore-chip-btn${filter === "all" ? " is-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {LORE_CATEGORIES.map((area) => (
          <button
            key={area.id}
            type="button"
            className={`lore-chip-btn${filter === area.id ? " is-active" : ""}`}
            onClick={() => setFilter(area.id)}
          >
            {area.label}
          </button>
        ))}
      </div>
      {links.length > 0 && (
        <div className="lore-link-selected">
          {links.map((link) => {
            const item = resolve(link.toId);
            const title = item?.title || "Linked entry";
            const area = item
              ? loreCategoryMeta(item.category).label
              : "Entry";
            return (
              <button
                key={`${link.toId}:${link.kind}`}
                type="button"
                className="lore-link-pill is-on"
                onClick={() => onRemove(link.toId, link.kind)}
              >
                {loreLinkKindLabel(link.kind)} · {area}: {title} ×
              </button>
            );
          })}
        </div>
      )}
      <div className="lore-link-picker">
        {loading && choicesByCategory.length === 0 ? (
          <p className="meta">Loading…</p>
        ) : choicesByCategory.length === 0 ? (
          <p className="meta">
            {filter === "characters"
              ? "No characters match — try clearing search, or publish a character first."
              : "No matching submissions."}
          </p>
        ) : (
          choicesByCategory.map((group) => (
            <div key={group.category} className="lore-link-group">
              <p className="lore-link-group-label">{group.label}</p>
              <div className="lore-link-options">
                {group.items.map((item) => {
                  const on = selectedKeys.has(`${item.id}:${kind}`);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`lore-link-pill${on ? " is-on" : ""}`}
                      onClick={() => onToggle(item, kind)}
                      aria-pressed={on}
                    >
                      {item.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
