-- Embeds, stream overlays, and live chat bridges.
--
-- Embed tokens are deliberately NOT api_keys. An api_key is a bearer secret
-- that must only ever live on a server; an embed token is published in the
-- HTML of someone's website and is visible to anyone who views source. They
-- therefore need completely different defences: an origin allowlist, their own
-- rate limit, and no ability to read or mutate anything except "talk to this
-- one character".

create extension if not exists "pgcrypto";

create table if not exists embed_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null default 'Website',
  -- Public identifier. Safe to paste into a page.
  token text not null unique,
  -- Where this token is allowed to be used from. Empty array = deny all,
  -- which is the correct default for a credential that lives in public HTML.
  allowed_origins text[] not null default '{}',
  -- 'web'    — embedded widget on a site, with a chat box
  -- 'obs'    — transparent stream overlay, no chat box of its own
  surface text not null default 'web' check (surface in ('web', 'obs')),
  -- Per-token spend ceiling so one embedded page cannot drain an account.
  daily_credit_cap integer not null default 2000,
  enabled boolean not null default true,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists embed_tokens_project_idx on embed_tokens(project_id);
create index if not exists embed_tokens_token_idx on embed_tokens(token);

-- Rolling per-token, per-day spend. Keyed on (token, day) so the daily cap is
-- a single upsert rather than an aggregate over the whole ledger.
create table if not exists embed_usage_daily (
  token_id uuid not null references embed_tokens(id) on delete cascade,
  day date not null default current_date,
  credits_spent integer not null default 0,
  messages integer not null default 0,
  primary key (token_id, day)
);

-- Live chat bridges: Twitch and Kick channels a project's bard listens to.
create table if not exists chat_bridges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  platform text not null check (platform in ('twitch', 'kick')),
  channel text not null,
  enabled boolean not null default true,
  -- How the bard picks which messages to answer.
  -- 'mentions'  — only messages that name him
  -- 'commands'  — only messages starting with the trigger prefix
  -- 'all'       — every message (expensive; capped by the token's daily cap)
  respond_mode text not null default 'mentions'
    check (respond_mode in ('mentions', 'commands', 'all')),
  trigger_prefix text not null default '!punaab',
  -- Seconds between replies, so he cannot be spammed into a credit hole.
  cooldown_seconds integer not null default 12,
  created_at timestamptz not null default now(),
  unique (project_id, platform, channel)
);

create index if not exists chat_bridges_project_idx on chat_bridges(project_id);

-- Transcript of what the bard said on stream, for moderation and replay.
create table if not exists chat_events (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid references chat_bridges(id) on delete cascade,
  token_id uuid references embed_tokens(id) on delete set null,
  platform text,
  author text,
  message text,
  reply text,
  created_at timestamptz not null default now()
);

create index if not exists chat_events_bridge_idx
  on chat_events(bridge_id, created_at desc);

notify pgrst, 'reload schema';
