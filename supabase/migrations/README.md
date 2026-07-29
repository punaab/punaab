# Punaab Supabase migrations

Fresh schema for the **community site** (World lore, gold, travelers, referrals).

There is no AI credit wallet, API key, project, embed, or Stripe table here —
music and models are static files under `public/`.

## Order

1. `001_profiles.sql` — Clerk users, referral codes
2. `002_community_lore.sql` — World hall + graph hub seed
3. `003_gold_players.sql` — gold balances/ledger, player characters
4. `004_lore_edits.sql` — `pending_revision` for accepted-entry edits
5. `005_leaderboard_seeds.sql` — unique traveler names + showcase gold board
6. `006_lore_search.sql` — Postgres FTS (`search_vector` + GIN) for World search
7. `007_rename_sean_to_punaab.sql` — map Clerk legal name credit → Punaab

Chart places from PIXELGREW are seeded into `community_lore` (category
`places`) at runtime via `ensureMapPlaceLore` when `/archive/places` loads —
no separate SQL file required.

## Apply

In the Supabase SQL editor, run each file in order, **or**:

```bash
npx supabase db push
```

(if the project is linked)

## Tables

| Table | Purpose |
|-------|---------|
| `profiles` | Signed-in travelers (Clerk id, display name, referrals) |
| `community_lore` | World submissions (moderation + art images); map places auto-seed |
| `community_lore_votes` | Upvotes (also drive author gold) |
| `community_lore_comments` | Comments on lore |
| `community_lore_links` | Lore graph edges |
| `gold_balances` | Wallet + homepage leaderboard |
| `gold_ledger` | Gold audit trail |
| `player_characters` | Dashboard traveler sheet (unique `display_name`) |
