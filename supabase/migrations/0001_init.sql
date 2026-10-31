-- =====================================================================
-- Nonton Bareng — skema awal (PRD v1.1, bagian 9)
-- Jalankan di Supabase SQL Editor atau via `supabase db push`.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  updated_at timestamptz not null default now()
);

do $$ begin
  create type public.room_type as enum ('permanent', 'temporary');
exception when duplicate_object then null; end $$;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  room_code text not null unique,
  is_locked boolean not null default false,
  type public.room_type not null default 'permanent',
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'partner' check (role in ('host', 'partner')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members (user_id);

create table if not exists public.queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  source text not null check (source in ('youtube', 'youtube_playlist', 'url', 'vimeo', 'twitch', 'soundcloud')),
  source_id text not null check (char_length(source_id) between 1 and 2048),
  title text check (char_length(title) <= 300),
  thumbnail text check (char_length(thumbnail) <= 2048),
  position double precision not null,
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  played_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists queue_items_room_pos_idx on public.queue_items (room_id, position);

create table if not exists public.room_state (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  current_item_id uuid references public.queue_items (id) on delete set null,
  status text not null default 'paused' check (status in ('playing', 'paused')),
  position double precision not null default 0,
  rate real not null default 1,
  playlist_index integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_room_created_idx on public.messages (room_id, created_at desc);

-- Catatan percobaan gabung room, untuk rate limit tebak kode.
create table if not exists public.join_attempts (
  id bigint generated always as identity primary key,
  ip text,
  user_id uuid,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists join_attempts_created_idx on public.join_attempts (created_at);

-- ---------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------

create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room and user_id = auth.uid()
  );
$$;

create or replace function public.shares_room_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members a
    join public.room_members b on a.room_id = b.room_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- Kode acak 10 karakter tanpa huruf/angka yang mirip (0/O, 1/I/L).
create or replace function public.generate_room_code(p_len integer default 10)
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(p_len);
  result text := '';
begin
  for i in 0 .. p_len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.room_id_from_topic(p_topic text)
returns uuid
language plpgsql immutable
as $$
begin
  if p_topic like 'room:%' then
    return substr(p_topic, 6)::uuid;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC (hanya dipanggil dari server dengan service role)
-- ---------------------------------------------------------------------

create or replace function public.create_room(p_user uuid, p_name text, p_type public.room_type)
returns public.rooms
language plpgsql security definer set search_path = ''
as $$
declare
  r public.rooms;
  tries integer := 0;
  recent integer;
begin
  select count(*) into recent from public.rooms
  where owner_id = p_user and created_at > now() - interval '1 hour';
  if recent >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  loop
    begin
      insert into public.rooms (owner_id, name, room_code, type)
      values (p_user, p_name, public.generate_room_code(10), p_type)
      returning * into r;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;

  insert into public.room_members (room_id, user_id, role) values (r.id, p_user, 'host');
  insert into public.room_state (room_id) values (r.id);
  return r;
end;
$$;

create or replace function public.join_room(p_user uuid, p_code text, p_ip text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  r public.rooms;
  fails integer;
  member_count integer;
  max_members constant integer := 6;
begin
  select count(*) into fails from public.join_attempts
  where success = false
    and created_at > now() - interval '15 minutes'
    and (user_id = p_user or (p_ip is not null and ip = p_ip));
  if fails >= 10 then
    return json_build_object('status', 'rate_limited');
  end if;

  select * into r from public.rooms where room_code = upper(trim(p_code)) for update;
  if not found then
    insert into public.join_attempts (ip, user_id, success) values (p_ip, p_user, false);
    return json_build_object('status', 'not_found');
  end if;

  -- Anggota lama selalu boleh masuk lagi.
  if exists (select 1 from public.room_members where room_id = r.id and user_id = p_user) then
    update public.rooms set last_active_at = now() where id = r.id;
    return json_build_object('status', 'ok', 'room_code', r.room_code);
  end if;

  select count(*) into member_count from public.room_members where room_id = r.id;
  if r.is_locked then
    insert into public.join_attempts (ip, user_id, success) values (p_ip, p_user, true);
    return json_build_object('status', 'locked');
  end if;
  if member_count >= max_members then
    insert into public.join_attempts (ip, user_id, success) values (p_ip, p_user, true);
    return json_build_object('status', 'full');
  end if;

  insert into public.room_members (room_id, user_id, role) values (r.id, p_user, 'partner');
  -- Kunci otomatis setelah ada minimal 2 orang (bisa dibuka lagi di pengaturan room).
  update public.rooms
  set is_locked = (member_count + 1 >= 2), last_active_at = now()
  where id = r.id;
  insert into public.join_attempts (ip, user_id, success) values (p_ip, p_user, true);

  return json_build_object('status', 'ok', 'room_code', r.room_code);
end;
$$;

create or replace function public.delete_inactive_temporary_rooms(p_days integer default 7)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.rooms
  where type = 'temporary' and last_active_at < now() - make_interval(days => p_days);
  get diagnostics deleted = row_count;
  delete from public.join_attempts where created_at < now() - interval '1 day';
  return deleted;
end;
$$;

revoke all on function public.create_room(uuid, text, public.room_type) from public, anon, authenticated;
revoke all on function public.join_room(uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_inactive_temporary_rooms(integer) from public, anon, authenticated;
grant execute on function public.create_room(uuid, text, public.room_type) to service_role;
grant execute on function public.join_room(uuid, text, text) to service_role;
grant execute on function public.delete_inactive_temporary_rooms(integer) to service_role;

-- ---------------------------------------------------------------------
-- Trigger: updated_at dan last_active_at
-- ---------------------------------------------------------------------

create or replace function public.touch_room_state()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  update public.rooms set last_active_at = now() where id = new.room_id;
  return new;
end;
$$;

drop trigger if exists room_state_touch on public.room_state;
create trigger room_state_touch before update on public.room_state
for each row execute function public.touch_room_state();

create or replace function public.touch_room_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.rooms set last_active_at = now() where id = new.room_id;
  return new;
end;
$$;

drop trigger if exists messages_touch on public.messages;
create trigger messages_touch after insert on public.messages
for each row execute function public.touch_room_activity();

drop trigger if exists queue_items_touch on public.queue_items;
create trigger queue_items_touch after insert on public.queue_items
for each row execute function public.touch_room_activity();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.queue_items enable row level security;
alter table public.room_state enable row level security;
alter table public.messages enable row level security;
alter table public.join_attempts enable row level security; -- tanpa policy: hanya service role

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_room_with(id));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- rooms (insert hanya lewat RPC create_room)
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated
  using (public.is_room_member(id));
drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update to authenticated
  using (public.is_room_member(id)) with check (public.is_room_member(id));
drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete to authenticated
  using (owner_id = auth.uid());

-- Anggota hanya boleh mengubah nama dan status kunci room.
revoke insert, update on public.rooms from anon, authenticated;
grant update (name, is_locked) on public.rooms to authenticated;

-- room_members (insert hanya lewat RPC join_room/create_room)
drop policy if exists members_select on public.room_members;
create policy members_select on public.room_members for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists members_delete on public.room_members;
create policy members_delete on public.room_members for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid())
  );
revoke insert, update on public.room_members from anon, authenticated;

-- queue_items
drop policy if exists queue_select on public.queue_items;
create policy queue_select on public.queue_items for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists queue_insert on public.queue_items;
create policy queue_insert on public.queue_items for insert to authenticated
  with check (public.is_room_member(room_id) and added_by = auth.uid());
drop policy if exists queue_update on public.queue_items;
create policy queue_update on public.queue_items for update to authenticated
  using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
drop policy if exists queue_delete on public.queue_items;
create policy queue_delete on public.queue_items for delete to authenticated
  using (public.is_room_member(room_id));

-- room_state
drop policy if exists state_select on public.room_state;
create policy state_select on public.room_state for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists state_update on public.room_state;
create policy state_update on public.room_state for update to authenticated
  using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
revoke insert on public.room_state from anon, authenticated;

-- messages
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (public.is_room_member(room_id) and user_id = auth.uid());
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Realtime: channel privat "room:<room_id>" hanya untuk anggota room
-- ---------------------------------------------------------------------

drop policy if exists "room members can receive" on realtime.messages;
create policy "room members can receive" on realtime.messages for select to authenticated
  using (public.is_room_member(public.room_id_from_topic(realtime.topic())));

drop policy if exists "room members can send" on realtime.messages;
create policy "room members can send" on realtime.messages for insert to authenticated
  with check (public.is_room_member(public.room_id_from_topic(realtime.topic())));

