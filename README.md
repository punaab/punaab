# Punaab

Punaab is a traveling bard you can drop into a game, a website, or a stream.
He walks, sings, trades, and talks.

**Free to download.** Use him in your own story or project, change him, and
monetize what you make. This is a community project — join in and help make him
better.

| | |
|---|---|
| X | https://x.com/notbitcoinceo |
| Pump | https://pump.fun/coin/8xWMreut8z93Pg4Uh1HgY9eWNJJxUtyWnGPjjnuJpump |
| GitHub | https://github.com/punaab/punaab |

## Public repo safety

- Never commit `.env` — only `.env.example` (placeholders).
- Clerk / Supabase / Stripe / OpenAI secrets stay in Vercel (or local `.env`).
- `supabase/.temp/` is ignored (CLI cache).
- API keys and embed tokens are created per project at runtime; they are not
  baked into the repo.

## Stack

- Next.js 16 (App Router) + TypeScript
- Clerk (auth) · Supabase (data) · Stripe (billing)
- three.js + react-three-fiber for the character and the world

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill in Clerk, Supabase, Stripe and
   `OPENAI_API_KEY`
3. Apply the migrations in `supabase/migrations/` in order
4. `npm run dev`

## Routes

| Path | Purpose |
|------|---------|
| `/` | Homepage — the 3D valley Punaab travels |
| `/demo` | Turntable preview + free glTF model download |
| `/pricing` | Plans |
| `/docs` | Guides |
| `/dashboard` | Projects, API keys, embeds, downloads, billing, usage |
| `/embed/[token]` | Embeddable widget (loaded in a customer's iframe) |
| `/obs/[token]` | Transparent stream overlay for OBS |
| `/api/v1/*` | Game-facing API (secret key auth) |
| `/api/v1/embed/*` | Embed-facing API (public token + origin allowlist) |

## The character

`lib/bard/build-bard.ts` is the single definition of what Punaab looks like.
It returns plain three.js, which is what lets the *same* function feed three
different consumers with no chance of them drifting apart:

- the homepage world (`components/world/`)
- the turntable preview (`components/downloads/BardPreview.tsx`)
- the `.glb` export (`lib/bard/export-glb.ts`)

He is authored at real-world scale — 1.80 m tall, 1 unit = 1 metre, +Y up — so
Godot, Unity and Unreal all import him at the correct size with no rescaling.

### Music

Authored tracks live in `public/music/` and are listed in `lib/music.ts` (download
page) and `lib/bard/songs.ts` (in-world playback). `lib/bard/performance.ts`
plays those `.mp3` files through Web Audio — there is no synthesized lute
fallback. Only register a song if the file is in the music folder.

### The world

`lib/world/terrain.ts` holds one height function that the terrain mesh, every
tree and grass tuft, the bard's footing, and the camera's collision all sample.
Textures are generated into canvases at runtime (`lib/world/textures.ts`), so
the hero scene ships zero image assets. Quality scales by device via
`lib/world/quality.ts`; append `?quality=high` to force a tier when testing.

## Embeds and streaming (Creator plan and above)

Three surfaces, all driven by an **embed token** — which, unlike an API key, is
public by design and therefore defended by an origin allowlist and its own
daily credit cap rather than by secrecy. See `lib/embed/tokens.ts`.

- **Website** — one script tag (`public/embed.js`) mounts an iframe widget
- **OBS** — `/obs/[token]` renders on a transparent background, no chroma key
- **Twitch / Kick** — anonymous read-only chat bridges (`lib/embed/`), so the
  streamer never has to grant an OAuth scope

## Scripts

| Command | Does |
|---------|------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run pack:godot` | Zip the Godot addon into `public/downloads/` |
| `npm run setup:stripe` | Create Stripe products/prices |
| `npm run apply:migration` | Push a SQL migration to Supabase |
