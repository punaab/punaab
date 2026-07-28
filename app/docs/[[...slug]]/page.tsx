import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";

const TOC = [
  { href: "/docs/getting-started", label: "Getting Started" },
  { href: "/docs/authentication", label: "Authentication" },
  { href: "/docs/projects", label: "Projects" },
  { href: "/docs/godot", label: "Godot Plugin" },
  { href: "/docs/ai", label: "AI" },
  { href: "/docs/music", label: "Music" },
  { href: "/docs/merchant", label: "Merchant" },
  { href: "/docs/customization", label: "Customization" },
  { href: "/docs/api", label: "API Reference" },
  { href: "/docs/faq", label: "FAQ" },
  { href: "/docs/roadmap", label: "Roadmap" },
];

const PAGES: Record<
  string,
  { title: string; body: ReactNode }
> = {
  index: {
    title: "Documentation",
    body: (
      <>
        <p>
          Punaab is a traveling bard you drop into games. The website manages
          projects and keys; the Godot plugin talks to the versioned API.
        </p>
        <p>
          Start here: <Link href="/docs/getting-started">Getting Started</Link>
        </p>
      </>
    ),
  },
  "getting-started": {
    title: "Getting Started",
    body: (
      <>
        <ol>
          <li>
            <Link href="/sign-up">Create an account</Link>
          </li>
          <li>
            Open the <Link href="/dashboard/projects">dashboard</Link> and create
            a project
          </li>
          <li>Generate an API key</li>
          <li>
            <Link href="/dashboard/downloads">Download the Godot plugin</Link>
          </li>
          <li>Enable the addon, add a Punaab node, paste the key, run</li>
        </ol>
        <pre>{`# Runtime config
GET /api/v1/config
X-Api-Key: pg_...

# Talk to the bard
POST /api/v1/dialogue
{ "message": "Sing me a song of the old roads" }`}</pre>
      </>
    ),
  },
  authentication: {
    title: "Authentication",
    body: (
      <>
        <p>
          Dashboard uses Clerk sessions. Game runtimes use project API keys via{" "}
          <code>X-Api-Key</code> or <code>Authorization: Bearer</code>.
        </p>
      </>
    ),
  },
  projects: {
    title: "Projects",
    body: (
      <>
        <p>
          Each project has a mode (cloud / hybrid / local), API keys, character
          config, lore, items, and playlists.
        </p>
      </>
    ),
  },
  godot: {
    title: "Godot Plugin",
    body: (
      <>
        <p>Godot 4 addon under <code>addons/punaab</code>.</p>
        <ol>
          <li>Unzip into your Godot project</li>
          <li>Project → Project Settings → Plugins → enable Punaab</li>
          <li>Add <code>Punaab</code> node to a scene</li>
          <li>Set <code>api_key</code> and optional <code>api_base</code></li>
          <li>Run — Punaab loads config and can chat</li>
        </ol>
      </>
    ),
  },
  ai: {
    title: "AI",
    body: (
      <>
        <p>
          Cloud mode hosts the brain and burns credits. Hybrid/local keep the
          same request shape; providers swap underneath.
        </p>
        <pre>{`POST /api/v1/dialogue
→ { "reply": "...", "behaviors": ["talk","sing"] }`}</pre>
      </>
    ),
  },
  music: {
    title: "Music",
    body: (
      <>
        <p>
          Playlists, radio, shuffle, and loop. Upload tracks per project; the
          plugin requests the next song from <code>/api/v1/music</code>.
        </p>
      </>
    ),
  },
  merchant: {
    title: "Merchant",
    body: (
      <>
        <p>
          Items with name, description, price, category. Plugin opens shop UI
          from the <code>open_shop</code> behavior.
        </p>
      </>
    ),
  },
  customization: {
    title: "Customization",
    body: (
      <>
        <p>
          Punaab keeps one look and one voice. Tune personality and loadout
          (hat, instrument, cape…) in the character builder without changing who
          he is.
        </p>
      </>
    ),
  },
  api: {
    title: "API Reference",
    body: (
      <>
        <pre>{`GET  /api/v1/config
GET  /api/v1/behaviors
GET  /api/v1/merchant
GET  /api/v1/music
POST /api/v1/dialogue
GET  /api/v1/plugins/godot/latest

Dashboard (Clerk):
GET/POST /api/v1/projects
GET/POST/DELETE /api/v1/keys
GET/POST /api/v1/characters
GET /api/v1/credits`}</pre>
      </>
    ),
  },
  faq: {
    title: "FAQ",
    body: (
      <>
        <p>
          <strong>Do I need crypto?</strong> No. Stripe cards today; Coin is
          optional later.
        </p>
        <p>
          <strong>Does local AI cost credits?</strong> No — only cloud features.
        </p>
      </>
    ),
  },
  roadmap: {
    title: "Roadmap",
    body: (
      <>
        <ul>
          <li>Unity / Unreal / Roblox / Three.js SDKs</li>
          <li>Marketplace for skins, music, quests</li>
          <li>Local AI downloads + hybrid mode</li>
          <li>Multiplayer sync, Discord bot, MCP</li>
        </ul>
      </>
    ),
  },
};

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const key = slug?.[0] || "index";
  const page = PAGES[key] || PAGES.index;

  return (
    <MarketingShell>
      <div className="docs-layout">
        <aside className="docs-toc">
          <p className="meta">Docs</p>
          {TOC.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </aside>
        <article className="docs-body card">
          <h1>{page.title}</h1>
          {page.body}
        </article>
      </div>
    </MarketingShell>
  );
}
