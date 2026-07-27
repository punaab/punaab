# PixelGrew Website

Shared-universe hub for [PixelGrew](https://pixelgrew.com) / punaab.com.

Stage One: place-like World Hub (Archive, Bazaar, Forge, Council, Hall of Realms, Chronicle, Guild District), Clerk accounts, Supabase schema, server-authoritative API stubs.

## Stack

- Next.js (App Router) + TypeScript
- Clerk auth
- Supabase Postgres + Storage
- Vercel deploy

## Setup

1. Clone this repo (`https://github.com/punaab/pixelgrew-website-main.git`).
2. `npm install`
3. Copy `.env.example` → `.env.local` and fill Clerk + Supabase keys (or inject via Vercel).
4. Apply `supabase/migrations/001_stage_one.sql` in the Supabase SQL editor.
5. `npm run dev`

## Vercel

1. Import `punaab/pixelgrew-website-main`.
2. Connect Clerk + Supabase integrations / env vars.
3. Deploy. Point punaab.com to the project.

## Routes

| Path | Purpose |
|------|---------|
| `/` | Arrival gate |
| `/world` | Hub map of locations |
| `/archive` `/bazaar` `/forge` `/council` `/realms` `/chronicle` `/guilds` | Locations |
| `/play` | Auth-gated play chamber |
| `/profile` | Identity + language + profession settings |
| `/api/v1/*` | Stage One read/write stubs |

## Notes

- Language settings live in **Profile**, not the header.
- Economy writes are server-only (`ledger_entries`, craft).
- Solana wallet field exists on `profiles` for later anchoring; not required for MVP.
- Legacy static portfolio is preserved under `_legacy/`.
