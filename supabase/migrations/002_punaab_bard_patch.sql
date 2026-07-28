-- Patch existing PixelGrew-era schema for Punaab Bard MVP

alter table profiles
  add column if not exists plan_code text not null default 'free';

alter table profiles
  drop constraint if exists profiles_plan_code_check;

alter table profiles
  add constraint profiles_plan_code_check
  check (plan_code in ('free', 'creator', 'studio', 'enterprise'));

alter table profiles
  add column if not exists stripe_customer_id text;

alter table profiles
  add column if not exists coin_balance numeric(20, 4) not null default 0;

-- Old api_keys were profile-scoped; Bard keys are project-scoped.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'api_keys' and column_name = 'profile_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'api_keys' and column_name = 'project_id'
  ) then
    alter table api_keys rename to legacy_api_keys;
  end if;
end $$;

create extension if not exists "pgcrypto";

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  mode text not null default 'cloud'
    check (mode in ('cloud', 'hybrid', 'local')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null default 'Default',
  key_prefix text not null,
  key_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  plan_code text not null,
  stripe_subscription_id text unique,
  status text not null default 'inactive',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_balances (
  profile_id uuid primary key references profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  delta integer not null,
  reason text not null,
  idempotency_key text not null unique,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  kind text not null,
  units numeric(20, 4) not null default 1,
  cost_credits integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists appearances (
  id text primary key,
  name text not null,
  blurb text,
  preview_url text,
  tags text[] not null default '{}'
);

create table if not exists character_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  appearance_id text references appearances(id) on delete set null,
  display_name text not null default 'Punaab',
  brain jsonb not null default '{"personality":"traveling bard","style":"warm, witty, helpful"}'::jsonb,
  loadout jsonb not null default '{}'::jsonb,
  voice text default 'warm_bard',
  playlist_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists lore_docs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text,
  price numeric(20, 4) not null default 0,
  category text default 'general',
  icon_url text,
  created_at timestamptz not null default now()
);

create table if not exists quests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  mode text not null default 'playlist'
    check (mode in ('playlist', 'radio', 'shuffle', 'loop')),
  created_at timestamptz not null default now()
);

create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references playlists(id) on delete cascade,
  title text not null,
  url text,
  sort_order integer not null default 0
);

alter table character_configs
  drop constraint if exists character_configs_playlist_id_fkey;
alter table character_configs
  add constraint character_configs_playlist_id_fkey
  foreign key (playlist_id) references playlists(id) on delete set null;

create table if not exists behaviors (
  id text primary key,
  label text not null,
  description text
);

create table if not exists plugin_releases (
  id uuid primary key default gen_random_uuid(),
  engine text not null default 'godot',
  version text not null,
  zip_path text not null,
  changelog text,
  min_api text not null default 'v1',
  created_at timestamptz not null default now(),
  unique (engine, version)
);

create table if not exists downloads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  release_id uuid references plugin_releases(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  meta jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

insert into appearances (id, name, blurb, tags) values
  ('classic', 'Classic Bard', 'The traveling storyteller.', array['default']),
  ('wizard', 'Wizard', 'Arcane robes and a knowing smile.', array['fantasy']),
  ('cyberpunk', 'Cyberpunk', 'Neon strings and chrome lute.', array['scifi']),
  ('pixel', 'Pixel', '16-bit charm for retro worlds.', array['pixel']),
  ('pirate', 'Pirate', 'Sea shanties and stolen maps.', array['adventure']),
  ('christmas', 'Christmas', 'Seasonal cheer and jingle lore.', array['seasonal']),
  ('halloween', 'Halloween', 'Spooky tales by lantern light.', array['seasonal'])
on conflict (id) do nothing;

insert into behaviors (id, label, description) values
  ('idle', 'Idle', 'Default resting presence'),
  ('talk', 'Talk', 'Speaking to the player'),
  ('walk', 'Walk', 'Moving through the world'),
  ('follow', 'Follow', 'Follow the player'),
  ('sing', 'Sing', 'Sing a verse'),
  ('play_music', 'Play Music', 'Perform with instrument'),
  ('open_shop', 'Open Shop', 'Open merchant UI'),
  ('tell_story', 'Tell Story', 'Share lore'),
  ('start_quest', 'Start Quest', 'Offer a quest'),
  ('trade', 'Trade', 'Complete a trade'),
  ('wave', 'Wave', 'Friendly wave'),
  ('sit', 'Sit', 'Sit down'),
  ('sleep', 'Sleep', 'Rest'),
  ('dance', 'Dance', 'Celebrate')
on conflict (id) do nothing;

insert into plugin_releases (engine, version, zip_path, changelog, min_api)
values (
  'godot',
  '0.1.0',
  '/downloads/punaab-godot-0.1.0.zip',
  'Initial Godot 4 addon: dialogue, merchant, music stubs, behavior bus.',
  'v1'
)
on conflict (engine, version) do nothing;

create index if not exists projects_owner_idx on projects(owner_id);
create index if not exists api_keys_project_idx on api_keys(project_id);
create index if not exists credit_ledger_profile_idx on credit_ledger(profile_id);
create index if not exists usage_events_project_idx on usage_events(project_id);

-- Refresh PostgREST schema cache if available
notify pgrst, 'reload schema';
