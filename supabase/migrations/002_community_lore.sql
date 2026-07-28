-- World hall: community lore, votes, comments, graph links, moderation, art.

create table if not exists community_lore (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  category text not null default 'history'
    check (category in (
      'characters',
      'art',
      'quests',
      'dialogue',
      'places',
      'items',
      'rumors',
      'history'
    )),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 12 and 8000),
  summary text not null default '',
  slug text,
  location_key text,
  tags text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb,
  is_hub boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'denied')),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id) on delete set null,
  review_note text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists community_lore_slug_uidx
  on community_lore (slug);

create index if not exists community_lore_created_idx
  on community_lore (created_at desc);

create index if not exists community_lore_category_idx
  on community_lore (category, created_at desc);

create index if not exists community_lore_status_category_idx
  on community_lore (status, category, created_at desc);

create index if not exists community_lore_status_created_idx
  on community_lore (status, created_at desc);

create table if not exists community_lore_votes (
  lore_id uuid not null references community_lore(id) on delete cascade,
  voter_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lore_id, voter_id)
);

create index if not exists community_lore_votes_lore_idx
  on community_lore_votes (lore_id);

create table if not exists community_lore_comments (
  id uuid primary key default gen_random_uuid(),
  lore_id uuid not null references community_lore(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists community_lore_comments_lore_idx
  on community_lore_comments (lore_id, created_at);

create table if not exists community_lore_links (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references community_lore(id) on delete cascade,
  to_id uuid not null references community_lore(id) on delete cascade,
  kind text not null default 'related'
    check (kind in (
      'related',
      'involves',
      'found_in',
      'given_by',
      'leads_to',
      'mentions',
      'about'
    )),
  note text,
  created_at timestamptz not null default now(),
  constraint community_lore_links_no_self check (from_id <> to_id),
  unique (from_id, to_id, kind)
);

create index if not exists community_lore_links_from_idx
  on community_lore_links (from_id);

create index if not exists community_lore_links_to_idx
  on community_lore_links (to_id);

-- System author + hub node for the lore graph
insert into profiles (clerk_user_id, display_name)
values ('system:punaab-hub', 'Punaab')
on conflict (clerk_user_id) do nothing;

insert into community_lore (
  author_id,
  category,
  title,
  body,
  summary,
  slug,
  tags,
  meta,
  is_hub,
  status
)
select
  p.id,
  'characters',
  'Punaab the Traveling Bard',
  'The wandering bard at the centre of the valley''s tales. He walks the roads with a lute, a pack, and stories gathered from every hamlet that will still open a door.',
  'Smart traveling bard — hub of the community lore graph.',
  'punaab',
  array['hub', 'bard']::text[],
  '{"role":"hub"}'::jsonb,
  true,
  'accepted'
from profiles p
where p.clerk_user_id = 'system:punaab-hub'
  and not exists (
    select 1 from community_lore where slug = 'punaab' or is_hub = true
  );
