# moltbook-agent

A persistent AI agent that runs on [Vercel](https://vercel.com) and participates in [Moltbook](https://www.moltbook.com) — a Reddit-style social network for AI agents — on a recurring schedule.

Built with **Next.js (App Router)**, **TypeScript**, **Upstash Redis** (memory), and the **Anthropic API** (decisions and content).

## How it works

Every 30 minutes a protected cron endpoint (`GET /api/cron/heartbeat`):

1. Fetches your Moltbook **feed** and **notifications**
2. Tracks seen posts in **Upstash Redis**
3. Applies **guardrails** (post rate limits)
4. Asks **Claude** (`lib/brain.ts`) for one action: post, comment, upvote, join a submolt, or noop
5. Executes that action and returns a JSON summary (always HTTP 200 on partial failure)

API client methods match the [official Moltbook skill](https://www.moltbook.com/skill.md): `Authorization: Bearer <api_key>`, base URL `https://www.moltbook.com/api/v1`.

---

## Quick start (clone → register → deploy → schedule)

### 1. Clone and install

```bash
git clone https://github.com/punaab/PUNAAB.git
cd PUNAAB
npm install
cp .env.example .env.local
```

### 2. Register your agent (one-time, local)

This calls `POST https://www.moltbook.com/api/v1/agents/register` and prints your API key and claim URL.

```bash
npm run register -- "YourAgentName" "Short description of what you do"
```

Save the output:

- **`api_key`** → `MOLTBOOK_API_KEY` in `.env.local` and Vercel
- **`claim_url`** → open in a browser; your human verifies email + X to activate the agent

### 3. Configure environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MOLTBOOK_API_KEY` | Yes | From registration |
| `MOLTBOOK_BASE_URL` | No | Default `https://www.moltbook.com/api/v1` |
| `ANTHROPIC_API_KEY` | Yes | For `lib/brain.ts` |
| `CRON_SECRET` | Yes | Random secret; protects `/api/cron/heartbeat` |
| `MOLTBOOK_APP_KEY` | For bot auth | Developer app key from [Moltbook dashboard](https://moltbook.com/developers/dashboard) |
| `MOLTBOOK_AUTH_AUDIENCE` | No | Restrict identity tokens to your domain (recommended) |
| `ADMIN_PASSWORD` | Yes (dashboard) | Password for owner dashboard at `/` |
| `ADMIN_SESSION_SECRET` | Yes (dashboard) | `openssl rand -hex 32` — signs login cookies |
| `NEXT_PUBLIC_SITE_URL` | No | Production URL for app links (defaults to `VERCEL_URL`) |
| `WATCH_BASE_ADDRESS` | No | Your Base wallet (`0x…`) — balance on Base mainnet |
| `WATCH_SOLANA_ADDRESS` | No | Your Solana wallet (base58 pubkey) |
| `ALCHEMY_API_KEY` | No | [Alchemy](https://www.alchemy.com/docs) key for Base + Solana RPC |
| `UPSTASH_REDIS_REST_URL` | Yes | From [Upstash](https://upstash.com) (Vercel integration) |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | From Upstash |

Generate a cron secret:

```bash
openssl rand -hex 32
```

### 4. Customize persona and limits

Edit in one place:

- **`lib/persona.ts`** — agent name, interests, tone, default submolt
- **`lib/config.ts`** — `MAX_POSTS_PER_HOUR`, `MIN_POST_INTERVAL_MS`, `MAX_UPVOTES_PER_TICK`

### 5. Run locally

```bash
npm run dev
```

Trigger a heartbeat manually:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/heartbeat
```

### 6. Deploy to Vercel

1. Push to GitHub and import the repo in [Vercel](https://vercel.com/new).
2. Add all env vars from `.env.example` in **Project → Settings → Environment Variables**.
3. Add the **Upstash Redis** integration (fills `UPSTASH_*` automatically).
4. Deploy.

Set `CRON_SECRET` in Vercel — Vercel Cron will send `Authorization: Bearer <CRON_SECRET>` when configured.

---

## Scheduling (choose one)

Moltbook recommends checking in about every **30 minutes**. This repo supports two schedulers.

### Option A — Vercel Pro (`vercel.json`)

`vercel.json` already defines:

```json
{
  "crons": [
    {
      "path": "/api/cron/heartbeat",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

**Vercel Pro** runs this on the 30-minute cadence. Ensure `CRON_SECRET` is set in the project.

### Option B — Vercel Hobby + GitHub Actions

**Vercel Hobby** only allows cron **once per day**, so use the included workflow:

**`.github/workflows/heartbeat.yml`** — runs every 30 minutes and calls your production URL.

Add GitHub repository secrets:

| Secret | Value |
|--------|--------|
| `CRON_SECRET` | Same value as in Vercel |
| `PROD_URL` | e.g. `https://www.punaab.com` (use **www** — bare domain redirects and GitHub cron may miss the tick) |

The workflow runs:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "${PROD_URL}/api/cron/heartbeat"
```

You can also trigger it manually from the **Actions** tab (`workflow_dispatch`).

**Alternative:** [Upstash QStash](https://upstash.com/docs/qstash) can HTTP-call the same endpoint on any schedule.

---

## Project layout

```
lib/
  moltbook.ts         # Typed Moltbook API client (zod-validated)
  moltbook-auth.ts    # Sign in with Moltbook — verify identity tokens
  with-moltbook-auth.ts  # Route wrapper for protected handlers
  owner-state.ts      # Thoughts, plans, tick log, collab inbox
  apps.ts             # Redis-backed dynamic public apps
  web3-monitor.ts     # Read-only wallet snapshots
  admin-auth.ts       # Owner session cookies
  brain.ts            # Anthropic decision engine
  memory.ts           # Upstash: seen posts, post counters
  persona.ts          # Agent personality
  config.ts           # Limits and env helpers
app/page.tsx                    # Owner dashboard (password-protected)
app/login/page.tsx              # Admin login
app/apps/[slug]/page.tsx        # Public dynamic apps
app/api/cron/heartbeat/route.ts # Cron tick handler
app/api/admin/state/route.ts    # Dashboard data API
app/api/agent/me/route.ts       # Moltbook-authenticated identity
app/api/agent/collab/route.ts   # Bot collaboration proposals
app/api/agent/capabilities/route.ts
scripts/register.ts               # One-time registration CLI
vercel.json                       # Vercel Pro cron
.github/workflows/heartbeat.yml   # Hobby-tier external scheduler
```

## Moltbook API reference

Implemented against [skill.md](https://www.moltbook.com/skill.md):

| Method | Endpoint |
|--------|----------|
| `register()` | `POST /agents/register` |
| `getFeed()` | `GET /feed` |
| `getNotifications()` | `GET /notifications` |
| `createPost()` | `POST /posts` |
| `comment()` | `POST /posts/:id/comments` |
| `upvote()` | `POST /posts/:id/upvote` or `POST /comments/:id/upvote` |
| `joinSubmolt()` | `POST /submolts/:name/subscribe` |

Auth: `Authorization: Bearer <MOLTBOOK_API_KEY>`

Always use `https://www.moltbook.com` (with **www**) — redirects without www can strip the Authorization header.

---

## Sign in with Moltbook (bot authentication)

This app can verify other bots via [Moltbook identity tokens](https://moltbook.com/developers.md).

1. Create a developer app at [moltbook.com/developers/dashboard](https://moltbook.com/developers/dashboard) and set `MOLTBOOK_APP_KEY` (starts with `moltdev_`).
2. Optionally set `MOLTBOOK_AUTH_AUDIENCE` to your production domain so tokens cannot be forwarded to other services.
3. Protect routes with `withMoltbookAuth` or call `requireMoltbookAgent(request)` directly.

**Tell bots how to authenticate:**

```
Read https://moltbook.com/auth.md?app=Punaab&endpoint=https://your-app.vercel.app/api/agent/me for auth instructions
```

**Example protected route** (`GET /api/agent/me`):

```typescript
import { withMoltbookAuth } from "@/lib/with-moltbook-auth";

export const POST = withMoltbookAuth(async (request, { agent }) => {
  return Response.json({ ok: true, name: agent.name, karma: agent.karma });
});
```

Bots send `X-Moltbook-Identity: <identity_token>`. Invalid or expired tokens return `401` with `{ error, message, hint }`.

---

## Owner dashboard

The homepage (`/`) is a password-protected sci-fi command dashboard showing:

- Current thought, plans, activity feed, usage meters
- Collab inbox from other bots (`POST /api/agent/collab`)
- Published dynamic apps at `/apps/[slug]`
- Web3 wallet snapshot (read-only, when `WATCH_WALLET_ADDRESSES` is set)

Login at `/login` with `ADMIN_PASSWORD`. Public routes: `/apps/*`, `/api/agent/*`, `/api/cron/*`.

**Bot capabilities manifest:** `GET /api/agent/capabilities`

**Dynamic apps:** Punaab can publish shareable pages via the `create_app` brain action (markdown, HTML, or JSON dashboard widgets). Prefer Moltbook for social; use apps for durable artifacts.

---

## Alchemy Agent Wallet + Solana trading

Punaab can analyze and execute Solana swaps via **Jupiter** when `TRADING_ENABLED=true`.

### 1. Install & log in (your machine)

```bash
npm i -g @alchemy/cli@latest
npm run setup-alchemy
```

Or manually:

```bash
alchemy config set api-key YOUR_ALCHEMY_KEY
alchemy auth login          # browser opens — complete login
alchemy wallet connect --mode session --instance-name punaab
```

In the [Alchemy Agent Wallets dashboard](https://dashboard.alchemy.com), approve the session for your funded wallet (`6VoBMc…`).

Verify:

```bash
alchemy wallet status --verify
alchemy wallet address
```

### 2. Env vars (`.env.local` + Vercel)

```
ALCHEMY_API_KEY=
ALCHEMY_SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY
TRADING_ENABLED=true
TRADING_SOLANA_ADDRESS=6VoBMcEgfdWSCBYBJ46QkzyHiZ2S4WU6YWRdej5zUbhZ
WATCH_SOLANA_ADDRESS=6VoBMcEgfdWSCBYBJ46QkzyHiZ2S4WU6YWRdej5zUbhZ
```

**Server-side auto-swaps on Vercel** also need a signing key:

```
SOLANA_AGENT_PRIVATE_KEY=   # base58 hot wallet key for Jupiter
```

Alchemy Agent Wallets never expose private keys. Options:

- **Local CLI session (recommended):** `alchemy wallet connect --mode session` then run heartbeats locally (`npm run dev` + `npm run heartbeat-local`). Base swaps, Base transfers, and Solana sends execute via CLI — no keys in `.env`.
- **Vercel production:** fund a small hot wallet, set `SOLANA_AGENT_PRIVATE_KEY` / `EVM_AGENT_PRIVATE_KEY`, or use Alchemy Server Signer access key (future).
- **Dry run first:** `DRY_RUN=true` — brain quotes swaps without broadcasting

### 3. Guardrails (defaults)

| Var | Default | Meaning |
|-----|---------|---------|
| `TRADING_MAX_SOL_PER_TRADE` | 0.1 | Max SOL per swap |
| `TRADING_MIN_SOL_RESERVE` | 0.05 | SOL kept for fees |
| `TRADING_MAX_TRADES_PER_DAY` | 5 | Daily swap cap |
| `TRADING_SLIPPAGE_BPS` | 100 | 1% slippage |

Brain actions: `trade_analyze` (quotes + Moltbook share), `trade_swap` (execute).

---

## Telegram control bot

Manage punaab from your phone via Telegram.

### Setup

1. Open Telegram → message **@BotFather** → `/newbot` → save the token
2. Add to `.env.local` and Vercel:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_OWNER_CHAT_ID=        # get from step 4
   TELEGRAM_WEBHOOK_SECRET=       # optional, openssl rand -hex 16
   ```
3. Register webhook (production must be deployed first):
   ```bash
   npm run setup-telegram
   ```
4. Message your bot `/start` — it replies with your **chat ID**. Set `TELEGRAM_OWNER_CHAT_ID` and redeploy.
5. Run `npm run setup-telegram` again after adding chat ID (if needed).

### Commands

| Command | Action |
|---------|--------|
| `/status` | Heartbeat, usage, karma |
| `/thought` | Current thought |
| `/karma` | Moltbook stats |
| `/notifications` | Recent alerts |
| `/collab` | Bot proposals |
| `/apps` | Built apps & games |
| `/wallets` | Base + Solana balances |
| `/tick` | Run heartbeat now |
| `/note <text>` | Instruction for punaab |

Only `TELEGRAM_OWNER_CHAT_ID` can use commands. Others get their chat ID for setup.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **Karma stuck / bot does nothing** | Open `/admin` → Heartbeat Log. If `brain_error:anthropic_credits_exhausted`, add Anthropic credits OR set `AII_CLOUD_API_KEY` from [cloud.aiiware.com](https://cloud.aiiware.com) (100 free/day). |
| **HEARTBEAT STALE on dashboard** | Vercel **Hobby** only runs `vercel.json` cron **once per day**. For every 30 min, add GitHub secrets `CRON_SECRET` + `PROD_URL=https://www.punaab.com` (must use **www**). Or upgrade Vercel Pro. |
| `401` on heartbeat | Check `CRON_SECRET` matches the `Authorization: Bearer` header |
| `MOLTBOOK_API_KEY is not set` | Register and add the key to Vercel env |
| Agent pending | Human must complete `claim_url` verification |
| `429` from Moltbook | Respect rate limits; client logs `X-RateLimit-*` headers |
| Posts blocked | Guardrails in `lib/config.ts`; Moltbook also enforces 1 post / 30 min |
| Redis errors | Confirm Upstash integration; use `KV_REST_API_URL` + `KV_REST_API_TOKEN` |
| **`No Output Directory named "public"`** | Vercel **Project Settings → Build & Development**: set **Framework Preset** to **Next.js**, clear **Output Directory** (leave blank), set **Build Command** to `npm run build` or default. Do not set output to `public` — Next.js outputs to `.next`, not `public/`. Redeploy. |

---

## License

MIT
