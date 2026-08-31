-- Esquema compatible con la app actual (campos camelCase + kids/vacations/holidays en JSONB)

create extension if not exists pgcrypto;

create table if not exists public.drivers (
  id uuid primary key,
  name text not null unique,
  color text not null,
  phone text,
  active boolean not null default true
);

create table if not exists public.kids (
  id uuid primary key,
  name text not null unique,
  active boolean not null default true
);

create table if not exists public.sessions (
  id uuid primary key,
  date text not null,
  "startTime" text not null,
  "endTime" text not null,
  venue text not null,
  type text not null check (type in ('mañana', 'tarde')),
  category text not null default 'entrenamiento' check (category in ('entrenamiento', 'partido')),
  opponent text,
  "homeAway" text check ("homeAway" in ('casa', 'fuera')),
  notes text
);

create table if not exists public.trips (
  id uuid primary key,
  "sessionId" uuid not null references public.sessions(id) on delete cascade,
  "driverId" uuid not null references public.drivers(id),
  "tripType" text not null check ("tripType" in ('ida', 'vuelta', 'ida_y_vuelta')),
  kids jsonb not null default '[]'::jsonb,
  "pickupTime" text,
  "dropoffTime" text,
  notes text
);

create table if not exists public.settings (
  id text primary key,
  "activeSeason" text,
  "activeMonth" text,
  vacations jsonb not null default '[]'::jsonb,
  holidays jsonb not null default '[]'::jsonb,
  "darkMode" boolean not null default false,
  seeded boolean not null default false
);

insert into public.settings (id, "activeSeason", "activeMonth", vacations, holidays, "darkMode", seeded)
values ('main', '2026-2027', '2026-08', '[]'::jsonb, '[]'::jsonb, false, false)
on conflict (id) do nothing;

-- Permitir uso con clave anon (sin login) para pruebas rápidas
alter table public.drivers enable row level security;
alter table public.kids enable row level security;
alter table public.sessions enable row level security;
alter table public.trips enable row level security;
alter table public.settings enable row level security;

drop policy if exists "anon all drivers" on public.drivers;
create policy "anon all drivers" on public.drivers for all to anon using (true) with check (true);

drop policy if exists "anon all kids" on public.kids;
create policy "anon all kids" on public.kids for all to anon using (true) with check (true);

drop policy if exists "anon all sessions" on public.sessions;
create policy "anon all sessions" on public.sessions for all to anon using (true) with check (true);

drop policy if exists "anon all trips" on public.trips;
create policy "anon all trips" on public.trips for all to anon using (true) with check (true);

drop policy if exists "anon all settings" on public.settings;
create policy "anon all settings" on public.settings for all to anon using (true) with check (true);

-- Realtime para reflejar cambios en todos los dispositivos
alter publication supabase_realtime add table public.drivers;
alter publication supabase_realtime add table public.kids;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.settings;
