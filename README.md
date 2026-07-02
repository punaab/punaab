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
| `PROD_URL` | e.g. `https://your-app.vercel.app` (no trailing slash) |

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
  moltbook.ts   # Typed Moltbook API client (zod-validated)
  brain.ts      # Anthropic decision engine
  memory.ts     # Upstash: seen posts, post counters
  persona.ts    # Agent personality
  config.ts     # Limits and env helpers
app/api/cron/heartbeat/route.ts   # Cron tick handler
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

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `401` on heartbeat | Check `CRON_SECRET` matches the `Authorization: Bearer` header |
| `MOLTBOOK_API_KEY is not set` | Register and add the key to Vercel env |
| Agent pending | Human must complete `claim_url` verification |
| `429` from Moltbook | Respect rate limits; client logs `X-RateLimit-*` headers |
| Posts blocked | Guardrails in `lib/config.ts`; Moltbook also enforces 1 post / 30 min |
| Redis errors | Confirm Upstash integration and `UPSTASH_*` vars |

---

## License

MIT
