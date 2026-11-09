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

alter table events add column if not exists ext_key text;          -- set for imported events
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
  new.due_date := null;
  return new;
end $$;
drop trigger if exists task_event_copy on tasks;
create trigger task_event_copy before insert or update on tasks
  for each row execute function task_event_copy();

create or replace function event_to_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update tasks set start_date = new.start_date, event_yearly = new.yearly where event_id = new.id;
  return new;
end $$;
drop trigger if exists event_to_tasks on events;
create trigger event_to_tasks after update of start_date, yearly on events
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
returns text language plpgsql security definer set search_path = public as $$
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
  n int; i int; cal user_calendars; t text; d1 date; d2 date; yearly boolean;
  inc_names text[]; ev_id uuid; seen_cals uuid[] := '{}'; saved uuid[] := '{}'; n_saved int := 0; n_new_cals int := 0; n_cals int; msg text;
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
  for i in 1 .. n loop
    if s[i] !~ iso_re or e[i] !~ iso_re or lower(a[i]) !~ flag_re then
      raise exception 'Afvist: begivenhed % har ikke en gyldig start, slut og Ja/Nej. Intet blev gemt.', i;
    end if;
    if length(c[i]) not between 1 and 100 or c[i] ~ '[[:cntrl:]]' then
      raise exception 'Afvist: begivenhed % har et ugyldigt kalendernavn. Intet blev gemt.', i;
    end if;
  end loop;
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

  -- Events from switched-on calendars (skip the rest without touching the table)
  select coalesce(array_agg(name), '{}') into inc_names
    from user_calendars where user_id = me.user_id and included and name = any(c);
  for i in 1 .. n loop
    continue when not (c[i] = any(inc_names));
    select * into cal from user_calendars where user_id = me.user_id and name = c[i];
    t := left(btrim(regexp_replace(ti[i], '[[:cntrl:]]', ' ', 'g')), 200);
    continue when t = '';
    d1 := substr(s[i], 1, 10)::date;
    d2 := substr(e[i], 1, 10)::date;
    if lower(a[i]) in ('yes','true','1','ja','oui') and substr(e[i], 12, 5) = '00:00' and d2 > d1 then
      d2 := d2 - 1;  -- all-day events end at midnight the next day
    end if;
    if d2 <= d1 then d2 := null; end if;
    yearly := cal.yearly;
    insert into events(family_id, type, title, start_date, end_date, yearly, remind_days, roles,
                       created_by, ext_key, imported)
      values (me.family_id, cal_guess_type(t, cal.name), t, d1, case when yearly then null else d2 end,
              yearly, 7, '{mother,father}', me.user_id, cal_ext_key(t, d1, yearly), true)
      on conflict (family_id, ext_key) do update
        set end_date = case when events.yearly then null else excluded.end_date end
      returning id into ev_id;
    insert into event_sources(event_id, user_id, calendar_id) values (ev_id, me.user_id, cal.id)
      on conflict (event_id, user_id, calendar_id) do update set last_seen = now();
    if not ev_id = any(saved) then saved := saved || ev_id; end if;
  end loop;
  n_saved := coalesce(array_length(saved, 1), 0);

  -- Events no longer in a calendar that sent something this time
  delete from event_sources es
   where es.user_id = me.user_id and es.calendar_id = any(seen_cals)
     and es.last_seen < now()   -- now() = start of this run; rows seen in this run equal it
     and not exists (select 1 from events ev where ev.id = es.event_id and ev.start_date < current_date and not ev.yearly);
  perform remove_orphan_events(me.family_id);

  msg := format('Happy Life: %s begivenheder fra %s af %s kalendere.', n_saved,
                (select count(*) from user_calendars where id = any(seen_cals) and included), n_cals);
  if n_new_cals > 0 then
    msg := msg || format(' %s nye kalendere – slå dem til i appen under Familie, hvis de skal med.', n_new_cals);
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

-- Switch a phone calendar on/off or change "every year". Switching off
-- removes its events (and their tasks) at once; switching on takes effect
-- at the next sync.
create or replace function set_calendar(p_id uuid, p_included boolean, p_yearly boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cal user_calendars;
begin
  select * into cal from user_calendars where id = p_id and user_id = auth.uid();
  if not found then raise exception 'calendar not found'; end if;
  update user_calendars set included = p_included, yearly = p_yearly where id = p_id;
  if not p_included then
    delete from event_sources where calendar_id = p_id;
  elsif p_yearly is distinct from cal.yearly then
    update events ev set yearly = p_yearly, end_date = null,
                         ext_key = cal_ext_key(ev.title, ev.start_date, p_yearly)
     where ev.id in (select event_id from event_sources where calendar_id = p_id)
       and not exists (select 1 from events o where o.family_id = ev.family_id and o.id <> ev.id
                       and o.ext_key = cal_ext_key(ev.title, ev.start_date, p_yearly));
  end if;
  perform remove_orphan_events(cal.family_id);
end $$;

revoke execute on function sync_calendar(text,text,text,text,text,text), my_sync_token(boolean),
  set_calendar(uuid,boolean,boolean), task_event_copy(), event_to_tasks(), remove_orphan_events(uuid),
  cal_ext_key(text,date,boolean), cal_guess_type(text,text) from public, anon, authenticated;
grant execute on function sync_calendar(text,text,text,text,text,text) to anon, authenticated;
grant execute on function my_sync_token(boolean), set_calendar(uuid,boolean,boolean) to authenticated;

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
