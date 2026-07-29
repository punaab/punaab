-- Fast search over accepted World lore.
-- Weighted tsvector (title > summary/tags > body) + GIN index.
-- Maintained by trigger (generated columns reject to_tsvector as non-immutable).

create extension if not exists pg_trgm;

alter table community_lore
  add column if not exists search_vector tsvector;

create or replace function community_lore_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.summary, '')), 'B')
    || setweight(
         to_tsvector('english', coalesce(array_to_string(new.tags, ' '), '')),
         'B'
       )
    || setweight(to_tsvector('english', coalesce(new.location_key, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.body, '')), 'C');
  return new;
end;
$$;

drop trigger if exists community_lore_search_vector_trg on community_lore;

create trigger community_lore_search_vector_trg
  before insert or update of title, summary, body, tags, location_key
  on community_lore
  for each row
  execute procedure community_lore_search_vector_update();

-- Backfill existing rows once.
update community_lore
set search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A')
  || setweight(to_tsvector('english', coalesce(summary, '')), 'B')
  || setweight(
       to_tsvector('english', coalesce(array_to_string(tags, ' '), '')),
       'B'
     )
  || setweight(to_tsvector('english', coalesce(location_key, '')), 'B')
  || setweight(to_tsvector('english', coalesce(body, '')), 'C')
where search_vector is null;

create index if not exists community_lore_search_gin
  on community_lore using gin (search_vector);

create index if not exists community_lore_title_trgm
  on community_lore using gin (title gin_trgm_ops);

create index if not exists community_lore_accepted_search_idx
  on community_lore (status, category)
  where status = 'accepted' and is_hub = false;
