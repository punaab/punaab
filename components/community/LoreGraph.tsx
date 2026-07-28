"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MutableRefObject,
} from "react";
import {
  downloadLabelForCategory,
  LORE_CATEGORIES,
  loreCategoryMeta,
  type CommunityLoreEdge,
  type CommunityLoreListItem,
  type LoreCategoryId,
} from "@/lib/community-lore";
import {
  categorySpokeRadius,
  drawCategoryGlyph,
  drawLoreSymbol,
  LORE_CATEGORY_COLORS,
  voteRadius,
} from "@/lib/lore-symbols";

type ForceGraphMethods = {
  d3Force: (name: string, force?: unknown) => unknown;
  d3ReheatSimulation: () => void;
  zoomToFit: (durationMs?: number, padding?: number) => void;
  centerAt: (x?: number, y?: number, durationMs?: number) => void;
  zoom: (scale?: number, durationMs?: number) => number | void;
};

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  {
    ssr: false,
    loading: () => <p className="lore-empty">Spreading the map…</p>,
  }
) as ComponentType<Record<string, unknown>>;

type GraphNode = CommunityLoreListItem & {
  name: string;
  val: number;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  /** Set on the eight synthetic spokes. Entries never carry it. */
  categoryNode?: LoreCategoryId;
  /** Entries under this spoke, from the API's totals. */
  entryCount?: number;
};

/** Synthetic ids never collide with a lore row's uuid. */
const CATEGORY_ID = (id: LoreCategoryId) => `cat:${id}`;

/**
 * How many categories open on their own.
 *
 * The graph is meant to show the shape of the world at a glance, so the
 * biggest areas are already open when you arrive — but every expanded category
 * drags its whole entry list into the force simulation, and eight of those at
 * once is a hairball nobody can read and the layout never settles. Three is
 * what fits while still leaving the spokes legible.
 */
const AUTO_EXPAND = 3;

/** Entries pulled per category when it opens. */
const CATEGORY_PAGE = 24;

type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
  kind: string;
};

function linkEndId(end: string | GraphNode): string {
  return typeof end === "string" ? end : end.id;
}

export function LoreGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const hubImageRef = useRef<HTMLImageElement | null>(null);
  const thumbCache = useRef(new Map<string, HTMLImageElement>());
  const fitPending = useRef(false);
  const [hubReady, setHubReady] = useState(false);
  const [, setThumbTick] = useState(0);
  const [width, setWidth] = useState(720);
  const [height, setHeight] = useState(560);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kept for the export link. The graph no longer filters by a single
  // category — it expands them instead — so nothing sets this any more.
  const [category] = useState<LoreCategoryId | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CommunityLoreListItem | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Set<LoreCategoryId>>(new Set());
  const nodeIndex = useRef(new Map<string, GraphNode>());
  /** Categories whose entries have already been fetched. */
  const fetchedCategories = useRef(new Set<LoreCategoryId>());

  useEffect(() => {
    const img = new Image();
    img.src = "/assets/pun.png";
    img.onload = () => {
      hubImageRef.current = img;
      setHubReady(true);
    };
  }, []);

  useEffect(() => {
    for (const node of nodes) {
      if (!node.imageUrl || thumbCache.current.has(node.imageUrl)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = node.imageUrl;
      img.onload = () => {
        thumbCache.current.set(node.imageUrl!, img);
        setThumbTick((n) => n + 1);
      };
    }
  }, [nodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => {
      setWidth(el.clientWidth || 720);
      setHeight(Math.max(420, el.clientHeight || 560));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Obsidian-style spacing: strong repulsion, long links, soft centering so
   * the cloud can fill the stage instead of collapsing into a knot.
   */
  const tuneForces = useCallback((fg: ForceGraphMethods) => {
    const charge = fg.d3Force("charge") as
      | { strength?: (n: number) => unknown; distanceMax?: (n: number) => unknown }
      | undefined;
    charge?.strength?.(-420);
    charge?.distanceMax?.(520);

    const link = fg.d3Force("link") as
      | {
          distance?: (fn: (l: GraphLink) => number) => unknown;
          strength?: (fn: (l: GraphLink) => number) => unknown;
        }
      | undefined;
    link?.distance?.((l) => {
      if (l.kind === "spoke") return 180;
      if (l.kind === "category") return 72;
      return 110;
    });
    link?.strength?.((l) => {
      if (l.kind === "spoke") return 0.35;
      if (l.kind === "category") return 0.18;
      return 0.12;
    });

    const center = fg.d3Force("center") as
      | { strength?: (n: number) => unknown }
      | undefined;
    center?.strength?.(0.04);
  }, []);

  const scheduleFit = useCallback(() => {
    fitPending.current = true;
  }, []);

  const applyFit = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || !fitPending.current) return;
    fitPending.current = false;
    // A beat after settle so positions are stable before the camera moves.
    window.setTimeout(() => fg.zoomToFit(500, 56), 40);
  }, []);

  /**
   * Loads one category's entries and hangs them off its spoke.
   *
   * Nothing is fetched until a category is opened, which is the whole point of
   * the two-level shape: eight categories cost eight nodes, not eight hundred.
   */
  const loadCategory = useCallback(
    async (id: LoreCategoryId) => {
      if (fetchedCategories.current.has(id)) return;
      fetchedCategories.current.add(id);
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          offset: "0",
          limit: String(CATEGORY_PAGE),
          sort: "votes",
          category: id,
        });
        if (query.trim()) params.set("q", query.trim());

        const res = await fetch(`/api/community/lore/graph?${params}`);
        const data = (await res.json()) as {
          nodes?: CommunityLoreListItem[];
          edges?: CommunityLoreEdge[];
          error?: string;
        };
        if (!res.ok) {
          // Allow a retry: a category that failed is not a category that is
          // empty, and leaving it marked fetched would make the difference
          // permanent.
          fetchedCategories.current.delete(id);
          setError(data.error || "Could not load that area.");
          return;
        }

        const entries = (data.nodes || [])
          .filter((n) => !n.isHub)
          .map((n): GraphNode => ({
            ...n,
            name: n.title,
            val: voteRadius(n.voteCount, false),
          }));

        for (const entry of entries) nodeIndex.current.set(entry.id, entry);
        setNodes([...nodeIndex.current.values()]);
        scheduleFit();

        const present = new Set(nodeIndex.current.keys());
        setLinks((prev) => {
          const seen = new Set(
            prev.map(
              (l) => `${linkEndId(l.source)}|${linkEndId(l.target)}|${l.kind}`
            )
          );
          const merged = [...prev];
          const push = (source: string, target: string, kind: string) => {
            const key = `${source}|${target}|${kind}`;
            if (seen.has(key)) return;
            seen.add(key);
            merged.push({ source, target, kind });
          };
          // Every entry hangs off its own spoke, so the hierarchy is what the
          // force layout actually solves rather than something drawn on top.
          for (const entry of entries) push(CATEGORY_ID(id), entry.id, "category");
          // Then the real authored links between entries.
          for (const edge of data.edges || []) {
            if (present.has(edge.from) && present.has(edge.to)) {
              push(edge.from, edge.to, edge.kind);
            }
          }
          return merged;
        });
      } catch {
        fetchedCategories.current.delete(id);
        setError("Could not reach the lore graph.");
      } finally {
        setLoading(false);
      }
    },
    [query, scheduleFit]
  );

  /** Opens or closes a spoke. Closing keeps the fetched entries cached. */
  const toggleCategory = useCallback(
    (id: LoreCategoryId) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else {
          next.add(id);
          void loadCategory(id);
        }
        scheduleFit();
        return next;
      });
      window.setTimeout(() => {
        const fg = fgRef.current;
        if (!fg) return;
        tuneForces(fg);
        fg.d3ReheatSimulation();
      }, 0);
    },
    [loadCategory, scheduleFit, tuneForces]
  );

  // --- The first level: hub + eight spokes --------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // limit=1 because all this call is for is the hub and the totals; the
        // entries themselves arrive per category, on demand.
        const res = await fetch("/api/community/lore/graph?limit=10&sort=votes");
        const data = (await res.json()) as {
          counts?: Record<string, number>;
          nodes?: CommunityLoreListItem[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Could not load the lore graph.");
          return;
        }

        const totals = data.counts ?? {};
        setCounts(totals);

        nodeIndex.current = new Map();

        const hubRow = (data.nodes || []).find((n) => n.isHub);
        if (hubRow) {
          nodeIndex.current.set(hubRow.id, {
            ...hubRow,
            name: hubRow.title,
            val: voteRadius(hubRow.voteCount, true),
            fx: 0,
            fy: 0,
          });
        }

        // Spokes sized relative to each other — fullest approaches the hub,
        // never surpasses Punaab the Traveling Bard in the middle.
        const peerCounts = LORE_CATEGORIES.map((a) => totals[a.id] ?? 0);
        for (const area of LORE_CATEGORIES) {
          const count = totals[area.id] ?? 0;
          nodeIndex.current.set(CATEGORY_ID(area.id), {
            id: CATEGORY_ID(area.id),
            title: area.label,
            name: area.label,
            summary: area.blurb,
            category: area.id,
            categoryNode: area.id,
            entryCount: count,
            val: categorySpokeRadius(count, peerCounts),
            voteCount: count,
            isHub: false,
          } as GraphNode);
        }

        setNodes([...nodeIndex.current.values()]);
        setLinks(
          hubRow
            ? LORE_CATEGORIES.map((area) => ({
                source: hubRow.id,
                target: CATEGORY_ID(area.id),
                kind: "spoke",
              }))
            : []
        );
        scheduleFit();

        // Open the biggest few straight away, and skip any that are empty —
        // expanding an empty category just makes a spoke look broken.
        const biggest = [...LORE_CATEGORIES]
          .filter((area) => (totals[area.id] ?? 0) > 0)
          .sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))
          .slice(0, AUTO_EXPAND);
        setExpanded(new Set(biggest.map((area) => area.id)));
        for (const area of biggest) void loadCategory(area.id);
      } catch {
        if (!cancelled) setError("Could not reach the lore graph.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately not depending on `loadCategory`: it changes with `query`,
    // and rebuilding the whole first level on every keystroke would reset the
    // layout mid-search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Only what is currently open.
   *
   * Collapsing a category filters its entries out of the simulation rather
   * than deleting them — they stay in `nodeIndex` so reopening is instant and
   * costs no fetch. What matters for performance is how many bodies the force
   * layout is integrating, and that is exactly this list.
   */
  const graphData = useMemo(() => {
    const visible = nodes.filter((node) => {
      if (node.isHub || node.categoryNode) return true;
      return expanded.has(node.category);
    });
    const ids = new Set(visible.map((n) => n.id));
    const visibleLinks = links.filter((l) => {
      const source = linkEndId(l.source);
      const target = linkEndId(l.target);
      return ids.has(source) && ids.has(target);
    });
    return { nodes: visible, links: visibleLinks };
  }, [nodes, links, expanded]);

  /** Neighbours of the focused node — Obsidian dims everything else. */
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const next = new Set<string>([focusId]);
    for (const link of graphData.links) {
      const source = linkEndId(link.source);
      const target = linkEndId(link.target);
      if (source === focusId || target === focusId) {
        next.add(source);
        next.add(target);
      }
    }
    return next;
  }, [focusId, graphData.links]);

  const exportHref =
    category === "all"
      ? "/api/community/lore/export"
      : `/api/community/lore/export?category=${category}`;

  const focusOnNode = useCallback(
    (node: GraphNode) => {
      setFocusId(node.id);
      const fg = fgRef.current;
      if (!fg || node.x == null || node.y == null) return;
      fg.centerAt(node.x, node.y, 420);
      fg.zoom(1.55, 420);
      tuneForces(fg);
      fg.d3ReheatSimulation();
    },
    [tuneForces]
  );

  const clearFocus = useCallback(() => {
    setFocusId(null);
    setSelected(null);
    scheduleFit();
    window.setTimeout(() => {
      const fg = fgRef.current;
      if (!fg) return;
      tuneForces(fg);
      fg.d3ReheatSimulation();
      applyFit();
    }, 0);
  }, [applyFit, scheduleFit, tuneForces]);

  // Configure forces once the graph instance mounts / resizes.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    tuneForces(fg);
    fg.d3ReheatSimulation();
    scheduleFit();
  }, [width, height, graphData.nodes.length, scheduleFit, tuneForces]);

  return (
    <div className="lore-graph">
      <div className="lore-graph-toolbar">
        <div className="lore-areas" role="tablist" aria-label="Graph areas">
          <button
            type="button"
            className="lore-area-tab"
            onClick={() => {
              const withEntries = LORE_CATEGORIES.filter(
                (area) => (counts[area.id] ?? 0) > 0
              );
              const openAll = expanded.size < withEntries.length;
              setExpanded(
                openAll ? new Set(withEntries.map((a) => a.id)) : new Set()
              );
              if (openAll) for (const a of withEntries) void loadCategory(a.id);
              scheduleFit();
              window.setTimeout(() => {
                const fg = fgRef.current;
                if (!fg) return;
                tuneForces(fg);
                fg.d3ReheatSimulation();
              }, 0);
            }}
          >
            {expanded.size >=
            LORE_CATEGORIES.filter((a) => (counts[a.id] ?? 0) > 0).length
              ? "Collapse all"
              : "Expand all"}
          </button>
          {LORE_CATEGORIES.map((area) => {
            const count = counts[area.id] ?? 0;
            return (
              <button
                key={area.id}
                type="button"
                className={`lore-area-tab${expanded.has(area.id) ? " is-active" : ""}`}
                onClick={() => toggleCategory(area.id)}
                disabled={count === 0}
                title={count === 0 ? "Nothing here yet" : undefined}
              >
                {area.label}
                <span className="lore-area-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="lore-graph-actions">
          <input
            className="lore-graph-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, tags…"
            aria-label="Search lore graph"
          />
          <a className="btn ghost" href={exportHref}>
            {downloadLabelForCategory(category === "all" ? "all" : category)}
          </a>
        </div>
      </div>

      <ul className="lore-graph-legend" aria-label="Symbol legend">
        {LORE_CATEGORIES.map((area) => (
          <li key={area.id}>
            <LegendGlyph category={area.id} />
            {area.label}
          </li>
        ))}
      </ul>

      {error && <p className="lore-error">{error}</p>}

      <div className="lore-graph-stage" ref={containerRef}>
        <ForceGraph2D
          ref={fgRef as MutableRefObject<ForceGraphMethods | undefined>}
          width={width}
          height={height}
          graphData={graphData}
          nodeId="id"
          nodeRelSize={1}
          backgroundColor="rgba(0,0,0,0)"
          d3AlphaDecay={0.018}
          d3VelocityDecay={0.28}
          cooldownTicks={180}
          warmupTicks={40}
          onEngineStop={applyFit}
          onBackgroundClick={clearFocus}
          linkColor={(link: GraphLink) => {
            const source = linkEndId(link.source);
            const target = linkEndId(link.target);
            const inFocus =
              !focusSet || focusSet.has(source) || focusSet.has(target);
            if (!inFocus) return "rgba(21, 34, 56, 0.04)";
            if (focusSet && (source === focusId || target === focusId)) {
              return "rgba(138, 90, 18, 0.85)";
            }
            if (link.kind === "spoke") return "rgba(21, 34, 56, 0.38)";
            if (link.kind === "category") return "rgba(21, 34, 56, 0.18)";
            return "rgba(21, 34, 56, 0.32)";
          }}
          linkWidth={(link: GraphLink) => {
            const source = linkEndId(link.source);
            const target = linkEndId(link.target);
            if (focusSet && (source === focusId || target === focusId)) {
              return 2.6;
            }
            return link.kind === "spoke" ? 2 : 1.05;
          }}
          onNodeClick={(node: GraphNode) => {
            if (node.categoryNode) {
              // Open closed areas so their threads can appear; leave open ones
              // alone so a focus click does not collapse the neighbourhood.
              if (!expanded.has(node.categoryNode)) {
                toggleCategory(node.categoryNode);
              }
              focusOnNode(node);
              return;
            }
            setSelected(node);
            focusOnNode(node);
          }}
          nodeCanvasObject={(
            node: GraphNode,
            ctx: CanvasRenderingContext2D,
            globalScale: number
          ) => {
            const r = (node.val || 8) * (node.isHub ? 1.15 : 1);
            const x = node.x || 0;
            const y = node.y || 0;
            const dimmed = Boolean(focusSet && !focusSet.has(node.id));
            const isFocus = focusId === node.id;
            ctx.save();
            if (dimmed) ctx.globalAlpha = 0.18;

            // A spoke is drawn as a ring, not a token: filled when open,
            // hollow when closed, so its state is readable without a legend.
            // The count sits inside it, which is the number that tells you
            // whether an area is worth opening.
            if (node.categoryNode) {
              // Read from the set rather than a flag stamped on the node:
              // mutating simulation nodes to carry UI state means the renderer
              // and React disagree for a frame whenever one updates first.
              const isOpen = expanded.has(node.categoryNode);
              const colour =
                LORE_CATEGORY_COLORS[node.categoryNode] || "#152238";
              const parchment = "rgba(255, 250, 240, 0.96)";
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fillStyle = isOpen ? colour : parchment;
              ctx.fill();
              ctx.lineWidth = Math.max(1.8, r * 0.14);
              ctx.strokeStyle = colour;
              ctx.stroke();

              if (isFocus) {
                ctx.beginPath();
                ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
                ctx.lineWidth = Math.max(2, r * 0.1);
                ctx.strokeStyle = "rgba(138, 90, 18, 0.9)";
                ctx.stroke();
              }

              // Closed categories get a dashed outer ring — the visual cue that
              // there is more behind them.
              if (!isOpen && (node.entryCount ?? 0) > 0) {
                ctx.beginPath();
                ctx.setLineDash([r * 0.28, r * 0.22]);
                ctx.arc(x, y, r * 1.28, 0, Math.PI * 2);
                ctx.lineWidth = Math.max(1, r * 0.08);
                ctx.strokeStyle = colour;
                ctx.stroke();
                ctx.setLineDash([]);
              }

              // Category glyph: what this spoke is. Open discs are colour-filled,
              // so glyphs go cream (with translucent fills so detail lines read).
              // Closed discs are parchment, so glyphs go in category colour.
              const cream = "#fffaf0";
              drawCategoryGlyph(
                ctx,
                node.categoryNode,
                x,
                y,
                r * 0.52,
                isOpen ? cream : colour,
                isOpen ? "rgba(255, 250, 240, 0.18)" : cream,
                isOpen ? cream : colour
              );

              // Count sits as a corner chip so the glyph keeps the center.
              const count = node.entryCount ?? 0;
              if (count > 0) {
                const badgeX = x + r * 0.72;
                const badgeY = y + r * 0.72;
                const badgeR = Math.max(5.5, Math.min(7.5, r * 0.3));
                ctx.beginPath();
                ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
                ctx.fillStyle = isOpen ? cream : colour;
                ctx.fill();
                ctx.lineWidth = 1.2;
                ctx.strokeStyle = isOpen ? colour : cream;
                ctx.stroke();
                ctx.font = `700 ${Math.max(6, badgeR * 1.05)}px "Iowan Old Style", Palatino, Georgia, serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = isOpen ? colour : cream;
                ctx.fillText(String(count), badgeX, badgeY + 0.3);
              }

              ctx.font = `600 ${Math.max(6, 11 / globalScale)}px "Iowan Old Style", Palatino, Georgia, serif`;
              ctx.fillStyle = "#152238";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(
                node.name,
                x,
                y + r + Math.max(7, 12 / globalScale)
              );
              ctx.restore();
              return;
            }

            if (node.isHub && hubImageRef.current && hubReady) {
              ctx.save();
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();
              const img = hubImageRef.current;
              const size = r * 2;
              ctx.drawImage(img, x - r, y - r, size, size);
              ctx.restore();
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.lineWidth = Math.max(1.5, r * 0.12);
              ctx.strokeStyle = "#152238";
              ctx.stroke();
            } else if (
              node.imageUrl &&
              thumbCache.current.get(node.imageUrl)
            ) {
              const img = thumbCache.current.get(node.imageUrl)!;
              ctx.save();
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();
              ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
              ctx.restore();
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.lineWidth = Math.max(1.2, r * 0.1);
              ctx.strokeStyle =
                LORE_CATEGORY_COLORS[node.category] || "#152238";
              ctx.stroke();
            } else {
              drawLoreSymbol(
                ctx,
                node.category,
                x,
                y,
                r,
                "#fffaf0",
                "#152238"
              );
            }

            if (isFocus) {
              ctx.beginPath();
              ctx.arc(x, y, r * 1.4, 0, Math.PI * 2);
              ctx.lineWidth = Math.max(2, r * 0.12);
              ctx.strokeStyle = "rgba(138, 90, 18, 0.95)";
              ctx.stroke();
            }

            const fontSize = Math.max(10 / globalScale, 2.4);
            if (globalScale > 0.55 || node.isHub || isFocus) {
              ctx.font = `${node.isHub ? "700" : "600"} ${fontSize}px Georgia, serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = "rgba(21, 34, 56, 0.92)";
              ctx.fillText(node.title, x, y + r + 2);
            }
            ctx.restore();
          }}
          nodePointerAreaPaint={(
            node: GraphNode,
            color: string,
            ctx: CanvasRenderingContext2D
          ) => {
            const r = (node.val || 8) + 3;
            ctx.beginPath();
            ctx.arc(node.x || 0, node.y || 0, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }}
        />
      </div>

      <div className="lore-graph-footer">
        <span className="lore-graph-status">
          {loading
            ? "Drawing threads…"
            : focusId
              ? "Showing connections · click the background to reset"
              : expanded.size === 0
                ? "Click an area to open it."
                : `${expanded.size} of ${LORE_CATEGORIES.length} areas open · click a node to follow its threads`}
        </span>
      </div>

      {selected && (
        <aside className="lore-graph-panel">
          <p className="lore-chip">
            {loreCategoryMeta(selected.category).label}
          </p>
          <h3>{selected.title}</h3>
          {selected.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.imageUrl}
              alt=""
              className="lore-submission-thumb"
            />
          )}
          <p>{selected.summary || selected.body.slice(0, 180)}</p>
          <p className="lore-card-meta">
            <span>{selected.voteCount} votes</span>
            <span className="dot">•</span>
            <span>{selected.authorName}</span>
          </p>
          <div className="hero-actions" style={{ marginTop: "0.75rem" }}>
            <Link className="btn primary" href={`/world/${selected.id}`}>
              Open entry
            </Link>
            <a
              className="btn ghost"
              href={`/api/community/lore/export?node=${selected.id}`}
            >
              Download node
            </a>
            <button
              type="button"
              className="btn soft"
              onClick={() => clearFocus()}
            >
              Close
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}

function LegendGlyph({ category }: { category: LoreCategoryId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 18;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colour = LORE_CATEGORY_COLORS[category];
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    drawCategoryGlyph(
      ctx,
      category,
      size / 2,
      size / 2,
      size * 0.28,
      "#fffaf0",
      "rgba(255, 250, 240, 0.2)",
      "#fffaf0"
    );
  }, [category]);
  return (
    <canvas
      ref={ref}
      className="lore-legend-glyph"
      width={18}
      height={18}
      style={{ background: LORE_CATEGORY_COLORS[category] }}
      aria-hidden
    />
  );
}
