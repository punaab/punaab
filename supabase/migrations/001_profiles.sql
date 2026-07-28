-- Punaab community schema — profiles (Clerk travelers)

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe if an older empty `profiles` table already exists without these cols.
alter table profiles
  add column if not exists referral_code text;

alter table profiles
  add column if not exists referred_by uuid references profiles(id) on delete set null;

create unique index if not exists profiles_referral_code_uidx
  on profiles (referral_code)
  where referral_code is not null;

create index if not exists profiles_referred_by_idx
  on profiles (referred_by)
  where referred_by is not null;
