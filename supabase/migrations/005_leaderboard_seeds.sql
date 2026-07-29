-- Unique traveler names + seeded leaderboard camp (incl. PUNAAB at 1000 gold).
-- Safe to re-run: skips name collisions and tops up existing PUNAAB holders.
-- Placeholder travelers use one-word Pixelgrew / fantasy road names.

create unique index if not exists player_characters_display_name_unique
  on player_characters (lower(trim(display_name)));

insert into profiles (clerk_user_id, display_name)
values
  ('seed:punaab', 'PUNAAB'),
  ('seed:meadow-ash', 'Grove'),
  ('seed:briar-quill', 'Briar'),
  ('seed:cobalt-wren', 'Wren'),
  ('seed:lantern-moth', 'Ember'),
  ('seed:dusty-reed', 'Moss'),
  ('seed:harper-vale', 'Fern'),
  ('seed:thistle-brook', 'Thistle')
on conflict (clerk_user_id) do update
  set display_name = excluded.display_name,
      updated_at = now();

insert into player_characters (profile_id, display_name, title, motto, instrument)
select p.id, v.display_name, v.title, v.motto, v.instrument
from profiles p
join (
  values
    ('seed:punaab', 'PUNAAB', 'The Traveling Bard', 'Songs for the open road.', 'lute'),
    ('seed:meadow-ash', 'Grove', 'Road Chronicler', 'Ink dries slower than dust.', 'quill'),
    ('seed:briar-quill', 'Briar', 'Hedge Poet', 'Thorns write the best lines.', 'lute'),
    ('seed:cobalt-wren', 'Wren', 'Market Singer', 'A tune buys supper twice.', 'flute'),
    ('seed:lantern-moth', 'Ember', 'Night Courier', 'Follow the warm glass.', 'bell'),
    ('seed:dusty-reed', 'Moss', 'Wayfarer', 'Boots first, stories second.', 'staff'),
    ('seed:harper-vale', 'Fern', 'Glen Harper', 'Every valley has a chord.', 'harp'),
    ('seed:thistle-brook', 'Thistle', 'Ford Keeper', 'Cross when the water allows.', 'lute')
) as v(clerk_user_id, display_name, title, motto, instrument)
  on p.clerk_user_id = v.clerk_user_id
where not exists (
  select 1
  from player_characters other
  where lower(trim(other.display_name)) = lower(trim(v.display_name))
    and other.profile_id <> p.id
)
on conflict (profile_id) do update
  set display_name = excluded.display_name,
      title = excluded.title,
      motto = excluded.motto,
      instrument = excluded.instrument,
      updated_at = now()
  where not exists (
    select 1
    from player_characters other
    where lower(trim(other.display_name)) = lower(trim(excluded.display_name))
      and other.profile_id <> player_characters.profile_id
  );

insert into gold_balances (profile_id, balance, updated_at)
select p.id, v.balance, now()
from profiles p
join (
  values
    ('seed:punaab', 1000),
    ('seed:meadow-ash', 640),
    ('seed:briar-quill', 485),
    ('seed:cobalt-wren', 310),
    ('seed:lantern-moth', 175),
    ('seed:dusty-reed', 90),
    ('seed:harper-vale', 55),
    ('seed:thistle-brook', 25)
) as v(clerk_user_id, balance)
  on p.clerk_user_id = v.clerk_user_id
on conflict (profile_id) do update
  set balance = greatest(gold_balances.balance, excluded.balance),
      updated_at = now();

insert into gold_balances (profile_id, balance, updated_at)
select pc.profile_id, 1000, now()
from player_characters pc
where lower(trim(pc.display_name)) = 'punaab'
on conflict (profile_id) do update
  set balance = greatest(gold_balances.balance, 1000),
      updated_at = now();

insert into gold_ledger (profile_id, delta, reason, idempotency_key, meta)
select p.id, v.balance, 'seed_showcase', 'seed_showcase:' || v.clerk_user_id,
  jsonb_build_object('source', '005_leaderboard_seeds')
from profiles p
join (
  values
    ('seed:punaab', 1000),
    ('seed:meadow-ash', 640),
    ('seed:briar-quill', 485),
    ('seed:cobalt-wren', 310),
    ('seed:lantern-moth', 175),
    ('seed:dusty-reed', 90),
    ('seed:harper-vale', 55),
    ('seed:thistle-brook', 25)
) as v(clerk_user_id, balance)
  on p.clerk_user_id = v.clerk_user_id
on conflict (idempotency_key) do nothing;

insert into gold_ledger (profile_id, delta, reason, idempotency_key, meta)
select pc.profile_id, 1000, 'seed_showcase', 'seed_showcase:name:punaab',
  jsonb_build_object('source', '005_leaderboard_seeds', 'via', 'existing_name')
from player_characters pc
where lower(trim(pc.display_name)) = 'punaab'
on conflict (idempotency_key) do nothing;
