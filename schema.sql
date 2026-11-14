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

-- ================================================================ calendar
-- 1) Event tasks: a parent can attach tasks to a calendar event, e.g.
--    "Buy present" 7 days before Anna's birthday. recurrence = 'event':
--    one occurrence per event date (every year for yearly events). The task
--    copies the event's date and yearly flag (kept in sync by triggers), so
--    a child can do the task even if the event itself is parents-only.
-- 2) Calendar sync from iPhone: an iOS Shortcut (like the Friends app's)
--    sends the events of the coming year. Only events from calendars the
--    parent has switched on in the app are saved; the rest are discarded
--    on arrival – only calendar names are kept, so they can be switched on.

alter table tasks drop constraint if exists tasks_recurrence_check;
alter table tasks add constraint tasks_recurrence_check
  check (recurrence in ('once','daily','weekdays','weekly','monthly','yearly','custom','event'));
alter table tasks add column if not exists event_id uuid references events on delete cascade;
alter table tasks add column if not exists days_before int not null default 0
  check (days_before between 0 and 365);
alter table tasks add column if not exists event_yearly boolean not null default false;
alter table tasks drop constraint if exists task_event_link;
alter table tasks add constraint task_event_link
  check ((recurrence = 'event') = (event_id is not null));
create index if not exists tasks_event on tasks(event_id);

-- Weekly series (found by the calendar sync): one event = "every N weeks from
-- start_date until repeat_until, except skip_dates" (e.g. a lesson, minus holidays)
alter table events add column if not exists every_weeks smallint check (every_weeks between 1 and 4);
alter table events add column if not exists repeat_until date;
alter table events add column if not exists skip_dates date[] not null default '{}';
alter table tasks add column if not exists event_every_weeks smallint;
alter table tasks add column if not exists event_until date;
alter table tasks add column if not exists event_skips date[] not null default '{}';

alter table events add column if not exists ext_key text;          -- set for imported events
-- Today page: time of day ('HH:MM', null = all day) and who an event is about
-- (names, e.g. 'Carl', or '@wife'); a phone calendar can carry a default "who"
alter table events add column if not exists start_time text check (start_time is null or start_time ~ '^\d{2}:\d{2}$');
alter table events add column if not exists people text[] not null default '{}';
alter table events drop constraint if exists events_people_ok;
alter table events add constraint events_people_ok check (cardinality(people) <= 12);
alter table events drop constraint if exists events_type_check;
alter table events add constraint events_type_check
  check (type in ('vacation','anniversary','birthday','school','sport','show','other'));
alter table events add column if not exists imported boolean not null default false;
create unique index if not exists events_ext_key on events(family_id, ext_key);

-- Event tasks take the date and yearly flag from their event
create or replace function task_event_copy() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev events;
begin
  if new.event_id is null then return new; end if;
  select * into ev from events where id = new.event_id;
  if not found or ev.family_id <> new.family_id then raise exception 'event not found'; end if;
  new.recurrence := 'event';
  new.start_date := ev.start_date;
  new.event_yearly := ev.yearly;
  new.event_every_weeks := ev.every_weeks;
  new.event_until := ev.repeat_until;
  new.event_skips := ev.skip_dates;
  new.due_date := null;
  return new;
end $$;
drop trigger if exists task_event_copy on tasks;
create trigger task_event_copy before insert or update on tasks
  for each row execute function task_event_copy();

create or replace function event_to_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update tasks set start_date = new.start_date, event_yearly = new.yearly, event_every_weeks = new.every_weeks,
                   event_until = new.repeat_until, event_skips = new.skip_dates
   where event_id = new.id;
  return new;
end $$;
drop trigger if exists event_to_tasks on events;
create trigger event_to_tasks after update of start_date, yearly, every_weeks, repeat_until, skip_dates on events
  for each row execute function event_to_tasks();

-- Only parents attach tasks to events
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  family_id = my_family() and created_by = auth.uid()
  and all_in_my_family(assignees)
  and (assignees <@ array[auth.uid()] or i_am_parent())
  and (plan_id is null or i_am_parent())
  and (points = 0 or i_am_parent())
  and (event_id is null or i_am_parent()));
drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
  using (family_id = my_family() and task_visible(roles, assignees, created_by)
         and (created_by = auth.uid() or i_am_parent()))
  with check (family_id = my_family() and all_in_my_family(assignees)
         and (assignees <@ array[auth.uid()] or i_am_parent())
         and (plan_id is null or i_am_parent())
         and (points = 0 or i_am_parent())
         and (event_id is null or i_am_parent()));

-- ---------------------------------------------------------------- sync
create table if not exists sync_tokens (
  user_id      uuid primary key references auth.users on delete cascade,
  token        text not null unique
               default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  last_sync_at timestamptz,
  last_result  text
);
alter table sync_tokens enable row level security;
drop policy if exists st_select on sync_tokens;
create policy st_select on sync_tokens for select using (user_id = auth.uid());

-- The phone calendars each parent has sent, and which ones to import
create table if not exists user_calendars (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  family_id    uuid not null references families on delete cascade,
  name         text not null,
  included     boolean not null default false,
  yearly       boolean not null default false,
  last_seen_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table user_calendars enable row level security;
drop policy if exists uc_select on user_calendars;
create policy uc_select on user_calendars for select using (user_id = auth.uid());
-- Three modes per calendar: off (nothing kept), on (included: every event is
-- imported) or pick (events wait in the parent's "Find events" inbox until
-- they are followed one by one – for busy feeds like Aula or ForældreIntra)
alter table user_calendars add column if not exists pick boolean not null default false;
alter table user_calendars add column if not exists people text[] not null default '{}';
alter table user_calendars drop constraint if exists user_calendars_one_mode;
alter table user_calendars add constraint user_calendars_one_mode check (not (included and pick));

-- Which parent's calendar(s) an imported event came from. An event is
-- removed when no calendar has it any more (its tasks go with it).
create table if not exists event_sources (
  event_id    uuid not null references events on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  calendar_id uuid not null references user_calendars on delete cascade,
  last_seen   timestamptz not null default now(),
  primary key (event_id, user_id, calendar_id)
);
alter table event_sources enable row level security;   -- server only

-- "Find events": events from pick-mode calendars, one row per event (a weekly
-- series such as a lesson is one row). Refreshed at every sync; whether a row
-- is new, followed or hidden survives the refresh. Following an event copies
-- it into `events` (where tasks can be attached); the sync keeps it up to date.
create table if not exists calendar_inbox (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  calendar_id  uuid not null references user_calendars on delete cascade,
  ext_key      text not null,
  title        text not null,
  start_date   date not null,
  end_date     date,
  start_time   text check (start_time is null or start_time ~ '^\d{2}:\d{2}$'),  -- local time; null = all day
  every_weeks  smallint,
  repeat_until date,
  skip_dates   date[] not null default '{}',
  status       text not null default 'new' check (status in ('new','followed','hidden')),
  event_id     uuid references events on delete set null,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  unique (calendar_id, ext_key)
);
create index if not exists calendar_inbox_user on calendar_inbox(user_id, start_date);
alter table calendar_inbox enable row level security;   -- read your own; changed through inbox_set()
drop policy if exists ci_select on calendar_inbox;
create policy ci_select on calendar_inbox for select using (user_id = auth.uid());
grant select on calendar_inbox to authenticated;
revoke insert, update, delete on calendar_inbox from anon, authenticated;

create or replace function cal_ext_key(p_title text, p_date date, p_yearly boolean) returns text
language sql immutable set search_path = public as $$
  select case when p_yearly then 'y|' || lower(p_title) || '|' || to_char(p_date, 'MM-DD')
              else 'o|' || lower(p_title) || '|' || to_char(p_date, 'YYYY-MM-DD') end
$$;

create or replace function cal_guess_type(p_title text, p_calendar text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_title || ' ' || p_calendar ~* '(fødsels|fodsels|birthday|anniversaire de|geburtstag|cumpleaños)' then 'birthday'
    when p_title || ' ' || p_calendar ~* '(bryllup|mærkedag|anniversary|anniversaire|jubilæum|kæreste)' then 'anniversary'
    when p_title ~* '(forældremøde|foraeldremode|skole-hjem|skolehjem|samtale|forældrekaffe|parent.?teacher|réunion|lejrskole|udflugt|ekskursion|field trip|sortie|motionsdag|fotografering|klassefest|skolefest)' then 'school'
    when p_title ~* '(forestilling|koncert|opvisning|optræden|teater|musical|lucia|show|spectacle|concert|recital|performance)' then 'show'
    when p_title ~* '(kamp|stævne|staevne|turnering|\mcup\M|match|tournament|tournoi|træning|traening|training|entraînement)' then 'sport'
    when p_title || ' ' || p_calendar ~* '(ferie|vacation|holiday|vacances|rejse|trip)' then 'vacation'
    else 'other' end
$$;

create or replace function remove_orphan_events(p_family uuid) returns void
language sql security definer set search_path = public as $$
  delete from events e where e.family_id = p_family and e.imported
    and not exists (select 1 from event_sources s where s.event_id = e.id)
$$;

-- Called by the iOS Shortcut (with the public anon key + the personal sync
-- code). Six lists, one line per event, same order. Rules:
--   * same number of lines in every list, ISO 8601 dates, Yes/No all-day
--   * at most 20000 events, 40 calendars, titles up to 200 characters
--   * nothing is saved if anything is wrong
--   * a calendar that sends nothing keeps its events (e.g. access not granted)
create or replace function sync_calendar(p_token text, p_titles text, p_starts text, p_ends text,
                                         p_allday text, p_calendars text)
returns text language plpgsql security definer set search_path = public
set statement_timeout = '30s' as $$
declare
  iso_re  constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$';
  flag_re constant text := '^(yes|no|true|false|1|0|ja|nej|oui|non)$';
  me members;
  split_re constant text := E'\\r?\\n';
  ti text[] := regexp_split_to_array(regexp_replace(coalesce(p_titles, ''),    E'(\\r?\\n)+$', ''), split_re);
  s  text[] := regexp_split_to_array(regexp_replace(trim(coalesce(p_starts, '')),    E'\\s*\\r?\\n\\s*', E'\n', 'g'), split_re);
  e  text[] := regexp_split_to_array(regexp_replace(trim(coalesce(p_ends, '')),      E'\\s*\\r?\\n\\s*', E'\n', 'g'), split_re);
  a  text[] := regexp_split_to_array(regexp_replace(trim(coalesce(p_allday, '')),    E'\\s*\\r?\\n\\s*', E'\n', 'g'), split_re);
  c  text[] := regexp_split_to_array(regexp_replace(trim(coalesce(p_calendars, '')), E'\\s*\\r?\\n\\s*', E'\n', 'g'), split_re);
  n int; i int; cal user_calendars; t text;
  seen_cals uuid[] := '{}'; n_saved int := 0; n_series int := 0; n_new_cals int := 0; n_cals int; msg text;
  fr calendar_inbox; mv record; n_mv int; n_inbox_new int := 0;
begin
  select m.* into me from sync_tokens st join members m on m.user_id = st.user_id
   where st.token = trim(coalesce(p_token, ''));
  if not found then
    raise exception 'Ukendt synkroniseringskode. Kopiér den igen i Happy Life (Familie → Kalender fra iPhone).';
  end if;
  if not (me.roles && array['mother','father']) then
    raise exception 'Kun mor og far kan synkronisere kalendere.';
  end if;
  if length(coalesce(p_titles,'')) + length(coalesce(p_starts,'')) + length(coalesce(p_ends,''))
     + length(coalesce(p_calendars,'')) > 8000000 then
    raise exception 'For mange data. Intet blev gemt.';
  end if;
  if coalesce(p_starts, '') ~ '^\s*$' then
    raise exception 'Ingen begivenheder modtaget. Intet blev ændret.';
  end if;

  n := array_length(s, 1);
  if n <> coalesce(array_length(ti, 1), 0) or n <> coalesce(array_length(e, 1), 0)
     or n <> coalesce(array_length(a, 1), 0) or n <> coalesce(array_length(c, 1), 0) then
    raise exception 'Afvist: % titler, % starttider, % sluttider, % heldags og % kalendere – de skal passe sammen (måske en titel med linjeskift). Intet blev gemt.',
      coalesce(array_length(ti, 1), 0), n, coalesce(array_length(e, 1), 0),
      coalesce(array_length(a, 1), 0), coalesce(array_length(c, 1), 0);
  end if;
  if n > 20000 then raise exception 'Over 20000 begivenheder. Hent færre dage i genvejen. Intet blev gemt.'; end if;
  select min(x.k) into i from unnest(s, e, a) with ordinality as x(s1, e1, a1, k)
   where x.s1 !~ iso_re or x.e1 !~ iso_re or lower(x.a1) !~ flag_re;
  if i is not null then
    raise exception 'Afvist: begivenhed % har ikke en gyldig start, slut og Ja/Nej. Intet blev gemt.', i;
  end if;
  select min(x.k) into i from unnest(c) with ordinality as x(c1, k)
   where length(x.c1) not between 1 and 100 or x.c1 ~ '[[:cntrl:]]';
  if i is not null then
    raise exception 'Afvist: begivenhed % har et ugyldigt kalendernavn. Intet blev gemt.', i;
  end if;
  select count(distinct x) into n_cals from unnest(c) x;
  if n_cals > 40 then raise exception 'Over 40 kalendere. Intet blev gemt.'; end if;

  -- Calendars: remember all names; new ones named like birthdays are on by default
  for t in select distinct x from unnest(c) x loop
    if not exists (select 1 from user_calendars where user_id = me.user_id and name = t)
       and t !~* '(fødsels|fodsels|birthday|anniversaire|geburtstag|mærkedag)' then
      n_new_cals := n_new_cals + 1;
    end if;
    insert into user_calendars(user_id, family_id, name, included, yearly)
      values (me.user_id, me.family_id, t,
              t ~* '(fødsels|fodsels|birthday|anniversaire|geburtstag|mærkedag)',
              t ~* '(fødsels|fodsels|birthday|anniversaire|geburtstag|mærkedag)')
      on conflict (user_id, name) do update set last_seen_at = now(), family_id = excluded.family_id
      returning * into cal;
    seen_cals := seen_cals || cal.id;
  end loop;

  -- Events from switched-on and pick-mode calendars, read in one go (fast even
  -- for thousands). The same title on the same weekday at least 4 times, every
  -- 1 or 2 weeks (gaps such as holidays allowed), becomes ONE weekly series.
  drop table if exists pg_temp.sync_src;
  create temp table sync_src on commit drop as
  with r as (
    select left(btrim(regexp_replace(x.ti1, '[[:cntrl:]]', ' ', 'g')), 200) as tt,
           substr(x.s1, 1, 10)::date as d1, substr(x.e1, 1, 10)::date as d2,
           lower(x.a1) in ('yes','true','1','ja','oui') as allday,
           substr(x.s1, 12, 5) as tm, substr(x.e1, 12, 5) as etm,
           uc.id as cal_id, uc.yearly and not uc.pick as yearly, uc.name as cal_name, uc.pick
      from unnest(ti, s, e, a, c) as x(ti1, s1, e1, a1, c1)   -- one pass (indexing big text arrays is slow)
      join user_calendars uc on uc.user_id = me.user_id and uc.name = x.c1 and (uc.included or uc.pick)
  ), r2 as (
    select tt, lower(tt) as lt, d1, cal_id, yearly, cal_name, pick, extract(isodow from d1)::int as dow,
           case when allday then null else tm end as tm,
           case when allday and etm = '00:00' and d2 > d1 then d2 - 1 else d2 end as d2   -- all-day events end at midnight the next day
      from r where tt <> ''
  ), single as (          -- one-day, not-yearly occurrences, one per day and time of day
    select distinct cal_id, lt, dow, tm, d1 from r2 where not yearly and (d2 is null or d2 <= d1)
  ), gaps as (
    select cal_id, lt, dow, tm, d1, d1 - lag(d1) over (partition by cal_id, lt, dow, tm order by d1) as gap from single
  ), ser0 as (            -- a series per calendar, title, weekday AND time (double lessons are two series)
    select cal_id, lt, dow, tm, min(d1) as d_first, max(d1) as d_last, count(*)::int as n_occ,
           case when bool_and(gap is null or gap % 14 = 0) then 14 else 7 end as step
      from gaps group by cal_id, lt, dow, tm having count(*) >= 4
  ), ser as (            -- not too many gaps: at most as many skipped weeks as real ones
    select ser0.*,
           (select min(tt) from r2 where r2.cal_id = ser0.cal_id and r2.lt = ser0.lt and r2.dow = ser0.dow
                                     and r2.tm is not distinct from ser0.tm) as title,
           (select pick from user_calendars where id = ser0.cal_id) as pick,
           (select name from user_calendars where id = ser0.cal_id) as cal_name,
           array(select g::date from generate_series(d_first, d_last, make_interval(days => step)) g
                  where g::date not in (select d1 from single sg where sg.cal_id = ser0.cal_id and sg.lt = ser0.lt
                                          and sg.dow = ser0.dow and sg.tm is not distinct from ser0.tm)
                  order by 1) as skips
      from ser0 where (d_last - d_first) / step + 1 - n_occ <= n_occ
  )
  select cal_ext_key(r2.tt, r2.d1, r2.yearly) as k, r2.tt as title, r2.cal_name, r2.d1 as start_date,
         case when not r2.yearly and r2.d2 > r2.d1 then r2.d2 end as end_date, r2.yearly,
         null::smallint as every_weeks, null::date as repeat_until, '{}'::date[] as skip_dates,
         r2.cal_id, r2.pick, r2.tm
    from r2
   where r2.yearly or (r2.d2 is not null and r2.d2 > r2.d1)
      or not exists (select 1 from ser where ser.cal_id = r2.cal_id and ser.lt = r2.lt and ser.dow = r2.dow
                                         and ser.tm is not distinct from r2.tm)
  union all
  -- the calendar's name keeps two children's "DAN on Tuesdays" apart (both parents
  -- subscribing to the same feed still share one event)
  select 'w|' || lt || '|' || dow || '|' || (step / 7) || '|' || coalesce(tm, '') || '|' || lower(cal_name),
         title, cal_name, d_first, null, false, (step / 7)::smallint, d_last, skips, cal_id, pick, tm
    from ser;

  -- Pick mode: a followed event that moved to another date or got a new title
  -- in the school's calendar keeps following it (with its tasks) when there is
  -- exactly one new event with the same title, or else on the same date.
  update calendar_inbox set status = 'new' where user_id = me.user_id and status = 'followed' and event_id is null;
  for fr in select ci.* from calendar_inbox ci
             where ci.user_id = me.user_id and ci.status = 'followed' and ci.every_weeks is null
               and ci.calendar_id = any(seen_cals)
               and not exists (select 1 from sync_src x where x.cal_id = ci.calendar_id and x.k = ci.ext_key) loop
    for i in 1..2 loop
      select count(*) into n_mv from sync_src x
       where x.cal_id = fr.calendar_id and x.every_weeks is null and not x.yearly
         and case i when 1 then lower(x.title) = lower(fr.title) and abs(x.start_date - fr.start_date) <= 92
                    else x.start_date = fr.start_date end
         and not exists (select 1 from calendar_inbox o where o.calendar_id = x.cal_id and o.ext_key = x.k);
      continue when n_mv <> 1;
      select x.* into mv from sync_src x
       where x.cal_id = fr.calendar_id and x.every_weeks is null and not x.yearly
         and case i when 1 then lower(x.title) = lower(fr.title) and abs(x.start_date - fr.start_date) <= 92
                    else x.start_date = fr.start_date end
         and not exists (select 1 from calendar_inbox o where o.calendar_id = x.cal_id and o.ext_key = x.k);
      if not exists (select 1 from events o where o.family_id = me.family_id and o.ext_key = mv.k) then
        update events set ext_key = mv.k, title = mv.title, start_date = mv.start_date, end_date = mv.end_date
         where id = fr.event_id;
        update calendar_inbox set ext_key = mv.k where id = fr.id;
      end if;
      exit;
    end loop;
  end loop;

  -- Pick mode: refresh the inbox (new / followed / hidden is kept)
  with ins as (
    insert into calendar_inbox(user_id, calendar_id, ext_key, title, start_date, end_date, start_time,
                               every_weeks, repeat_until, skip_dates)
    select distinct on (cal_id, k) me.user_id, cal_id, k, title, start_date, end_date, tm,
           every_weeks, repeat_until, skip_dates
      from sync_src where pick order by cal_id, k, start_date, tm
    on conflict (calendar_id, ext_key) do update
      set title = excluded.title, start_date = excluded.start_date, end_date = excluded.end_date,
          start_time = excluded.start_time, every_weeks = excluded.every_weeks,
          repeat_until = excluded.repeat_until, skip_dates = excluded.skip_dates, last_seen = now()
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new) into n_inbox_new from ins;

  -- Into the calendar: everything from switched-on calendars, followed ones from pick-mode calendars
  with src as (
    select * from sync_src x
     where not x.pick or exists (select 1 from calendar_inbox ci where ci.calendar_id = x.cal_id
                                  and ci.ext_key = x.k and ci.status = 'followed' and ci.event_id is not null)
  ), up as (
    insert into events(family_id, type, title, start_date, end_date, yearly, every_weeks, repeat_until, skip_dates,
                       remind_days, roles, created_by, ext_key, imported, start_time, people)
    select distinct on (k) me.family_id, cal_guess_type(title, cal_name), title, start_date, end_date, yearly,
           every_weeks, repeat_until, skip_dates, case when every_weeks is null then 7 else 1 end,
           '{mother,father}', me.user_id, k, true, tm,
           (select uc.people from user_calendars uc where uc.id = src.cal_id)
      from src order by k, start_date
    on conflict (family_id, ext_key) do update
      set end_date = case when events.yearly then null else excluded.end_date end,
          start_time = excluded.start_time,
          people = case when events.people = '{}' then excluded.people else events.people end,
          -- a series keeps its earlier start (and skipped weeks before this sync's window)
          start_date = case when excluded.every_weeks is null then events.start_date
                            when events.start_date < excluded.start_date
                             and (excluded.start_date - events.start_date) % (7 * excluded.every_weeks) = 0
                            then events.start_date else excluded.start_date end,
          repeat_until = excluded.repeat_until,
          skip_dates = case when excluded.every_weeks is null then '{}'::date[]
                            else array(select d from unnest(events.skip_dates) d where d < excluded.start_date)
                                 || excluded.skip_dates end
    returning id, ext_key
  )
  insert into event_sources(event_id, user_id, calendar_id)
  select distinct up.id, me.user_id, src.cal_id from up join src on src.k = up.ext_key
  on conflict (event_id, user_id, calendar_id) do update set last_seen = now();
  select count(distinct es.event_id), count(distinct es.event_id) filter (where ev.every_weeks is not null)
    into n_saved, n_series
    from event_sources es join events ev on ev.id = es.event_id
   where es.user_id = me.user_id and es.last_seen = now();

  -- Events no longer in a calendar that sent something this time
  delete from event_sources es
   where es.user_id = me.user_id and es.calendar_id = any(seen_cals)
     and es.last_seen < now()   -- now() = start of this run; rows seen in this run equal it
     and not exists (select 1 from events ev where ev.id = es.event_id and ev.start_date < current_date
                     and not ev.yearly and ev.every_weeks is null);
  delete from calendar_inbox ci
   where ci.user_id = me.user_id and ci.calendar_id = any(seen_cals) and ci.last_seen < now();
  perform remove_orphan_events(me.family_id);

  msg := format('Happy Life: %s begivenheder%s fra %s af %s kalendere.', n_saved,
                case when n_series > 0 then format(' (heraf %s ugentlige)', n_series) else '' end,
                (select count(*) from user_calendars where id = any(seen_cals) and included), n_cals);
  if n_inbox_new > 0 then
    msg := msg || format(' %s nye under Kalender → Find begivenheder.', n_inbox_new);
  end if;
  if n_new_cals > 0 then
    msg := msg || format(' %s nye kalendere – vælg i appen under Familie, om de skal med.', n_new_cals);
  end if;
  update sync_tokens set last_sync_at = now(), last_result = msg where user_id = me.user_id;
  return msg;
end $$;

-- My sync code (made the first time; parents only)
create or replace function my_sync_token(p_new boolean default false)
returns sync_tokens language plpgsql security definer set search_path = public as $$
declare r sync_tokens;
begin
  if not i_am_parent() then raise exception 'parents only'; end if;
  if p_new then delete from sync_tokens where user_id = auth.uid(); end if;
  insert into sync_tokens(user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select * into r from sync_tokens where user_id = auth.uid();
  return r;
end $$;

-- Set a phone calendar to off / on / pick and change "every year".
--  off:  its events (and their tasks) are removed at once
--  on:   every event is imported at the next sync
--  pick: events wait under Kalender → Find begivenheder until followed.
--        Coming from "on", events that already have tasks stay, as followed.
create or replace function set_calendar_mode(p_id uuid, p_mode text, p_yearly boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare cal user_calendars; y boolean;
begin
  if p_mode not in ('off', 'on', 'pick') then raise exception 'bad mode'; end if;
  select * into cal from user_calendars where id = p_id and user_id = auth.uid();
  if not found then raise exception 'calendar not found'; end if;
  y := coalesce(p_yearly, cal.yearly);
  update user_calendars set included = p_mode = 'on', pick = p_mode = 'pick', yearly = y where id = p_id;

  if p_mode = 'off' then
    delete from event_sources where calendar_id = p_id;
    delete from calendar_inbox where calendar_id = p_id;
  elsif p_mode = 'pick' and cal.included then
    insert into calendar_inbox(user_id, calendar_id, ext_key, title, start_date, end_date,
                               every_weeks, repeat_until, skip_dates, status, event_id)
    select auth.uid(), p_id, ev.ext_key, ev.title, ev.start_date, ev.end_date,
           ev.every_weeks, ev.repeat_until, ev.skip_dates, 'followed', ev.id
      from events ev join event_sources es on es.event_id = ev.id and es.calendar_id = p_id
     where exists (select 1 from tasks tk where tk.event_id = ev.id)
    on conflict (calendar_id, ext_key) do nothing;
    delete from event_sources es where es.calendar_id = p_id
       and not exists (select 1 from calendar_inbox ci where ci.calendar_id = p_id and ci.event_id = es.event_id);
  elsif p_mode = 'on' then
    delete from calendar_inbox where calendar_id = p_id;   -- followed events stay; the next sync brings the rest
    if y is distinct from cal.yearly then
      update events ev set yearly = y, end_date = null, ext_key = cal_ext_key(ev.title, ev.start_date, y)
       where ev.id in (select event_id from event_sources where calendar_id = p_id) and ev.every_weeks is null
         and not exists (select 1 from events o where o.family_id = ev.family_id and o.id <> ev.id
                         and o.ext_key = cal_ext_key(ev.title, ev.start_date, y));
    end if;
  end if;
  perform remove_orphan_events(cal.family_id);
end $$;

-- Older app versions
create or replace function set_calendar(p_id uuid, p_included boolean, p_yearly boolean)
returns void language sql security definer set search_path = public as $$
  select set_calendar_mode(p_id, case when p_included then 'on' else 'off' end, p_yearly)
$$;

-- Find events: follow (copy into the calendar, returns the event id), hide,
-- or set back to new (unfollowing removes the event and its tasks unless
-- another calendar also has it).
create or replace function inbox_set(p_id uuid, p_status text)
returns uuid language plpgsql security definer set search_path = public as $$
declare it calendar_inbox; cal user_calendars; ev_id uuid;
begin
  if p_status not in ('new', 'followed', 'hidden') then raise exception 'bad status'; end if;
  select * into it from calendar_inbox where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'event not found'; end if;
  select * into cal from user_calendars where id = it.calendar_id;
  if not (my_roles() && array['mother','father']) or cal.family_id <> my_family() then
    raise exception 'parents only';
  end if;

  if p_status = 'followed' then
    if it.status = 'followed' and it.event_id is not null then return it.event_id; end if;
    insert into events(family_id, type, title, start_date, end_date, yearly, every_weeks, repeat_until, skip_dates,
                       remind_days, roles, created_by, ext_key, imported, start_time, people)
      values (cal.family_id, cal_guess_type(it.title, cal.name), it.title, it.start_date, it.end_date, false,
              it.every_weeks, it.repeat_until, it.skip_dates, case when it.every_weeks is null then 7 else 1 end,
              '{mother,father}', auth.uid(), it.ext_key, true, it.start_time, cal.people)
      on conflict (family_id, ext_key) do update set title = events.title   -- already there (other calendar)
      returning id into ev_id;
    insert into event_sources(event_id, user_id, calendar_id) values (ev_id, auth.uid(), it.calendar_id)
      on conflict (event_id, user_id, calendar_id) do update set last_seen = now();
    update calendar_inbox set status = 'followed', event_id = ev_id where id = p_id;
    return ev_id;
  end if;

  if it.event_id is not null then
    delete from event_sources where event_id = it.event_id and calendar_id = it.calendar_id;
    perform remove_orphan_events(cal.family_id);
  end if;
  update calendar_inbox set status = p_status, event_id = null where id = p_id;
  return null;
end $$;

revoke execute on function sync_calendar(text,text,text,text,text,text), my_sync_token(boolean),
  set_calendar(uuid,boolean,boolean), set_calendar_mode(uuid,text,boolean), inbox_set(uuid,text), task_event_copy(), event_to_tasks(), remove_orphan_events(uuid),
  cal_ext_key(text,date,boolean), cal_guess_type(text,text) from public, anon, authenticated;
grant execute on function sync_calendar(text,text,text,text,text,text) to anon, authenticated;
grant execute on function my_sync_token(boolean), set_calendar(uuid,boolean,boolean),
  set_calendar_mode(uuid,text,boolean), inbox_set(uuid,text) to authenticated;

-- ================================================================ login codes
-- Sign in on another device with a short code made on a device where you are
-- already signed in. Valid 10 minutes, works once. Only a hash is stored.
-- The `login-code` Edge Function redeems it (service role) and hands the new
-- device a one-time sign-in token. Wrong guesses are throttled.

create table if not exists login_codes (
  code_hash  text primary key,
  user_id    uuid not null references auth.users on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table login_codes enable row level security;   -- server only

create table if not exists login_code_failures (
  id bigserial primary key,
  at timestamptz not null default now()
);
alter table login_code_failures enable row level security;   -- server only

-- Make a code for me: 8 characters without look-alikes (no 0/O, 1/I/L)
create or replace function create_login_code()
returns json language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 characters
  hex text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  code text := '';
  i int; b int;
  exp timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  -- rejection sampling over random bytes keeps every character equally likely
  i := 1;
  while length(code) < 8 loop
    if i > length(hex) - 1 then
      hex := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); i := 1;
    end if;
    b := ('x' || substr(hex, i, 2))::bit(8)::int;
    i := i + 2;
    continue when b >= 248;            -- 248 = 31 * 8
    code := code || substr(alphabet, b % 31 + 1, 1);
  end loop;
  delete from login_codes where user_id = auth.uid() or expires_at < now();
  insert into login_codes(code_hash, user_id, expires_at)
    values (encode(sha256(convert_to(code, 'UTF8')), 'hex'), auth.uid(), exp);
  return json_build_object('code', code, 'expires_at', exp);
end $$;

-- Redeem a code (only the Edge Function can call this). Returns the user id,
-- or null. Throttled: after 30 wrong codes in 15 minutes everyone waits.
create or replace function redeem_login_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  uid uuid;
begin
  delete from login_code_failures where at < now() - interval '1 day';
  if (select count(*) from login_code_failures where at > now() - interval '15 minutes') >= 30 then
    raise exception 'too many attempts';
  end if;
  delete from login_codes
   where code_hash = encode(sha256(convert_to(c, 'UTF8')), 'hex') and expires_at > now()
   returning user_id into uid;
  if uid is null then insert into login_code_failures default values; end if;
  return uid;
end $$;

revoke execute on function create_login_code(), redeem_login_code(text) from public, anon, authenticated;
grant execute on function create_login_code() to authenticated;
grant execute on function redeem_login_code(text) to service_role;

-- ================================================================ ideas for couples
-- Lists kept up to date by a weekly research job (it writes with the service
-- role): experiences in the Copenhagen area, restaurant deals and getaway
-- deals. Shared by all families; visible to the roles in `roles` (husband by
-- default, so the wife won't spot the surprise). Content is in Danish.

create table if not exists suggestions (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('event','restaurant','getaway')),
  title         text not null,
  description   text,
  place         text,
  starts_on     date,
  ends_on       date,
  price         text,
  url           text not null check (url ~ '^https://'),
  drive_minutes int check (drive_minutes is null or drive_minutes between 0 and 1440),
  needs_flight  boolean not null default false,
  travel_note   text,
  source        text,
  roles         text[] not null default '{husband}',
  added_on      date not null default current_date,
  checked_on    date not null default current_date,
  constraint suggestion_roles_valid check (cardinality(roles) > 0 and
    roles <@ array['all','child','mother','father','husband','wife']),
  unique (kind, url, title)
);
alter table suggestions enable row level security;
drop policy if exists sugg_select on suggestions;
create policy sugg_select on suggestions for select
  using (auth.uid() is not null and ('all' = any(roles) or roles && my_roles())
         and coalesce(ends_on, starts_on, current_date) >= current_date);
grant select on suggestions to authenticated;

-- ================================================================ house chores
-- Rooms/areas (indoor and outdoor) and chore types, both editable by parents.
-- A chore for a room is an open task with place_id + chore_id set: parents
-- choose how often per room, children take it / tick it off as a family task
-- (and earn its points, if any). A new family starts with the default list.

create table if not exists house_places (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default my_family() references families on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  outdoor    boolean not null default false,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists house_chores (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default my_family() references families on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  outdoor    boolean not null default false,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists house_places_family on house_places(family_id);
create index if not exists house_chores_family on house_chores(family_id);

alter table tasks add column if not exists place_id uuid references house_places on delete cascade;
alter table tasks add column if not exists chore_id uuid references house_chores on delete cascade;
alter table tasks drop constraint if exists task_house_pair;
alter table tasks add constraint task_house_pair check ((place_id is null) = (chore_id is null));
create unique index if not exists tasks_house_unique on tasks(place_id, chore_id) where place_id is not null;
create index if not exists tasks_chore on tasks(chore_id);

alter table house_places enable row level security;
alter table house_chores enable row level security;
do $$
declare t text;
begin
  foreach t in array array['house_places','house_chores'] loop
    execute format('drop policy if exists %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (family_id = my_family())', t);
    execute format('drop policy if exists %1$s_insert on %1$s', t);
    execute format('create policy %1$s_insert on %1$s for insert
      with check (family_id = my_family() and i_am_parent())', t);
    execute format('drop policy if exists %1$s_update on %1$s', t);
    execute format('create policy %1$s_update on %1$s for update
      using (family_id = my_family() and i_am_parent()) with check (family_id = my_family())', t);
    execute format('drop policy if exists %1$s_delete on %1$s', t);
    execute format('create policy %1$s_delete on %1$s for delete
      using (family_id = my_family() and i_am_parent())', t);
  end loop;
end $$;

-- House chores: only parents create/change them, and only with their own family's rooms
create or replace function house_ok(p_place uuid, p_chore uuid) returns boolean
language sql stable set search_path = public as $$
  select p_place is null or (i_am_parent()
    and exists (select 1 from house_places x where x.id = p_place and x.family_id = my_family())
    and exists (select 1 from house_chores y where y.id = p_chore and y.family_id = my_family()))
$$;

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  family_id = my_family() and created_by = auth.uid()
  and all_in_my_family(assignees)
  and (assignees <@ array[auth.uid()] or i_am_parent())
  and (plan_id is null or i_am_parent())
  and (points = 0 or i_am_parent())
  and (event_id is null or i_am_parent())
  and house_ok(place_id, chore_id));
drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update
  using (family_id = my_family() and task_visible(roles, assignees, created_by)
         and (created_by = auth.uid() or i_am_parent()))
  with check (family_id = my_family() and all_in_my_family(assignees)
         and (assignees <@ array[auth.uid()] or i_am_parent())
         and (plan_id is null or i_am_parent())
         and (points = 0 or i_am_parent())
         and (event_id is null or i_am_parent())
         and house_ok(place_id, chore_id));

-- The default list. Does nothing if the family already has rooms or chore types.
create or replace function seed_house_for(p_family uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from house_places where family_id = p_family)
     or exists (select 1 from house_chores where family_id = p_family) then
    return;
  end if;
  insert into house_places(family_id, name, outdoor, sort)
    select p_family, n, false, i::int from unnest(array[
      'Carl', 'Victor', 'Elizabeth', 'Repo 1. sal', 'Køkken', 'Spisestue', 'Stue', 'Kontor',
      'Mor & Far', 'Badeværelse Mor & Far', 'Badeværelse 1. sal', 'Badeværelse v. Kontor',
      'Bryggers', 'Kælder', 'Fyrrum', 'Carport', 'Udekøkken']) with ordinality as x(n, i);
  insert into house_places(family_id, name, outdoor, sort)
    select p_family, n, true, i::int from unnest(array[
      'Terasse Øst', 'Terasse Syd', 'Terasse Vest', 'Græsplane', 'Terasse Hjørne', 'Foran hus'])
      with ordinality as x(n, i);
  insert into house_chores(family_id, name, outdoor, sort)
    select p_family, n, false, i::int from unnest(array[
      'Støvsug', 'Vask gulv', 'Tør støv af', 'Vand planter', 'Ryd op']) with ordinality as x(n, i);
  insert into house_chores(family_id, name, outdoor, sort)
    select p_family, n, true, i::int from unnest(array[
      'Slå græs', 'Fej blade', 'Fjern ukrudt', 'Rens', 'Giv olie']) with ordinality as x(n, i);
end $$;

-- New families get the list; a parent can load it later with seed_house()
create or replace function family_seed_house() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_house_for(new.id);
  return new;
end $$;
drop trigger if exists family_seed_house on families;
create trigger family_seed_house after insert on families
  for each row execute function family_seed_house();

create or replace function seed_house()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not i_am_parent() then raise exception 'parents only'; end if;
  perform seed_house_for(my_family());
end $$;

-- Existing families that have no house list yet get the default one
select seed_house_for(id) from families;

revoke execute on function seed_house_for(uuid), family_seed_house() from anon, authenticated, public;
revoke execute on function seed_house(), house_ok(uuid, uuid) from anon, public;
grant execute on function seed_house(), house_ok(uuid, uuid) to authenticated;
grant select, insert, update, delete on house_places, house_chores to authenticated;

-- ================================================================ family moments
-- Moments for the whole family (roles = {all}): vacation, takeaway, restaurant,
-- movie, weekend trip, theme park … with "when did we last" + a planned next
-- time (date + note). Everyone sees them and can log one; only parents create,
-- change, plan or delete them. A new family starts with six of them.

alter table trackers drop constraint if exists trackers_kind_check;
alter table trackers add constraint trackers_kind_check check (kind in
  ('flowers','surprise','date','trip','custom',
   'vacation','takeaway','restaurant','movie','weekend','themepark'));
alter table trackers add column if not exists planned_on date;
alter table trackers add column if not exists plan_note text;

drop policy if exists trackers_insert on trackers;
create policy trackers_insert on trackers for insert
  with check (family_id = my_family() and created_by = auth.uid()
              and (not 'all' = any(roles) or i_am_parent()));
drop policy if exists trackers_update on trackers;
create policy trackers_update on trackers for update
  using (family_id = my_family() and can_see(roles, created_by)
         and (not 'all' = any(roles) or i_am_parent()))
  with check (family_id = my_family() and (not 'all' = any(roles) or i_am_parent()));
drop policy if exists trackers_delete on trackers;
create policy trackers_delete on trackers for delete
  using (family_id = my_family() and can_see(roles, created_by)
         and (not 'all' = any(roles) or i_am_parent()));

-- Logging a moment on (or after) its planned date means the plan happened: clear it
create or replace function tracker_entry_clears_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update trackers set planned_on = null, plan_note = null
   where id = new.tracker_id and planned_on is not null and planned_on <= new.done_on + 3;
  return new;
end $$;
drop trigger if exists tracker_entry_clears_plan on tracker_entries;
create trigger tracker_entry_clears_plan after insert on tracker_entries
  for each row execute function tracker_entry_clears_plan();

create or replace function seed_family_moments_for(p_family uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from trackers where family_id = p_family and 'all' = any(roles)) then
    return;
  end if;
  insert into trackers(family_id, title, kind, roles, interval_days, created_by) values
    (p_family, 'Ferie',              'vacation',  '{all}', 180, null),
    (p_family, 'Takeaway',           'takeaway',  '{all}', 14,  null),
    (p_family, 'Restaurant',         'restaurant','{all}', 60,  null),
    (p_family, 'Film',               'movie',     '{all}', 30,  null),
    (p_family, 'Weekendtur',         'weekend',   '{all}', 90,  null),
    (p_family, 'Forlystelsespark',   'themepark', '{all}', 180, null);
end $$;

create or replace function family_seed_moments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_family_moments_for(new.id);
  return new;
end $$;
drop trigger if exists family_seed_moments on families;
create trigger family_seed_moments after insert on families
  for each row execute function family_seed_moments();

-- Existing families without family moments get the six defaults
select seed_family_moments_for(id) from families;

revoke execute on function seed_family_moments_for(uuid), family_seed_moments(),
  tracker_entry_clears_plan() from anon, authenticated, public;

-- ================================================================ house: daily chores
-- A third section next to indoor/outdoor: everyday chores that belong to no
-- room (dishwasher, cat, table, dinner …). They hang off one hidden "daily"
-- place and are switched on every day from the start.

alter table house_places add column if not exists daily boolean not null default false;
alter table house_chores add column if not exists daily boolean not null default false;

create or replace function seed_daily_for(p_family uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pl uuid;
begin
  if exists (select 1 from house_chores where family_id = p_family and daily) then
    return;
  end if;
  select id into pl from house_places where family_id = p_family and daily limit 1;
  if pl is null then
    insert into house_places(family_id, name, daily, outdoor, sort)
      values (p_family, 'Dagligt', true, false, 0) returning id into pl;
  end if;
  insert into house_chores(family_id, name, daily, outdoor, sort)
    select p_family, n, true, false, i::int from unnest(array[
      'Tøm opvaskemaskine', 'Giv kat mad', 'Giv kat vand', 'Tøm kattebakke', 'Dæk bord', 'Lav aftensmad'])
      with ordinality as x(n, i);
  insert into tasks(family_id, title, recurrence, need, open, roles, assignees, place_id, chore_id, created_by)
    select p_family, c.name, 'daily', 1, true, '{child,mother,father}', '{}', pl, c.id, null
      from house_chores c where c.family_id = p_family and c.daily;
end $$;

create or replace function family_seed_house() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_house_for(new.id);
  perform seed_daily_for(new.id);
  return new;
end $$;

create or replace function seed_house()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not i_am_parent() then raise exception 'parents only'; end if;
  perform seed_house_for(my_family());
  perform seed_daily_for(my_family());
end $$;

-- Existing families get the daily list once
select seed_daily_for(id) from families;

revoke execute on function seed_daily_for(uuid) from anon, authenticated, public;

-- ================================================================ house: unique names
-- Rooms and chore types are unique per family (ignoring case and spaces at the ends)
create unique index if not exists house_places_unique_name on house_places(family_id, lower(btrim(name)));
create unique index if not exists house_chores_unique_name on house_chores(family_id, lower(btrim(name)));

-- ================================================================ find: home and nearby places
-- The family's home (set by a parent under Familie) and the places near it that
-- the "Find" page for moments lists: takeaway, restaurants, cinemas, theatres
-- and florists from OpenStreetMap, within nearby_minutes' drive. The phone
-- fetches them (places.js) and a parent's phone saves them here.

alter table families add column if not exists home_address text;
alter table families add column if not exists home_lat double precision;
alter table families add column if not exists home_lon double precision;
alter table families add column if not exists nearby_minutes int not null default 20;
alter table families drop constraint if exists families_nearby_minutes_check;
alter table families add constraint families_nearby_minutes_check check (nearby_minutes between 5 and 60);

create or replace function set_home(p_address text, p_lat double precision, p_lon double precision, p_minutes int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not i_am_parent() then raise exception 'parents only'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lon not between -180 and 180) then
    raise exception 'bad position';
  end if;
  update families set home_address = nullif(btrim(left(p_address, 300)), ''), home_lat = p_lat, home_lon = p_lon,
                      nearby_minutes = coalesce(p_minutes, nearby_minutes)
   where id = my_family();
end $$;

create table if not exists nearby_places (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default my_family() references families on delete cascade,
  osm_id     text not null,
  cats       text[] not null check (cats <@ array['takeaway','restaurant','cinema','theatre','florist'] and cardinality(cats) > 0),
  name       text not null check (length(name) between 1 and 120),
  cuisine    text check (length(cuisine) <= 120),
  grp        text check (length(grp) <= 30),
  address    text check (length(address) <= 300),
  lat        double precision not null,
  lon        double precision not null,
  minutes    int not null check (minutes between 0 and 600),
  estimated  boolean not null default false,
  website    text check (length(website) <= 300),
  phone      text check (length(phone) <= 40),
  created_at timestamptz not null default now(),
  unique (family_id, osm_id)
);
create index if not exists nearby_places_family on nearby_places(family_id, minutes);
alter table nearby_places enable row level security;
drop policy if exists np_select on nearby_places;
create policy np_select on nearby_places for select using (family_id = my_family());
drop policy if exists np_insert on nearby_places;
create policy np_insert on nearby_places for insert with check (family_id = my_family() and i_am_parent());
drop policy if exists np_delete on nearby_places;
create policy np_delete on nearby_places for delete using (family_id = my_family() and i_am_parent());
grant select, insert, delete on nearby_places to authenticated;

revoke execute on function set_home(text, double precision, double precision, int) from anon, public;
grant execute on function set_home(text, double precision, double precision, int) to authenticated;

-- ================================================================ calendar: show the source calendar
-- A parent may read which of their own phone calendars each imported event
-- comes from (for the calendar name and filter in Kalender).
drop policy if exists es_select on event_sources;
create policy es_select on event_sources for select using (user_id = auth.uid());
grant select on event_sources to authenticated;

-- ================================================================ today page (pack list)
-- What has to go with the children on a given day: on fixed weekdays
-- (1 = Monday … 7 = Sunday), on one date, or on the day of a calendar event
-- (a weekly series follows its skipped weeks). Parents only.
create table if not exists pack_items (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default my_family() references families on delete cascade,
  title      text not null check (length(title) between 1 and 120),
  who        text check (who is null or length(who) between 1 and 40),
  days       smallint[] not null default '{}' check (days <@ array[1,2,3,4,5,6,7]::smallint[]),
  on_date    date,
  event_id   uuid references events on delete cascade,
  notes      text check (notes is null or length(notes) <= 300),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint pack_when check ((cardinality(days) > 0)::int + (on_date is not null)::int + (event_id is not null)::int = 1)
);
create index if not exists pack_items_family on pack_items(family_id);
alter table pack_items enable row level security;
drop policy if exists pi_all on pack_items;
create policy pi_all on pack_items for all
  using (family_id = my_family() and i_am_parent())
  with check (family_id = my_family() and i_am_parent());

-- Ticked off as packed (one row per item and day; both parents see it)
create table if not exists pack_done (
  item_id  uuid not null references pack_items on delete cascade,
  on_date  date not null,
  done_by  uuid not null default auth.uid() references auth.users on delete cascade,
  done_at  timestamptz not null default now(),
  primary key (item_id, on_date)
);
alter table pack_done enable row level security;
drop policy if exists pd_select on pack_done;
create policy pd_select on pack_done for select
  using (i_am_parent() and exists (select 1 from pack_items p where p.id = item_id and p.family_id = my_family()));
drop policy if exists pd_insert on pack_done;
create policy pd_insert on pack_done for insert
  with check (done_by = auth.uid() and i_am_parent()
              and exists (select 1 from pack_items p where p.id = item_id and p.family_id = my_family()));
drop policy if exists pd_delete on pack_done;
create policy pd_delete on pack_done for delete
  using (i_am_parent() and exists (select 1 from pack_items p where p.id = item_id and p.family_id = my_family()));
grant select, insert, update, delete on pack_items to authenticated;
grant select, insert, delete on pack_done to authenticated;

-- "Who is this phone calendar about" (e.g. Aula -> Carl). Events from it that
-- nobody has tagged yet get the same names now; new ones at the next sync.
create or replace function set_calendar_people(p_id uuid, p_people text[])
returns void language plpgsql security definer set search_path = public as $$
declare ppl text[]; old text[];
begin
  ppl := array(select distinct left(btrim(x), 40) from unnest(coalesce(p_people, '{}')) x where btrim(x) <> '');
  if cardinality(ppl) > 12 then raise exception 'too many names'; end if;
  select people into old from user_calendars where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'calendar not found'; end if;
  update user_calendars set people = ppl where id = p_id;
  -- events still carrying the calendar's old default (or none) follow; hand-tagged ones keep theirs
  update events ev set people = ppl
   where (ev.people = '{}' or ev.people = old)
     and (ev.id in (select event_id from event_sources where calendar_id = p_id)
          or ev.id in (select event_id from calendar_inbox where calendar_id = p_id and event_id is not null));
end $$;
revoke execute on function set_calendar_people(uuid, text[]) from public, anon;
grant execute on function set_calendar_people(uuid, text[]) to authenticated;

-- ================================================================ family day (Familiedag)
-- A weekly family outing on a day chosen each week. Family members take turns
-- choosing (turn_order holds names, e.g. 'Carl', or '@wife'); the one whose turn
-- it is picks an idea, a day and a time. A week without an actual day (skipped)
-- doesn't use up anyone's turn.
create table if not exists famday (
  family_id  uuid primary key default my_family() references families on delete cascade,
  turn_order text[] not null default '{}' check (cardinality(turn_order) <= 12)
);
alter table famday enable row level security;
drop policy if exists fd_select on famday;
create policy fd_select on famday for select using (family_id = my_family());
drop policy if exists fd_insert on famday;
create policy fd_insert on famday for insert with check (family_id = my_family() and i_am_parent());
drop policy if exists fd_update on famday;
create policy fd_update on famday for update using (family_id = my_family() and i_am_parent())
  with check (family_id = my_family());

create table if not exists famday_ideas (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default my_family() references families on delete cascade,
  emoji      text not null default '✨' check (length(emoji) <= 16),
  title      text not null check (length(title) between 1 and 80),
  weather    text not null default 'any' check (weather in ('out','in','any')),
  long       boolean not null default false,          -- half a day or more
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists famday_ideas_family on famday_ideas(family_id);
alter table famday_ideas enable row level security;
drop policy if exists fi_select on famday_ideas;
create policy fi_select on famday_ideas for select using (family_id = my_family());
drop policy if exists fi_insert on famday_ideas;
create policy fi_insert on famday_ideas for insert with check (family_id = my_family());
drop policy if exists fi_update on famday_ideas;
create policy fi_update on famday_ideas for update
  using (family_id = my_family() and (i_am_parent() or created_by = auth.uid())) with check (family_id = my_family());
drop policy if exists fi_delete on famday_ideas;
create policy fi_delete on famday_ideas for delete
  using (family_id = my_family() and (i_am_parent() or created_by = auth.uid()));

create table if not exists famday_weeks (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null default my_family() references families on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),   -- Monday
  chooser    text not null check (length(chooser) between 1 and 40),
  idea_id    uuid references famday_ideas on delete set null,
  emoji      text check (length(emoji) <= 16),
  title      text check (length(title) between 1 and 120),            -- null = not chosen yet
  on_date    date,
  at_time    text check (at_time is null or at_time ~ '^\d{2}:\d{2}$'),
  note       text check (length(note) <= 300),
  cancelled  boolean not null default false,
  created_by uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  unique (family_id, week_start)
);
alter table famday_weeks enable row level security;
drop policy if exists fw_select on famday_weeks;
create policy fw_select on famday_weeks for select using (family_id = my_family());
drop policy if exists fw_insert on famday_weeks;
create policy fw_insert on famday_weeks for insert with check (family_id = my_family());
drop policy if exists fw_update on famday_weeks;
create policy fw_update on famday_weeks for update using (family_id = my_family()) with check (family_id = my_family());
drop policy if exists fw_delete on famday_weeks;
create policy fw_delete on famday_weeks for delete using (family_id = my_family() and i_am_parent());
grant select, insert, update on famday to authenticated;
grant select, insert, update, delete on famday_ideas, famday_weeks to authenticated;

-- ================================================================ skema
-- Lessons (school timetable) are shown on Kalender → Skema only, not in the day
-- lists. A phone calendar marked Skema (on by default for names like "Skema" or
-- "AULA") makes its lessons: timed, one day, and a weekly series or a short
-- subject code (DAN, MAT, FRA1 …). Kept up to date by triggers, so the sync
-- itself doesn't need to know.
alter table user_calendars add column if not exists schedule boolean not null default false;
alter table events add column if not exists lesson boolean not null default false;

create or replace function is_lesson(p_title text, p_start date, p_end date, p_time text, p_every smallint)
returns boolean language sql immutable set search_path = public as $$
  select p_time is not null and (p_end is null or p_end <= p_start)
     and (p_every is not null or char_length(btrim(p_title)) <= 8)
$$;

-- new calendars named like a timetable start as Skema
create or replace function uc_schedule_default() returns trigger
language plpgsql set search_path = public as $$
begin
  new.schedule := new.schedule or new.name ~* '(skema|aula|timetable|schedule|emploi du temps|stundenplan)';
  return new;
end $$;
drop trigger if exists uc_schedule_default on user_calendars;
create trigger uc_schedule_default before insert on user_calendars for each row execute function uc_schedule_default();

-- an event's lesson flag, from its calendars
create or replace function event_lesson_calc(ev events) returns boolean
language sql stable security definer set search_path = public as $$
  select is_lesson(ev.title, ev.start_date, ev.end_date, ev.start_time, ev.every_weeks)
     and exists (select 1 from event_sources es join user_calendars uc on uc.id = es.calendar_id
                  where es.event_id = ev.id and uc.schedule)
$$;
create or replace function events_lesson() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.imported then new.lesson := event_lesson_calc(new); else new.lesson := false; end if;
  return new;
end $$;
drop trigger if exists events_lesson on events;
create trigger events_lesson before update of title, start_date, end_date, start_time, every_weeks, imported on events
  for each row execute function events_lesson();
-- a new event gets its calendar right after it is inserted
create or replace function event_sources_lesson() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update events ev set lesson = event_lesson_calc(ev) where ev.id = new.event_id;
  return null;
end $$;
drop trigger if exists event_sources_lesson on event_sources;
create trigger event_sources_lesson after insert on event_sources for each row execute function event_sources_lesson();

-- Switch a calendar's Skema flag; its lessons move at once
create or replace function set_calendar_schedule(p_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update user_calendars set schedule = coalesce(p_on, false) where id = p_id and user_id = auth.uid();
  if not found then raise exception 'calendar not found'; end if;
  update events ev set lesson = event_lesson_calc(ev)
   where ev.id in (select event_id from event_sources where calendar_id = p_id);
end $$;
revoke execute on function is_lesson(text, date, date, text, smallint), event_lesson_calc(events),
  uc_schedule_default(), events_lesson(), event_sources_lesson() from public, anon, authenticated;
revoke execute on function set_calendar_schedule(uuid, boolean) from public, anon;
grant execute on function set_calendar_schedule(uuid, boolean) to authenticated;

update events ev set lesson = event_lesson_calc(ev) where ev.imported and ev.lesson <> event_lesson_calc(ev);

-- Skema: subjects the family doesn't want to see (e.g. RESS), matched on the
-- lesson title, case-insensitive. Parents choose them under Setup.
create table if not exists skema_hidden (
  family_id uuid not null default my_family() references families on delete cascade,
  title     text not null check (length(title) between 1 and 120),
  primary key (family_id, title)
);
alter table skema_hidden enable row level security;
drop policy if exists sh_select on skema_hidden;
create policy sh_select on skema_hidden for select using (family_id = my_family());
drop policy if exists sh_insert on skema_hidden;
create policy sh_insert on skema_hidden for insert with check (family_id = my_family() and i_am_parent());
drop policy if exists sh_delete on skema_hidden;
create policy sh_delete on skema_hidden for delete using (family_id = my_family() and i_am_parent());
grant select, insert, delete on skema_hidden to authenticated;

-- Names used for "who is it about" (events, phone calendars, packing list,
-- family-day turns): rename one everywhere, or remove it (p_new null).
create or replace function rename_person(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare fam uuid := my_family(); nw text := nullif(left(btrim(coalesce(p_new, '')), 40), '');
begin
  if not i_am_parent() then raise exception 'parents only'; end if;
  if p_old is null or p_old in ('@wife', '@me', '@family') then raise exception 'cannot change this name'; end if;
  update events set people = array(select distinct x from unnest(array_replace(people, p_old, nw)) x where x is not null)
   where family_id = fam and p_old = any(people);
  update user_calendars set people = array(select distinct x from unnest(array_replace(people, p_old, nw)) x where x is not null)
   where family_id = fam and p_old = any(people);
  update pack_items set who = nw where family_id = fam and who = p_old;
  update famday set turn_order = array(select x from unnest(array_replace(turn_order, p_old, nw)) with ordinality u(x, i)
                                        where x is not null group by x order by min(i))
   where family_id = fam and p_old = any(turn_order);
  update famday_weeks set chooser = nw where family_id = fam and chooser = p_old and nw is not null;
end $$;
revoke execute on function rename_person(text, text) from public, anon;
grant execute on function rename_person(text, text) to authenticated;

-- ================================================================ price watch
-- Anyone in the family registers a product to watch. A daily price check (a
-- scheduled Claude task, writing with the service role) records the offers it
-- finds in price_points and calls price_refresh(), which sets the current best
-- price. The `remind` Edge Function then sends each follower one push a day
-- with the best prices (or only when a price drops / hits the target).
--   visible_to: 'me' (e.g. a secret present), 'parents' or 'family'
--   notify:     'daily', 'drop' (only when cheaper or at the target) or 'off'

create table if not exists price_watches (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null default my_family() references families on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 120),
  details      text check (length(details) <= 500),          -- model, size, colour, EAN …
  ref_url      text check (ref_url is null or ref_url ~ '^https?://'),
  target_price numeric(10,2) check (target_price is null or target_price > 0),
  allow_used   boolean not null default false,
  notify       text not null default 'daily' check (notify in ('daily','drop','off')),
  visible_to   text not null default 'family' check (visible_to in ('me','parents','family')),
  followers    uuid[] not null default '{}',
  active       boolean not null default true,
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  -- written by the price check only
  best_price   numeric(10,2),
  best_shop    text,
  best_url     text,
  best_used    boolean not null default false,
  advice       text,                                          -- short tip: buy now / wait for …
  last_checked timestamptz,
  check_note   text,                                          -- e.g. "not found today"
  source_urls  text[] not null default '{}'                   -- pages the check re-reads every day
);
alter table price_watches add column if not exists source_urls text[] not null default '{}';
create index if not exists price_watches_family on price_watches(family_id);

create table if not exists price_points (
  id         bigserial primary key,
  watch_id   uuid not null references price_watches on delete cascade,
  checked_on date not null default (now() at time zone 'Europe/Copenhagen')::date,
  shop       text not null check (length(shop) between 1 and 80),
  price      numeric(10,2) not null check (price > 0),       -- DKK incl. VAT
  shipping   numeric(10,2) check (shipping is null or shipping >= 0),
  url        text not null check (url ~ '^https://'),
  used       boolean not null default false,
  in_stock   boolean,
  note       text check (length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (watch_id, checked_on, shop, used)
);
create index if not exists price_points_watch on price_points(watch_id, checked_on);

-- Which daily price pushes went out (server only)
create table if not exists price_notified (
  user_id uuid not null references auth.users on delete cascade,
  on_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, on_date)
);

create or replace function price_visible(p_vis text, p_creator uuid) returns boolean
language sql stable set search_path = public as $$
  select p_creator = auth.uid() or p_vis = 'family' or (p_vis = 'parents' and i_am_parent())
$$;

-- The creator follows their own product from the start
create or replace function price_watch_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null and not new.created_by = any(new.followers) then
    new.followers := new.followers || new.created_by;
  end if;
  return new;
end $$;
drop trigger if exists price_watch_defaults on price_watches;
create trigger price_watch_defaults before insert on price_watches
  for each row execute function price_watch_defaults();

alter table price_watches  enable row level security;
alter table price_points   enable row level security;
alter table price_notified enable row level security;   -- server only

drop policy if exists pw_select on price_watches;
create policy pw_select on price_watches for select
  using (family_id = my_family() and price_visible(visible_to, created_by));
drop policy if exists pw_insert on price_watches;
create policy pw_insert on price_watches for insert
  with check (family_id = my_family() and created_by = auth.uid());
drop policy if exists pw_update on price_watches;
create policy pw_update on price_watches for update
  using (family_id = my_family() and price_visible(visible_to, created_by)
         and (created_by = auth.uid() or i_am_parent()))
  with check (family_id = my_family() and (visible_to <> 'me' or created_by = auth.uid()));
drop policy if exists pw_delete on price_watches;
create policy pw_delete on price_watches for delete
  using (family_id = my_family() and price_visible(visible_to, created_by)
         and (created_by = auth.uid() or i_am_parent()));

drop policy if exists pp_select on price_points;
create policy pp_select on price_points for select
  using (exists (select 1 from price_watches w where w.id = watch_id));

-- The app may only write the user's own fields; best_* etc. come from the check
revoke all on price_watches, price_points, price_notified from anon, authenticated;
grant select on price_watches, price_points to authenticated;
grant insert (title, details, ref_url, target_price, allow_used, notify, visible_to) on price_watches to authenticated;
grant update (title, details, ref_url, target_price, allow_used, notify, visible_to, active) on price_watches to authenticated;
grant delete on price_watches to authenticated;

-- Follow / unfollow (daily push) a product I can see
create or replace function price_follow(p_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update price_watches
     set followers = case when p_on then array(select distinct x from unnest(followers || auth.uid()) x)
                          else array_remove(followers, auth.uid()) end
   where id = p_id and family_id = my_family() and price_visible(visible_to, created_by);
  if not found then raise exception 'not found'; end if;
end $$;

-- After the check: best offer of the day (in stock unless unknown; used only if allowed)
create or replace function price_refresh(p_id uuid, p_advice text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w price_watches; b price_points; d date := (now() at time zone 'Europe/Copenhagen')::date;
begin
  select * into w from price_watches where id = p_id;
  if not found then raise exception 'not found'; end if;
  select * into b from price_points
   where watch_id = p_id and checked_on = d and in_stock is distinct from false and (w.allow_used or not used)
   order by price + coalesce(shipping, 0), used, shop limit 1;
  update price_watches set
    best_price = case when b.id is null then best_price else b.price + coalesce(b.shipping, 0) end,
    best_shop  = case when b.id is null then best_shop else b.shop end,
    best_url   = case when b.id is null then best_url else b.url end,
    best_used  = case when b.id is null then best_used else b.used end,
    advice     = coalesce(p_advice, advice),
    check_note = case when b.id is null then coalesce(p_note, 'Ingen tilbud fundet i dag') else p_note end,
    last_checked = now()
   where id = p_id;
end $$;

revoke execute on function price_follow(uuid, boolean), price_visible(text, uuid) from anon, public;
grant execute on function price_follow(uuid, boolean), price_visible(text, uuid) to authenticated;
revoke execute on function price_refresh(uuid, text, text), price_watch_defaults() from anon, authenticated, public;

-- ================================================================ school (direct: Aula + iCal feeds)
-- A parent links Aula (MitID) and/or iCal feeds such as ForældreIntra once
-- (Setup → Skole direkte). A scheduled GitHub Action (school/school_sync.py)
-- does the rest without the phone: Aula's calendar and the feeds go through
-- sync_calendar() like the iPhone Shortcut (calendars "Aula – <child>" etc.,
-- chosen under Calendar from iPhone as usual), Aula messages and posts go to
-- school_messages. The job proves itself with a server key whose hash is in
-- server_keys; the Aula session it keeps is encrypted with that key and is
-- never readable by the app.

create table if not exists server_keys (name text primary key, key_hash text not null);
alter table server_keys enable row level security;   -- server only
revoke all on server_keys from anon, authenticated;

create or replace function server_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_keys where name = 'school'
                  and key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex'))
$$;

create table if not exists school_links (
  user_id        uuid primary key references auth.users on delete cascade,
  family_id      uuid not null references families on delete cascade,
  mitid_username text,
  feeds          jsonb not null default '[]',   -- [{name, url}] iCal feeds, e.g. ForældreIntra
  aula_session   text,                          -- encrypted by the job; the app can't read it
  status         text not null default 'off'
                 check (status in ('off','login_requested','login_running','ok','login_needed','error')),
  login_qr1      text, login_qr2 text,          -- MitID QR codes (SVG) while a login runs
  login_otp      text,                          -- or the code to type in the MitID app
  login_note     text,
  login_updated  timestamptz,
  sync_requested boolean not null default false,
  last_sync_at   timestamptz,
  last_result    text,
  created_at     timestamptz not null default now()
);
alter table school_links enable row level security;
drop policy if exists sl_select on school_links;
create policy sl_select on school_links for select using (user_id = auth.uid());
revoke all on school_links from anon, authenticated;
grant select (user_id, family_id, mitid_username, feeds, status, login_qr1, login_qr2, login_otp, login_note,
              login_updated, sync_requested, last_sync_at, last_result) on school_links to authenticated;

-- Aula messages (one row per thread, latest message) and posts, for the parents
create table if not exists school_messages (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  kind       text not null check (kind in ('message','post')),
  ext_id     text not null,
  title      text not null default '',
  sender     text,
  body       text,
  sent_at    timestamptz,
  important  boolean not null default false,
  unread     boolean not null default false,
  first_seen timestamptz not null default now(),
  unique (user_id, kind, ext_id)
);
create index if not exists school_messages_family on school_messages(family_id, sent_at desc);
alter table school_messages enable row level security;
drop policy if exists sm_select on school_messages;
create policy sm_select on school_messages for select using (family_id = my_family() and i_am_parent());
revoke all on school_messages from anon, authenticated;
grant select on school_messages to authenticated;

-- App: save MitID username and feeds (a new username forgets the old session)
create or replace function school_link_save(p_username text, p_feeds jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u text := nullif(btrim(coalesce(p_username, '')), ''); f jsonb := coalesce(p_feeds, '[]'::jsonb);
begin
  if not i_am_parent() then raise exception 'parents only'; end if;
  if jsonb_typeof(f) <> 'array' or jsonb_array_length(f) > 10 then raise exception 'max 10 feeds'; end if;
  if exists (select 1 from jsonb_array_elements(f) x
              where jsonb_typeof(x) <> 'object'
                 or char_length(btrim(coalesce(x->>'name', ''))) not between 1 and 60
                 or char_length(coalesce(x->>'url', '')) > 1000
                 or coalesce(x->>'url', '') !~* '^(https?|webcal)://\S{4,}$') then
    raise exception 'Hvert kalender-link skal have et navn og en adresse, der starter med https:// eller webcal://';
  end if;
  if u is not null and (char_length(u) > 100 or u ~ '[[:cntrl:][:space:]]') then raise exception 'bad username'; end if;
  insert into school_links(user_id, family_id, mitid_username, feeds, sync_requested)
    values (auth.uid(), my_family(), u, f, true)
  on conflict (user_id) do update
    set family_id = excluded.family_id, feeds = excluded.feeds, sync_requested = true,
        aula_session = case when school_links.mitid_username is distinct from u then null else school_links.aula_session end,
        status = case when u is null then 'off'
                      when school_links.mitid_username is distinct from u then 'off' else school_links.status end,
        mitid_username = u;
end $$;

-- App: start a MitID login (the job picks it up within a few minutes) / sync now / unlink
create or replace function school_link_login()
returns void language plpgsql security definer set search_path = public as $$
begin
  update school_links set status = 'login_requested', login_qr1 = null, login_qr2 = null, login_otp = null,
         login_note = null, login_updated = now()
   where user_id = auth.uid() and mitid_username is not null;
  if not found then raise exception 'Gem dit MitID-brugernavn først'; end if;
end $$;

create or replace function school_link_sync_now()
returns void language sql security definer set search_path = public as $$
  update school_links set sync_requested = true where user_id = auth.uid()
$$;

create or replace function school_link_remove()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from school_messages where user_id = auth.uid();
  delete from school_links where user_id = auth.uid();
end $$;

-- Job: the links, and whether each needs work now (login asked for, sync asked
-- for, or the last sync is over 2 hours old – 4 at night, Danish time)
create or replace function school_jobs(p_key text)
returns table (user_id uuid, mitid_username text, feeds jsonb, aula_session text, status text,
               sync_token text, due boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not server_key_ok(p_key) then raise exception 'bad key'; end if;
  insert into sync_tokens(user_id) select l.user_id from school_links l on conflict do nothing;
  -- a login nobody finished within 15 minutes is given up
  update school_links l set status = 'login_needed', login_qr1 = null, login_qr2 = null, login_otp = null,
         login_note = 'Login udløb – prøv igen'
   where l.status in ('login_requested','login_running') and l.login_updated < now() - interval '15 minutes';
  return query
  select l.user_id, l.mitid_username, l.feeds, l.aula_session, l.status, st.token,
         l.status = 'login_requested' or l.sync_requested or l.last_sync_at is null
         or l.last_sync_at < now() - case when extract(hour from now() at time zone 'Europe/Copenhagen') between 6 and 21
                                          then interval '115 minutes' else interval '235 minutes' end
    from school_links l join sync_tokens st on st.user_id = l.user_id
   where l.mitid_username is not null or jsonb_array_length(l.feeds) > 0;
end $$;

-- Job: report progress. Only the keys present in p are changed; "synced": true stamps last_sync_at.
create or replace function school_job_update(p_key text, p_user uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not server_key_ok(p_key) then raise exception 'bad key'; end if;
  update school_links set
    status        = case when p ? 'status' then p->>'status' else status end,
    aula_session  = case when p ? 'aula_session' then p->>'aula_session' else aula_session end,
    login_qr1     = case when p ? 'login_qr1' then p->>'login_qr1' else login_qr1 end,
    login_qr2     = case when p ? 'login_qr2' then p->>'login_qr2' else login_qr2 end,
    login_otp     = case when p ? 'login_otp' then p->>'login_otp' else login_otp end,
    login_note    = case when p ? 'login_note' then left(p->>'login_note', 300) else login_note end,
    login_updated = case when p ?| array['status','login_qr1','login_otp','login_note'] then now() else login_updated end,
    last_result   = case when p ? 'last_result' then left(p->>'last_result', 500) else last_result end,
    last_sync_at  = case when (p->>'synced')::boolean then now() else last_sync_at end,
    sync_requested = case when (p->>'synced')::boolean then false else sync_requested end
   where user_id = p_user;
end $$;

-- Job: messages and posts seen this time [{kind, ext_id, title, sender, body, sent_at, important, unread}].
-- Older than 60 days are dropped.
create or replace function school_messages_put(p_key text, p_user uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare fam uuid; n int;
begin
  if not server_key_ok(p_key) then raise exception 'bad key'; end if;
  select family_id into fam from school_links where user_id = p_user;
  if fam is null then raise exception 'no link'; end if;
  insert into school_messages(family_id, user_id, kind, ext_id, title, sender, body, sent_at, important, unread)
  select fam, p_user, x->>'kind', left(x->>'ext_id', 100), left(coalesce(x->>'title', ''), 300),
         left(x->>'sender', 200), left(x->>'body', 20000), (x->>'sent_at')::timestamptz,
         coalesce((x->>'important')::boolean, false), coalesce((x->>'unread')::boolean, false)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   where x->>'kind' in ('message','post') and coalesce(x->>'ext_id', '') <> ''
  on conflict (user_id, kind, ext_id) do update
    set family_id = excluded.family_id, title = excluded.title, sender = excluded.sender,
        body = coalesce(excluded.body, school_messages.body), sent_at = excluded.sent_at,
        important = excluded.important, unread = excluded.unread;
  get diagnostics n = row_count;
  delete from school_messages where user_id = p_user and sent_at < now() - interval '60 days';
  return n;
end $$;

revoke execute on function server_key_ok(text), school_link_save(text, jsonb), school_link_login(),
  school_link_sync_now(), school_link_remove(), school_jobs(text), school_job_update(text, uuid, jsonb),
  school_messages_put(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function school_link_save(text, jsonb), school_link_login(), school_link_sync_now(),
  school_link_remove() to authenticated;
-- the job uses the public anon key + the server key
grant execute on function school_jobs(text), school_job_update(text, uuid, jsonb),
  school_messages_put(text, uuid, jsonb) to anon;

-- ================================================================ price watch: notes and "check now"
-- notes: what the family cares about, read by the price check (e.g. "only the
-- lowest price", "only products with good reviews from other buyers").
-- "Check now": the app asks with price_check_now(); an hourly scheduled task
-- (07–22) checks queued products. When price_refresh() runs it clears the
-- request and remembers who asked, so the `remind` function can tell them.

alter table price_watches add column if not exists notes text check (length(notes) <= 1000);
alter table price_watches add column if not exists check_requested_at timestamptz;
alter table price_watches add column if not exists check_requested_by uuid references auth.users on delete set null;
alter table price_watches add column if not exists tell_user uuid references auth.users on delete set null;

grant insert (title, details, ref_url, target_price, allow_used, notify, visible_to, notes) on price_watches to authenticated;
grant update (title, details, ref_url, target_price, allow_used, notify, visible_to, active, notes) on price_watches to authenticated;

-- Queue a check of one product (or, with null, every active product I can see)
create or replace function price_check_now(p_id uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update price_watches set check_requested_at = coalesce(check_requested_at, now()), check_requested_by = auth.uid()
   where family_id = my_family() and price_visible(visible_to, created_by) and active
     and (p_id is null or id = p_id);
  get diagnostics n = row_count;
  if p_id is not null and n = 0 then raise exception 'not found'; end if;
  return n;
end $$;

create or replace function price_refresh(p_id uuid, p_advice text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w price_watches; b price_points; d date := (now() at time zone 'Europe/Copenhagen')::date;
begin
  select * into w from price_watches where id = p_id;
  if not found then raise exception 'not found'; end if;
  select * into b from price_points
   where watch_id = p_id and checked_on = d and in_stock is distinct from false and (w.allow_used or not used)
   order by price + coalesce(shipping, 0), used, shop limit 1;
  update price_watches set
    best_price = case when b.id is null then best_price else b.price + coalesce(b.shipping, 0) end,
    best_shop  = case when b.id is null then best_shop else b.shop end,
    best_url   = case when b.id is null then best_url else b.url end,
    best_used  = case when b.id is null then best_used else b.used end,
    advice     = coalesce(p_advice, advice),
    check_note = case when b.id is null then coalesce(p_note, 'Ingen tilbud fundet i dag') else p_note end,
    last_checked = now(),
    tell_user = case when check_requested_at is not null then check_requested_by else tell_user end,
    check_requested_at = null, check_requested_by = null
   where id = p_id;
end $$;

revoke execute on function price_check_now(uuid) from anon, public;
grant execute on function price_check_now(uuid) to authenticated;
revoke execute on function price_refresh(uuid, text, text) from anon, authenticated, public;

-- The price-check GitHub Action (.github/workflows/price-check.yml) asks every
-- 5 minutes what to check and saves what it found, with the server key
-- (HL_SCHOOL_KEY, see server_keys). Due: products queued with "check now",
-- and once a day from 02:30 (so its 5-hour usage window ends before morning) every active product not checked yet today
-- (a product added today waits for its "check now" or tomorrow). At most 10 per run.
create or replace function price_jobs(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Copenhagen')::date;
        tm time := (now() at time zone 'Europe/Copenhagen')::time;
        ws jsonb;
begin
  if not server_key_ok(p_key) then raise exception 'bad key'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) - 'sort1' - 'sort2' order by x.sort1 desc, x.sort2), '[]') into ws from (
    select w.id, w.title, w.details, w.notes, w.ref_url, w.target_price, w.allow_used, w.source_urls,
           w.best_price, w.best_shop, w.check_requested_at is not null as queued,
           (select coalesce(jsonb_agg(jsonb_build_object('day', p.checked_on, 'shop', p.shop,
                     'total', p.price + coalesce(p.shipping, 0), 'used', p.used) order by p.checked_on), '[]')
              from price_points p where p.watch_id = w.id and p.checked_on >= d - 60) as history,
           w.check_requested_at is not null as sort1, w.last_checked as sort2
      from price_watches w
     where w.active and (w.check_requested_at is not null
        or (tm >= '02:30' and coalesce((w.last_checked at time zone 'Europe/Copenhagen')::date,
                                       (w.created_at at time zone 'Europe/Copenhagen')::date) < d))
     order by w.check_requested_at is not null desc, w.last_checked nulls first
     limit 10
  ) x;
  return jsonb_build_object('due', jsonb_array_length(ws) > 0, 'watches', ws);
end $$;

-- Save one product's offers (checked here, not trusted from the web), then refresh it
create or replace function price_save(p_key text, p_id uuid, p_offers jsonb, p_sources jsonb default '[]',
                                      p_advice text default null, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare o jsonb; n int := 0; srcs text[];
begin
  if not server_key_ok(p_key) then raise exception 'bad key'; end if;
  if not exists (select 1 from price_watches where id = p_id) then raise exception 'not found'; end if;
  for o in select * from jsonb_array_elements(case when jsonb_typeof(p_offers) = 'array' then p_offers else '[]' end) limit 8 loop
    continue when jsonb_typeof(o) <> 'object'
      or length(btrim(coalesce(o->>'shop', ''))) not between 1 and 80
      or coalesce(o->>'price', '') !~ '^\d{1,7}(\.\d{1,2})?$' or (o->>'price')::numeric <= 0
      or (o->>'shipping' is not null and o->>'shipping' !~ '^\d{1,6}(\.\d{1,2})?$')
      or coalesce(o->>'url', '') !~ '^https://[^\s<>"]{4,}$' or length(o->>'url') > 1000;
    insert into price_points (watch_id, shop, price, shipping, url, used, in_stock, note)
    values (p_id, btrim(o->>'shop'), (o->>'price')::numeric, (o->>'shipping')::numeric, o->>'url',
            coalesce(o->>'used', 'false') = 'true',
            case o->>'in_stock' when 'true' then true when 'false' then false end,
            nullif(left(btrim(coalesce(o->>'note', '')), 200), ''))
    on conflict (watch_id, checked_on, shop, used) do update
      set price = excluded.price, shipping = excluded.shipping, url = excluded.url,
          in_stock = excluded.in_stock, note = excluded.note;
    n := n + 1;
  end loop;
  select coalesce(array_agg(u), '{}') into srcs from (
    select x as u from jsonb_array_elements_text(case when jsonb_typeof(p_sources) = 'array' then p_sources else '[]' end) x
     where x ~ '^https://[^\s<>"]{4,}$' and length(x) <= 1000 limit 4) s;
  if cardinality(srcs) > 0 then update price_watches set source_urls = srcs where id = p_id; end if;
  perform price_refresh(p_id, nullif(left(btrim(coalesce(p_advice, '')), 200), ''),
                        nullif(left(btrim(coalesce(p_note, '')), 200), ''));
  return n;
end $$;

revoke execute on function price_jobs(text), price_save(text, uuid, jsonb, jsonb, text, text) from public, authenticated;
grant execute on function price_jobs(text), price_save(text, uuid, jsonb, jsonb, text, text) to anon;

-- MitID login from the parent's own phone (school/aulalogin.py in a-Shell): STIL's
-- bot protection blocks logins from servers. The phone sends the new Aula session
-- with the parent's sync code; the job encrypts it into aula_session on its next
-- run and clears session_import (the app can't read either).
alter table school_links add column if not exists session_import jsonb;

create or replace function school_session_import(p_token text, p_username text, p_session jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me members; u text := nullif(btrim(coalesce(p_username, '')), '');
begin
  select m.* into me from sync_tokens st join members m on m.user_id = st.user_id
   where st.token = trim(coalesce(p_token, ''));
  if me.user_id is null then
    raise exception 'Ukendt synkroniseringskode. Kopiér linjen igen i Happy Life (Opsætning → Skole direkte).';
  end if;
  if not (me.roles && array['mother','father']) then raise exception 'Kun mor og far kan forbinde Aula.'; end if;
  if u is null or char_length(u) > 100 or coalesce(jsonb_typeof(p_session), '') <> 'object'
     or coalesce(jsonb_typeof(p_session->'tokens'), '') <> 'object' or octet_length(p_session::text) > 100000 then
    raise exception 'Ugyldigt login';
  end if;
  insert into school_links(user_id, family_id, mitid_username, session_import, status, login_note, login_updated, sync_requested)
    values (me.user_id, me.family_id, u, p_session, 'ok', 'Logget ind fra telefonen ✓', now(), true)
  on conflict (user_id) do update
    set mitid_username = u, session_import = excluded.session_import, aula_session = null, status = 'ok',
        login_qr1 = null, login_qr2 = null, login_otp = null,
        login_note = excluded.login_note, login_updated = now(), sync_requested = true;
end $$;
revoke execute on function school_session_import(text, text, jsonb) from public, anon, authenticated;
grant execute on function school_session_import(text, text, jsonb) to anon, authenticated;

-- school_jobs also hands over a fresh session from the phone
drop function if exists school_jobs(text);
create or replace function school_jobs(p_key text)
returns table (user_id uuid, mitid_username text, feeds jsonb, aula_session text, session_import jsonb,
               status text, sync_token text, due boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not server_key_ok(p_key) then raise exception 'bad key'; end if;
  insert into sync_tokens(user_id) select l.user_id from school_links l on conflict do nothing;
  update school_links l set status = 'login_needed', login_qr1 = null, login_qr2 = null, login_otp = null,
         login_note = 'Login udløb – prøv igen'
   where l.status in ('login_requested','login_running') and l.login_updated < now() - interval '15 minutes';
  return query
  select l.user_id, l.mitid_username, l.feeds, l.aula_session, l.session_import, l.status, st.token,
         l.session_import is not null or l.sync_requested or l.last_sync_at is null
         or l.last_sync_at < now() - case when extract(hour from now() at time zone 'Europe/Copenhagen') between 6 and 21
                                          then interval '115 minutes' else interval '235 minutes' end
    from school_links l join sync_tokens st on st.user_id = l.user_id
   where l.mitid_username is not null or jsonb_array_length(l.feeds) > 0;
end $$;
revoke execute on function school_jobs(text) from public, anon, authenticated;
grant execute on function school_jobs(text) to anon;

create or replace function school_job_update(p_key text, p_user uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not server_key_ok(p_key) then raise exception 'bad key'; end if;
  update school_links set
    status        = case when p ? 'status' then p->>'status' else status end,
    aula_session  = case when p ? 'aula_session' then p->>'aula_session' else aula_session end,
    session_import = case when p ? 'aula_session' then null else session_import end,
    login_qr1     = case when p ? 'login_qr1' then p->>'login_qr1' else login_qr1 end,
    login_qr2     = case when p ? 'login_qr2' then p->>'login_qr2' else login_qr2 end,
    login_otp     = case when p ? 'login_otp' then p->>'login_otp' else login_otp end,
    login_note    = case when p ? 'login_note' then left(p->>'login_note', 300) else login_note end,
    login_updated = case when p ?| array['status','login_qr1','login_otp','login_note'] then now() else login_updated end,
    last_result   = case when p ? 'last_result' then left(p->>'last_result', 500) else last_result end,
    last_sync_at  = case when (p->>'synced')::boolean then now() else last_sync_at end,
    sync_requested = case when (p->>'synced')::boolean then false else sync_requested end
   where user_id = p_user;
end $$;

-- Read / unread per Happy Life user (not Aula's own flag): a row = this person has read it
create table if not exists school_reads (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  message_id uuid not null references school_messages on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table school_reads enable row level security;
drop policy if exists sr_own on school_reads;
create policy sr_own on school_reads for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and i_am_parent()
              and exists (select 1 from school_messages m where m.id = message_id and m.family_id = my_family()));
revoke all on school_reads from anon, authenticated;
grant select, insert, delete on school_reads to authenticated;

create or replace function school_mark_all_read()
returns void language sql security definer set search_path = public as $$
  insert into school_reads(user_id, message_id)
  select auth.uid(), m.id from school_messages m
   where m.family_id = my_family() and i_am_parent()
  on conflict do nothing
$$;
revoke execute on function school_mark_all_read() from public, anon;
grant execute on function school_mark_all_read() to authenticated;

-- MinUddannelse via Aula: ugenoter (weekly notes per class) and opgaver (homework/tasks),
-- this week and next, replaced on every sync. Shown to the parents on I dag (📚 Skole).
create table if not exists school_items (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  kind       text not null check (kind in ('ugenote','opgave')),
  ext_id     text not null,
  week       text not null,               -- e.g. 2026-W46
  child      text,                        -- first name
  grp        text,                        -- class / team, e.g. "4.B"
  subject    text,
  title      text not null default '',
  body       text,
  due_date   date,
  done       boolean not null default false,
  url        text,
  updated_at timestamptz not null default now(),
  unique (user_id, kind, ext_id, week)
);
create index if not exists school_items_family on school_items(family_id, week);
alter table school_items enable row level security;
drop policy if exists si_select on school_items;
create policy si_select on school_items for select using (family_id = my_family() and i_am_parent());
revoke all on school_items from anon, authenticated;
grant select on school_items to authenticated;

create or replace function school_items_put(p_key text, p_user uuid, p_weeks text[], p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare fam uuid; n int;
begin
  if not server_key_ok(p_key) then raise exception 'bad key'; end if;
  select family_id into fam from school_links where user_id = p_user;
  if fam is null then raise exception 'no link'; end if;
  delete from school_items where user_id = p_user and week = any(p_weeks);
  insert into school_items(family_id, user_id, kind, ext_id, week, child, grp, subject, title, body, due_date, done, url)
  select fam, p_user, x->>'kind', left(x->>'ext_id', 100), left(x->>'week', 10), left(x->>'child', 60),
         left(x->>'grp', 100), left(x->>'subject', 100), left(coalesce(x->>'title', ''), 300),
         left(x->>'body', 30000), (x->>'due_date')::date, coalesce((x->>'done')::boolean, false),
         case when x->>'url' ~* '^https://' then left(x->>'url', 1000) end
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   where x->>'kind' in ('ugenote','opgave') and coalesce(x->>'ext_id', '') <> '' and x->>'week' = any(p_weeks)
  on conflict (user_id, kind, ext_id, week) do nothing;
  get diagnostics n = row_count;
  delete from school_items where user_id = p_user and updated_at < now() - interval '21 days';
  return n;
end $$;
revoke execute on function school_items_put(text, uuid, text[], jsonb) from public, anon, authenticated;
grant execute on function school_items_put(text, uuid, text[], jsonb) to anon;

create or replace function school_link_remove()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from school_items where user_id = auth.uid();
  delete from school_messages where user_id = auth.uid();
  delete from school_links where user_id = auth.uid();
end $$;
