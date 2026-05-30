-- DevMind Supabase Schema
-- Run this in the Supabase SQL Editor to set up the required tables.

-- Stores each recommendation session
create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  raw_prompt text not null,
  intent_json jsonb,
  result_json jsonb
);

-- Stores developer style profile (one row per user/device)
create table if not exists style_profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  device_id text unique not null,
  profile_json jsonb
);

-- Index for faster lookups
create index if not exists idx_recommendations_created_at
  on recommendations (created_at desc);

create index if not exists idx_style_profiles_device_id
  on style_profiles (device_id);
