-- Lore edits: accepted entries can hold a proposed revision for admin review.
-- Pending / denied rows still update in place on author edit.

alter table community_lore
  add column if not exists pending_revision jsonb;

create index if not exists community_lore_pending_revision_idx
  on community_lore ((pending_revision is not null))
  where pending_revision is not null;
