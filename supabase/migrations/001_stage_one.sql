-- PixelGrew Stage One schema
-- Apply via Supabase SQL editor or CLI

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  display_name text not null,
  avatar_url text,
  locale text not null default 'en' check (locale in ('en', 'es', 'zh', 'ja')),
  bio text,
  solana_wallet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists professions (
  id text primary key,
  name text not null,
  blurb text not null
);

create table if not exists player_professions (
  profile_id uuid not null references profiles(id) on delete cascade,
  profession_id text not null references professions(id) on delete cascade,
  reputation integer not null default 0,
  primary key (profile_id, profession_id)
);

create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  body text,
  author_id uuid references profiles(id) on delete set null,
  status text not null default 'personal'
    check (status in ('personal', 'community', 'realm_canon', 'universal_canon', 'historical_record')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists item_definitions (
  definition_id text primary key,
  name text not null,
  description text,
  creator_id uuid references profiles(id) on delete set null,
  rarity text not null default 'common',
  tags text[] not null default '{}',
  assets jsonb not null default '{}'::jsonb,
  recipe jsonb,
  canon_level text not null default 'community'
    check (canon_level in ('personal', 'community', 'realm', 'universal')),
  created_at timestamptz not null default now()
);

create table if not exists item_instances (
  id uuid primary key default gen_random_uuid(),
  definition_id text not null references item_definitions(definition_id),
  owner_id uuid references profiles(id) on delete set null,
  origin_realm text,
  provenance jsonb not null default '[]'::jsonb,
  custom_name text,
  condition text not null default 'good',
  authenticity_status text not null default 'unverified',
  created_at timestamptz not null default now()
);

create table if not exists balances (
  profile_id uuid not null references profiles(id) on delete cascade,
  currency_code text not null default 'ember',
  amount numeric(20, 4) not null default 0 check (amount >= 0),
  primary key (profile_id, currency_code)
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  currency_code text not null default 'ember',
  delta numeric(20, 4) not null,
  reason text not null,
  idempotency_key text not null unique,
  meta jsonb not null default '{}'::jsonb,
  chain_anchor_tx text,
  created_at timestamptz not null default now()
);

create table if not exists realms (
  id text primary key,
  name text not null,
  summary text,
  status text not null default 'planned',
  integration_level integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists chronicles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  occurred_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create table if not exists factions (
  id text primary key,
  name text not null,
  summary text
);

create table if not exists faction_memberships (
  faction_id text not null references factions(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member',
  primary key (faction_id, profile_id)
);

-- Seed professions
insert into professions (id, name, blurb) values
  ('chronicler', 'Chronicler', 'Writes books and records events.'),
  ('relic_hunter', 'Relic Hunter', 'Discovers items in connected games.'),
  ('smith', 'Smith', 'Creates item designs and recipes.'),
  ('merchant', 'Merchant', 'Operates stores and trade routes.'),
  ('archivist', 'Archivist', 'Reviews and categorizes lore.'),
  ('diplomat', 'Diplomat', 'Represents factions and realms.'),
  ('developer', 'Developer', 'Creates a game connected to the universe.'),
  ('warden', 'Warden', 'Moderates content and investigates cheating.')
on conflict (id) do nothing;

insert into realms (id, name, summary, status, integration_level) values
  ('pixelgrew_web', 'PixelGrew Web Hub', 'The living website world.', 'live', 1),
  ('starbase_kolob', 'Starbase Kolob', 'Stage Two candidate realm.', 'planned', 0)
on conflict (id) do nothing;

insert into factions (id, name, summary) values
  ('faction_archivists', 'Order of Archivists', 'Keepers of canon review.'),
  ('faction_ember_smiths', 'Ember Smith Consortium', 'Forge designers and smiths.')
on conflict (id) do nothing;

insert into item_definitions (definition_id, name, description, rarity, tags, canon_level) values
  ('relic_sunstone_001', 'Sunstone of the First Archive', 'A relic that glows when true history is spoken nearby.', 'legendary', array['relic','light','archive'], 'universal'),
  ('tool_quill_001', 'Chronicler''s Quill', 'Writes cleanly even in the dark between worlds.', 'uncommon', array['tool','writing'], 'community'),
  ('mat_ember_iron_001', 'Ember Iron Ingot', 'Forge stock warmed by residual chronicle fire.', 'common', array['material','forge'], 'community')
on conflict (definition_id) do nothing;

insert into chronicles (title, summary, occurred_at) values
  ('The Hub Gates Open', 'Travelers arrive at PixelGrew. The Archive lights its shelves.', '2026-07-27T00:00:00Z');

alter table profiles enable row level security;
alter table books enable row level security;
alter table item_definitions enable row level security;
alter table item_instances enable row level security;
alter table balances enable row level security;
alter table ledger_entries enable row level security;
alter table realms enable row level security;
alter table chronicles enable row level security;
alter table factions enable row level security;

-- Public read policies for canon content (anon key)
drop policy if exists "public read books community+" on books;
create policy "public read books community+" on books
  for select using (status in ('community', 'realm_canon', 'universal_canon', 'historical_record'));

drop policy if exists "public read item definitions" on item_definitions;
create policy "public read item definitions" on item_definitions
  for select using (true);

drop policy if exists "public read realms" on realms;
create policy "public read realms" on realms
  for select using (true);

drop policy if exists "public read chronicles" on chronicles;
create policy "public read chronicles" on chronicles
  for select using (true);

drop policy if exists "public read factions" on factions;
create policy "public read factions" on factions
  for select using (true);
