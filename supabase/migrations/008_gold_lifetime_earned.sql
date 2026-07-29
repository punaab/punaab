-- Lifetime gold earned (gross positive grants) for the traveler's purse ledger.
-- Balance can drop on upvote clawbacks; lifetime_earned only moves up.

alter table gold_balances
  add column if not exists lifetime_earned integer not null default 0
    check (lifetime_earned >= 0);

-- Backfill from the audit trail so existing purses show history.
update gold_balances gb
set lifetime_earned = coalesce((
  select sum(gl.delta)::integer
  from gold_ledger gl
  where gl.profile_id = gb.profile_id
    and gl.delta > 0
), 0)
where gb.lifetime_earned = 0;

comment on column gold_balances.lifetime_earned is
  'Sum of positive gold_ledger deltas — Archive upvotes, invites, signup bonus.';
