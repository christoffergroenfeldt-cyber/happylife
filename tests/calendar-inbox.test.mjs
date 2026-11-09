// Database tests for Find events (pick-mode calendars) against schema.sql in PGlite.
// Run: npm i --no-save @electric-sql/pglite && node --test tests/calendar-inbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
`);
await db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
await db.exec(`grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;`);

const DAD = '00000000-0000-0000-0000-00000000000d', MOM = '00000000-0000-0000-0000-00000000000a', KID = '00000000-0000-0000-0000-00000000000c';
for (const u of [DAD, MOM, KID]) await db.query('insert into auth.users values ($1)', [u]);

// run as a signed-in user (RLS applies)
async function as(user, sql, params = []) {
  await db.exec(`set test.uid = '${user}'`);
  await db.exec('set role authenticated');
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const one = async (u, sql, p) => (await as(u, sql, p))[0];
const q = async (sql, p = []) => (await db.query(sql, p)).rows;   // superuser view

const fam = await one(DAD, `select * from create_family('Grønfeldt', 'Christoffer', '{father,husband}')`);
await as(MOM, `select join_family($1, 'Mor', '{mother,wife}')`, [fam.invite_code]);
await as(KID, `select join_family($1, 'Carl', '{child}')`, [fam.invite_code]);
const token = (await one(DAD, 'select token from my_sync_token()')).token;

// What the iPhone Shortcut sends: [title, start, end, allDay, calendar]
async function sync(events) {
  const col = (i) => events.map((e) => e[i]).join('\n');
  return (await one(DAD, 'select sync_calendar($1,$2,$3,$4,$5,$6) as m',
    [token, col(0), col(1), col(2), col(3), col(4)])).m;
}
const lessons = ['2026-11-10', '2026-11-17', '2026-11-24', '2026-12-08', '2026-12-15']
  .map((d) => ['Matematik', `${d}T08:15:00+01:00`, `${d}T09:00:00+01:00`, 'No', 'Skema']);
const base = [
  ['Mormor', '2026-12-03T00:00:00+01:00', '2026-12-04T00:00:00+01:00', 'Yes', 'Fødselsdage'],
  ['Forældremøde 3.A', '2026-11-20T19:00:00+01:00', '2026-11-20T20:30:00+01:00', 'No', 'Aula'],
  ['Udflugt til Zoo', '2026-11-25T00:00:00+01:00', '2026-11-26T00:00:00+01:00', 'Yes', 'Aula'],
  ['Juleferie', '2026-12-21T00:00:00+01:00', '2027-01-04T00:00:00+01:00', 'Yes', 'ForældreIntra'],
  ...lessons,
];
const cal = async (name) => (await q('select id from user_calendars where name = $1', [name]))[0].id;
const inbox = (title) => q('select * from calendar_inbox where title = $1', [title]).then((r) => r[0]);

test('new school calendars start off; nothing in the inbox', async () => {
  const m = await sync(base);
  assert.match(m, /3 nye kalendere/);
  assert.equal((await q('select count(*)::int n from calendar_inbox'))[0].n, 0);
  assert.deepEqual((await q('select title from events')).map((r) => r.title), ['Mormor']);
});

test('pick mode: events wait in the inbox, not in the calendar; lessons become one series with a time', async () => {
  for (const n of ['Aula', 'Skema', 'ForældreIntra']) await as(DAD, `select set_calendar_mode($1, 'pick')`, [await cal(n)]);
  const m = await sync(base);
  assert.match(m, /4 nye under Kalender → Find begivenheder/);
  const rows = await as(DAD, 'select title, start_date::text, end_date::text, start_time, every_weeks, status from calendar_inbox order by start_date');
  assert.deepEqual(rows.map((r) => r.title), ['Matematik', 'Forældremøde 3.A', 'Udflugt til Zoo', 'Juleferie']);
  const mat = rows[0];
  assert.equal(mat.every_weeks, 1); assert.equal(mat.start_time, '08:15');
  assert.equal(rows[1].start_time, '19:00');
  assert.equal(rows[2].start_time, null); assert.equal(rows[2].end_date, null);   // one-day all-day event
  assert.equal(rows[3].end_date, '2027-01-03');
  assert.deepEqual((await q('select title from events')).map((r) => r.title), ['Mormor']);
  // a second sync adds nothing new
  assert.doesNotMatch(await sync(base), /nye under/);
});

test('only the owner sees the inbox; a child cannot follow', async () => {
  assert.equal((await as(MOM, 'select count(*)::int n from calendar_inbox'))[0].n, 0);
  const id = (await inbox('Forældremøde 3.A')).id;
  await assert.rejects(as(KID, `select inbox_set($1, 'followed')`, [id]), /event not found|parents only/);
  await assert.rejects(as(MOM, `select inbox_set($1, 'followed')`, [id]), /event not found/);
  await as(DAD, `update calendar_inbox set status = 'hidden'`).catch(() => {});   // no write policy: nothing changes
  assert.equal((await q(`select count(*)::int n from calendar_inbox where status = 'hidden'`))[0].n, 0);
});

test('follow → event in the calendar, tasks attach; hide → stays hidden after sync', async () => {
  const ev = (await one(DAD, `select inbox_set($1, 'followed') as id`, [(await inbox('Forældremøde 3.A')).id])).id;
  const e = (await q('select * from events where id = $1', [ev]))[0];
  assert.equal(e.title, 'Forældremøde 3.A'); assert.equal(e.imported, true);
  await as(DAD, `insert into tasks(title, assignees, event_id, days_before) values ('Husk madpakke', $1, $2, 1)`, [[KID], ev]);
  await as(DAD, `select inbox_set($1, 'hidden')`, [(await inbox('Udflugt til Zoo')).id]);
  await sync(base);
  assert.equal((await inbox('Udflugt til Zoo')).status, 'hidden');
  assert.equal((await inbox('Forældremøde 3.A')).status, 'followed');
  // the child sees the task, not the parents-only event
  assert.equal((await as(KID, 'select count(*)::int n from tasks where event_id is not null'))[0].n, 1);
  assert.equal((await as(KID, 'select count(*)::int n from events'))[0].n, 0);
});

test('followed event moved to another date: event and its task move along', async () => {
  const moved = base.map((e) => e[0] === 'Forældremøde 3.A'
    ? [e[0], '2026-11-27T19:00:00+01:00', '2026-11-27T20:30:00+01:00', 'No', 'Aula'] : e);
  await sync(moved);
  const it = await inbox('Forældremøde 3.A');
  assert.equal(it.status, 'followed'); assert.equal(it.start_date.toISOString().slice(0, 10), '2026-11-27');
  const tk = (await q(`select start_date::text from tasks where title = 'Husk madpakke'`))[0];
  assert.equal(tk.start_date, '2026-11-27');
  // renamed on the same date: still followed
  const renamed = moved.map((e) => e[0] === 'Forældremøde 3.A' ? ['Forældremøde 3.A (flyttet til aula)', ...e.slice(1)] : e);
  await sync(renamed);
  assert.equal((await inbox('Forældremøde 3.A (flyttet til aula)')).status, 'followed');
  assert.equal((await q(`select title from events where id = (select event_id from tasks where title = 'Husk madpakke')`))[0].title,
    'Forældremøde 3.A (flyttet til aula)');
  base.splice(0, base.length, ...renamed);
});

test('followed event cancelled: event and task removed', async () => {
  await sync(base.filter((e) => !e[0].startsWith('Forældremøde')));
  assert.equal((await q(`select count(*)::int n from tasks where title = 'Husk madpakke'`))[0].n, 0);
  assert.equal((await q(`select count(*)::int n from events where title like 'Forældremøde%'`))[0].n, 0);
});

test('follow a lesson series, then unfollow', async () => {
  const id = (await inbox('Matematik')).id;
  const ev = (await one(DAD, `select inbox_set($1, 'followed') as id`, [id])).id;
  assert.equal((await q('select every_weeks from events where id = $1', [ev]))[0].every_weeks, 1);
  await sync(base);
  assert.ok((await q('select 1 from events where id = $1', [ev])).length);
  await as(DAD, `select inbox_set($1, 'new')`, [id]);
  assert.equal((await q('select count(*)::int n from events where id = $1', [ev]))[0].n, 0);
  assert.equal((await inbox('Matematik')).status, 'new');
});

test('switching a calendar from on to pick keeps events that have tasks', async () => {
  const fi = await cal('ForældreIntra');
  await as(DAD, `select set_calendar_mode($1, 'on')`, [fi]);
  assert.equal((await q('select count(*)::int n from calendar_inbox where calendar_id = $1', [fi]))[0].n, 0);
  await sync(base);
  const ev = (await q(`select id from events where title = 'Juleferie'`))[0].id;
  await as(DAD, `insert into tasks(title, roles, event_id) values ('Pak kufferten', '{mother,father}', $1)`, [ev]);
  await as(DAD, `select set_calendar_mode($1, 'pick')`, [fi]);
  assert.equal((await inbox('Juleferie')).status, 'followed');
  await sync(base);
  assert.equal((await q(`select count(*)::int n from tasks where title = 'Pak kufferten'`))[0].n, 1);
  await as(DAD, `select set_calendar_mode($1, 'off')`, [fi]);
  assert.equal((await q(`select count(*)::int n from events where title = 'Juleferie'`))[0].n, 0);
});

test('old app call set_calendar still works', async () => {
  await as(DAD, `select set_calendar($1, true, true)`, [await cal('Fødselsdage')]);
  assert.equal((await q(`select included, pick, yearly from user_calendars where name = 'Fødselsdage'`))[0].included, true);
});
