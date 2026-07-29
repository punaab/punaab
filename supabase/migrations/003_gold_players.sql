-- Gold wallet, leaderboard balances, player travelers, referral tracking.
-- profiles.referral_code / referred_by live in 001_profiles.sql.

create table if not exists gold_balances (
  profile_id uuid primary key references profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists gold_balances_balance_idx
  on gold_balances (balance desc);

create table if not exists gold_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  delta integer not null,
  reason text not null,
  idempotency_key text not null unique,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gold_ledger_profile_idx
  on gold_ledger (profile_id, created_at desc);

create table if not exists player_characters (
  profile_id uuid primary key references profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 48),
  title text not null default 'Traveler'
    check (char_length(title) between 2 and 48),
  motto text not null default ''
    check (char_length(motto) <= 160),
  instrument text not null default 'lute'
    check (char_length(instrument) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Useful ledger reason cheat-sheet (enforced only by app code):
--   signup_bonus      — first purse open
--   lore_upvote       — author paid when a post is upvoted
--   lore_upvote_revoke — clawback when an upvote is removed
--   referral_invite   — inviter paid when a friend signs up with ?ref= / code
--
-- gold_balances.lifetime_earned (008) tracks gross positive grants.
