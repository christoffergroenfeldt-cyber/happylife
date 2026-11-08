-- Happy Life – Supabase schema
-- Run this whole file once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Visibility is enforced by Row Level Security in the database, so an item
-- assigned to "husband" can never be read by the wife or children, even with
-- a modified app.


-- ---------------------------------------------------------------- tables

create table if not exists families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique
              default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at  timestamptz not null default now()
);

create table if not exists members (
  user_id      uuid primary key references auth.users on delete cascade,
  family_id    uuid not null references families on delete cascade,
  display_name text not null,
  roles        text[] not null default '{}',
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint member_roles_valid
    check (roles <@ array['child','mother','father','husband','wife'])
);

-- Helper functions (security definer so they can read members without
-- recursing through members' own RLS policy)
create or replace function my_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from members where user_id = auth.uid()
$$;

create or replace function my_roles() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select roles from members where user_id = auth.uid()), '{}')
$$;

create or replace function i_am_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from members where user_id = auth.uid()), false)
$$;

-- An item is visible when it is for everyone, shares a role with me,
-- or I created it (so a parent can follow up on a task given to the children).
create or replace function can_see(item_roles text[], creator uuid) returns boolean
language sql stable as $$
  select 'all' = any(item_roles) or item_roles && my_roles() or creator = auth.uid()
$$;

create or replace function i_am_parent() returns boolean
language sql stable as $$
  select my_roles() && array['mother','father']
$$;

-- Everyone listed must be a member of my family
create or replace function all_in_my_family(ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from unnest(ids) u
    where not exists (select 1 from members m where m.user_id = u and m.family_id = my_family()))
$$;

-- Plans: created by parents, e.g. "Morning routine" or "Weekend chores"
create table if not exists plans (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null default my_family() references families on delete cascade,
  title       text not null,
  notes       text,
  created_by  uuid default auth.uid() references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

-- A task is one of:
--   * assigned to specific people (assignees) – each person ticks off their own
--   * open family task (open = true) – anyone who can see it takes it; `need` people
--   * role task (roles only) – e.g. husband-only
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null default my_family() references families on delete cascade,
  plan_id       uuid references plans on delete cascade,
  title         text not null,
  notes         text,
  roles         text[] not null default '{}',
  assignees     uuid[] not null default '{}',
  open          boolean not null default false,
  need          int not null default 1 check (need between 1 and 20),
  recurrence    text not null default 'once'
                check (recurrence in ('once','daily','weekly','monthly','yearly','custom')),
  interval_days int check (interval_days is null or interval_days > 0),
  start_date    date not null default current_date,
  due_date      date,
  created_by    uuid default auth.uid() references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  constraint task_roles_valid check (
    roles <@ array['all','child','mother','father','husband','wife']),
  constraint task_has_audience check (cardinality(roles) > 0 or cardinality(assignees) > 0),
  constraint task_custom_interval check (recurrence <> 'custom' or interval_days is not null)
);

create or replace function task_visible(item_roles text[], item_assignees uuid[], creator uuid)
returns boolean language sql stable as $$
  select can_see(item_roles, creator) or auth.uid() = any(item_assignees)
$$;

-- `period` identifies the occurrence: 'once', a date for daily/weekly/custom,
-- 'YYYY-MM' for monthly, 'YYYY' for yearly (computed by the app).
create table if not exists task_done (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks on delete cascade,
  period     text not null,
  done_on    date not null default current_date,
  done_by    uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, period, done_by)
);

-- Who has taken an open family task for a period (like HØBK activities)
create table if not exists task_takes (
  task_id    uuid not null references tasks on delete cascade,
  period     text not null,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, period, user_id)
);

-- "Moments": things to do regularly, with a "days since last time" reminder
create table if not exists trackers (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null default my_family() references families on delete cascade,
  title         text not null,
  kind          text not null default 'custom'
                check (kind in ('flowers','surprise','date','trip','custom')),
  roles         text[] not null,
  interval_days int not null default 30 check (interval_days > 0),
  created_by    uuid default auth.uid() references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  constraint tracker_roles_valid check (cardinality(roles) > 0 and
    roles <@ array['all','child','mother','father','husband','wife'])
);

create table if not exists tracker_entries (
  id         uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references trackers on delete cascade,
  done_on    date not null default current_date,
  note       text,
  done_by    uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- Calendar: vacations, anniversaries, birthdays
create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null default my_family() references families on delete cascade,
  type          text not null check (type in ('vacation','anniversary','birthday','other')),
  title         text not null,
  start_date    date not null,
  end_date      date,
  yearly        boolean not null default false,
  remind_days   int not null default 7 check (remind_days >= 0),
  roles         text[] not null default '{all}',
  created_by    uuid default auth.uid() references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  constraint event_roles_valid check (cardinality(roles) > 0 and
    roles <@ array['all','child','mother','father','husband','wife'])
);

create index if not exists tasks_family on tasks(family_id);
create index if not exists tasks_plan on tasks(plan_id);
create index if not exists task_done_task on task_done(task_id, period);
create index if not exists task_takes_task on task_takes(task_id, period);
create index if not exists trackers_family on trackers(family_id);
create index if not exists tracker_entries_tracker on tracker_entries(tracker_id, done_on);
create index if not exists events_family on events(family_id);

-- ---------------------------------------------------------------- RLS

alter table families        enable row level security;
alter table members         enable row level security;
alter table plans           enable row level security;
alter table tasks           enable row level security;
alter table task_done       enable row level security;
alter table task_takes      enable row level security;
alter table trackers        enable row level security;
alter table tracker_entries enable row level security;
alter table events          enable row level security;

drop policy if exists fam_select on families;
create policy fam_select on families for select using (id = my_family());
drop policy if exists fam_update on families;
create policy fam_update on families for update
  using (id = my_family() and i_am_admin()) with check (id = my_family());

drop policy if exists mem_select on members;
create policy mem_select on members for select using (family_id = my_family());
drop policy if exists mem_delete on members;
create policy mem_delete on members for delete
  using (family_id = my_family() and i_am_admin() and user_id <> auth.uid());
-- members are inserted/updated only through the functions below

-- Plans: whole family can see them, only parents create/change them
drop policy if exists plans_select on plans;
create policy plans_select on plans for select using (family_id = my_family());
drop policy if exists plans_insert on plans;
create policy plans_insert on plans for insert
  with check (family_id = my_family() and created_by = auth.uid() and i_am_parent());
drop policy if exists plans_update on plans;
create policy plans_update on plans for update
  using (family_id = my_family() and i_am_parent()) with check (family_id = my_family());
drop policy if exists plans_delete on plans;
create policy plans_delete on plans for delete
  using (family_id = my_family() and i_am_parent());

-- Tasks
--  see:    for my role / everyone / assigned to me / created by me
--  create: anyone for themselves or a role; only parents assign to other
--          people or put tasks in a plan
--  change: creator or a parent (who can see it)
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select
  using (family_id = my_family() and task_visible(roles, assignees, created_by));
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  family_id = my_family() and created_by = auth.uid()
  and all_in_my_family(assignees)
  and (assignees <@ array[auth.uid()] or i_am_parent())
  and (plan_id is null or i_am_parent()));
drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
  using (family_id = my_family() and task_visible(roles, assignees, created_by)
         and (created_by = auth.uid() or i_am_parent()))
  with check (family_id = my_family() and all_in_my_family(assignees)
         and (assignees <@ array[auth.uid()] or i_am_parent())
         and (plan_id is null or i_am_parent()));
drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete
  using (family_id = my_family() and task_visible(roles, assignees, created_by)
         and (created_by = auth.uid() or i_am_parent()));

-- Moments and calendar: role based
do $$
declare t text;
begin
  foreach t in array array['trackers','events'] loop
    execute format('drop policy if exists %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select
      using (family_id = my_family() and can_see(roles, created_by))', t);
    execute format('drop policy if exists %1$s_insert on %1$s', t);
    execute format('create policy %1$s_insert on %1$s for insert
      with check (family_id = my_family() and created_by = auth.uid())', t);
    execute format('drop policy if exists %1$s_update on %1$s', t);
    execute format('create policy %1$s_update on %1$s for update
      using (family_id = my_family() and can_see(roles, created_by))
      with check (family_id = my_family())', t);
    execute format('drop policy if exists %1$s_delete on %1$s', t);
    execute format('create policy %1$s_delete on %1$s for delete
      using (family_id = my_family() and can_see(roles, created_by))', t);
  end loop;
end $$;

-- Completions/takes are visible exactly when their task is visible
-- (the sub-select runs under the tasks table's RLS). You can only add or
-- remove your own.
drop policy if exists td_all on task_done;
drop policy if exists td_select on task_done;
create policy td_select on task_done for select
  using (exists (select 1 from tasks t where t.id = task_id));
drop policy if exists td_insert on task_done;
create policy td_insert on task_done for insert
  with check (done_by = auth.uid() and exists (select 1 from tasks t where t.id = task_id));
drop policy if exists td_delete on task_done;
create policy td_delete on task_done for delete using (done_by = auth.uid());

drop policy if exists tt_select on task_takes;
create policy tt_select on task_takes for select
  using (exists (select 1 from tasks t where t.id = task_id));
drop policy if exists tt_delete on task_takes;
create policy tt_delete on task_takes for delete using (user_id = auth.uid());
-- taking goes through take_task() so the "need" limit is respected

drop policy if exists te_all on tracker_entries;
create policy te_all on tracker_entries for all
  using (exists (select 1 from trackers t where t.id = tracker_id))
  with check (exists (select 1 from trackers t where t.id = tracker_id) and done_by = auth.uid());

-- ---------------------------------------------------------------- functions

create or replace function clean_roles(r text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct x), '{}')
  from unnest(r) x where x in ('child','mother','father','husband','wife')
$$;

-- First family member creates the family and becomes admin.
-- Default "moments" are created without an owner, so each is visible only
-- to its roles (the wife never sees the husband's flower tracker).
create or replace function create_family(p_name text, p_display_name text,
                                         p_roles text[], p_lang text default 'da')
returns families language plpgsql security definer set search_path = public as $$
declare f families; l text := coalesce(p_lang, 'da');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'already in a family';
  end if;
  insert into families(name) values (trim(p_name)) returning * into f;
  insert into members(user_id, family_id, display_name, roles, is_admin)
    values (auth.uid(), f.id, trim(p_display_name), clean_roles(p_roles), true);

  insert into trackers(family_id, title, kind, roles, interval_days, created_by) values
    (f.id, case l when 'en' then 'Gave flowers'      when 'fr' then 'Offert des fleurs'   else 'Givet blomster'        end, 'flowers',  '{husband}',      30,  null),
    (f.id, case l when 'en' then 'Surprised my wife' when 'fr' then 'Surpris ma femme'    else 'Overrasket min kone'   end, 'surprise', '{husband}',      60,  null),
    (f.id, case l when 'en' then 'Surprised my husband' when 'fr' then 'Surpris mon mari' else 'Overrasket min mand'   end, 'surprise', '{wife}',         60,  null),
    (f.id, case l when 'en' then 'Went out together' when 'fr' then 'Sortie en amoureux'  else 'Været ude sammen'      end, 'date',     '{husband,wife}', 30,  null),
    (f.id, case l when 'en' then 'Trip together'     when 'fr' then 'Voyage à deux'       else 'Været på tur sammen'   end, 'trip',     '{husband,wife}', 180, null);
  return f;
end $$;

create or replace function join_family(p_code text, p_display_name text, p_roles text[])
returns families language plpgsql security definer set search_path = public as $$
declare f families;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'already in a family';
  end if;
  select * into f from families where invite_code = upper(trim(p_code));
  if not found then raise exception 'invalid invite code'; end if;
  insert into members(user_id, family_id, display_name, roles)
    values (auth.uid(), f.id, trim(p_display_name), clean_roles(p_roles));
  return f;
end $$;

-- Only the admin can change roles (so a child can't make themself "wife")
create or replace function set_member_roles(p_user uuid, p_roles text[], p_admin boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not i_am_admin() then raise exception 'admin only'; end if;
  update members set roles = clean_roles(p_roles),
                     is_admin = coalesce(p_admin, is_admin)
   where user_id = p_user and family_id = my_family();
end $$;

create or replace function rename_me(p_name text)
returns void language sql security definer set search_path = public as $$
  update members set display_name = trim(p_name) where user_id = auth.uid()
$$;

create or replace function new_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare c text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
begin
  if not i_am_admin() then raise exception 'admin only'; end if;
  update families set invite_code = c where id = my_family();
  return c;
end $$;

-- Take an open family task for a period (refuses when enough people have taken it)
create or replace function take_task(p_task uuid, p_period text)
returns void language plpgsql security definer set search_path = public as $$
declare tk tasks; n int;
begin
  select * into tk from tasks where id = p_task and family_id = my_family()
    and task_visible(roles, assignees, created_by) for update;
  if not found or not tk.open then raise exception 'task not found'; end if;
  if exists (select 1 from task_takes where task_id = p_task and period = p_period and user_id = auth.uid()) then
    return;
  end if;
  select count(*) into n from task_takes where task_id = p_task and period = p_period;
  if n >= tk.need then raise exception 'task full'; end if;
  insert into task_takes(task_id, period, user_id) values (p_task, p_period, auth.uid());
end $$;

-- ---------------------------------------------------------------- reminders
-- A task can have a reminder: a time of day and how many days before the
-- deadline. The deadline is the last day of the task's period (daily: that
-- day, weekly: Sunday, monthly: last day of the month, yearly: 31 Dec,
-- every X days: last day of the interval, once: the due date).
-- The `remind` Edge Function (run every 5 minutes, see cron.sql) sends each
-- reminder once as a push notification to the people who still have to do it.

alter table tasks add column if not exists remind_time time;
alter table tasks add column if not exists remind_days_before int not null default 0
  check (remind_days_before between 0 and 60);

-- One row per phone that has turned on notifications
create table if not exists push_subscriptions (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  lang       text not null default 'da',
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists push_select on push_subscriptions;
create policy push_select on push_subscriptions for select using (user_id = auth.uid());
drop policy if exists push_delete on push_subscriptions;
create policy push_delete on push_subscriptions for delete using (user_id = auth.uid());

-- Save this phone's subscription for me (replaces it if another family
-- member used to be signed in on the same phone)
create or replace function save_push(p_endpoint text, p_p256dh text, p_auth text, p_lang text default 'da')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from push_subscriptions where endpoint = p_endpoint;
  insert into push_subscriptions(user_id, endpoint, p256dh, auth, lang)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth,
            case when p_lang in ('da','en','fr') then p_lang else 'da' end);
end $$;

-- Which reminders have been sent (so each goes out once). Only the server
-- function reads and writes it: RLS on with no policies blocks the app.
create table if not exists reminders_sent (
  task_id  uuid not null references tasks on delete cascade,
  period   text not null,
  user_id  uuid not null references auth.users on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (task_id, period, user_id)
);
alter table reminders_sent enable row level security;

-- ---------------------------------------------------------------- points
-- A parent can give a task points. Whoever ticks it off earns them. The
-- database writes them to points_log when the task is ticked off (not the
-- app), so nobody can award themselves extra, changing a task's points later
-- doesn't rewrite history, and deleting an old task keeps the points earned.
-- Undoing a tick removes its points again.

alter table tasks add column if not exists points int not null default 0
  check (points between 0 and 1000);

create table if not exists points_log (
  task_done_id uuid primary key,          -- no foreign key: survives task deletion
  user_id      uuid not null references auth.users on delete cascade,
  family_id    uuid not null references families on delete cascade,
  points       int not null,
  title        text not null,
  done_on      date not null,
  created_at   timestamptz not null default now()
);
create index if not exists points_log_user on points_log(user_id, done_on);
alter table points_log enable row level security;  -- read through points_summary() only

create or replace function task_done_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into points_log(task_done_id, user_id, family_id, points, title, done_on)
      select new.id, new.done_by, t.family_id, t.points, t.title, new.done_on
      from tasks t where t.id = new.task_id and t.points > 0
    on conflict do nothing;
    return new;
  end if;
  -- DELETE: an undo while the task still exists takes the points back;
  -- a delete caused by removing the whole task keeps them.
  if exists (select 1 from tasks where id = old.task_id) then
    delete from points_log where task_done_id = old.id;
  end if;
  return old;
end $$;
drop trigger if exists task_done_points on task_done;
create trigger task_done_points after insert or delete on task_done
  for each row execute function task_done_points();

-- Only parents may put points on a task (re-creates the task write policies)
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  family_id = my_family() and created_by = auth.uid()
  and all_in_my_family(assignees)
  and (assignees <@ array[auth.uid()] or i_am_parent())
  and (plan_id is null or i_am_parent())
  and (points = 0 or i_am_parent()));
drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
  using (family_id = my_family() and task_visible(roles, assignees, created_by)
         and (created_by = auth.uid() or i_am_parent()))
  with check (family_id = my_family() and all_in_my_family(assignees)
         and (assignees <@ array[auth.uid()] or i_am_parent())
         and (plan_id is null or i_am_parent())
         and (points = 0 or i_am_parent()));

-- Point counters: a child sees their own, parents see every child's.
-- `week` counts from Monday (Danish time).
create or replace function points_summary()
returns table (user_id uuid, total bigint, week bigint)
language sql stable security definer set search_path = public as $$
  select m.user_id,
         coalesce(sum(p.points), 0),
         coalesce(sum(p.points) filter (where p.done_on >=
           date_trunc('week', (now() at time zone 'Europe/Copenhagen'))::date), 0)
  from members m
  left join points_log p on p.user_id = m.user_id and p.family_id = m.family_id
  where m.family_id = my_family() and 'child' = any(m.roles)
    and (i_am_parent() or m.user_id = auth.uid())
  group by m.user_id
$$;

revoke execute on function create_family(text,text,text[],text), join_family(text,text,text[]),
  set_member_roles(uuid,text[],boolean), rename_me(text), new_invite_code(), take_task(uuid,text),
  save_push(text,text,text,text), points_summary() from anon, public;
grant execute on function create_family(text,text,text[],text), join_family(text,text,text[]),
  set_member_roles(uuid,text[],boolean), rename_me(text), new_invite_code(), take_task(uuid,text),
  save_push(text,text,text,text), points_summary() to authenticated;

-- ---------------------------------------------------------------- hardening
-- Helper functions are only for signed-in family members; the points trigger
-- function is never called directly; fixed search_path everywhere.
revoke execute on function my_family(), my_roles(), i_am_admin(), all_in_my_family(uuid[]),
  can_see(text[], uuid), i_am_parent(), task_visible(text[], uuid[], uuid), clean_roles(text[]) from anon, public;
grant execute on function my_family(), my_roles(), i_am_admin(), all_in_my_family(uuid[]),
  can_see(text[], uuid), i_am_parent(), task_visible(text[], uuid[], uuid), clean_roles(text[]) to authenticated;
revoke execute on function task_done_points() from anon, authenticated, public;
alter function can_see(text[], uuid) set search_path = public;
alter function i_am_parent() set search_path = public;
alter function task_visible(text[], uuid[], uuid) set search_path = public;
alter function clean_roles(text[]) set search_path = public;
