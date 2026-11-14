// Database tests for School direct (Aula + iCal via the GitHub Action) against schema.sql in PGlite.
// Run: npm i --no-save @electric-sql/pglite && node --test tests/school.test.mjs
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
await db.exec(`grant usage on schema public to authenticated, anon;`);

const DAD = '00000000-0000-0000-0000-00000000000d', MOM = '00000000-0000-0000-0000-00000000000a', KID = '00000000-0000-0000-0000-00000000000c';
for (const u of [DAD, MOM, KID]) await db.query('insert into auth.users values ($1)', [u]);
const KEY = 'test-server-key';
await db.query(`insert into server_keys values ('school', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [KEY]);

async function as(user, sql, params = []) {
  await db.exec(user ? `set test.uid = '${user}'` : `set test.uid = ''`);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const one = async (u, sql, p) => (await as(u, sql, p))[0];
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const job = (sql, p) => as(null, sql, p);   // the GitHub Action: anon key + server key

const fam = await one(DAD, `select * from create_family('Grønfeldt', 'Christoffer', '{father,husband}')`);
await as(MOM, `select join_family($1, 'Mor', '{mother,wife}')`, [fam.invite_code]);
await as(KID, `select join_family($1, 'Carl', '{child}')`, [fam.invite_code]);

test('only parents link; bad feeds are refused', async () => {
  await assert.rejects(as(KID, `select school_link_save('x', '[]')`), /parents only/);
  await assert.rejects(as(DAD, `select school_link_save('dad', '[{"name":"FI","url":"ftp://x"}]')`), /https/);
  await as(DAD, `select school_link_save('dad', '[{"name":"ForældreIntra (direkte)","url":"webcal://fi.dk/k.ics"}]')`);
  const l = await one(DAD, 'select mitid_username, status, sync_requested, feeds from school_links');
  assert.equal(l.mitid_username, 'dad'); assert.equal(l.status, 'off'); assert.equal(l.sync_requested, true);
  assert.equal(l.feeds.length, 1);
});

test('the app never reads the Aula session; others see nothing', async () => {
  await q(`update school_links set aula_session = 'secret'`);
  await assert.rejects(as(DAD, 'select aula_session from school_links'), /permission denied/);
  assert.equal((await as(MOM, 'select user_id from school_links')).length, 0);
  await assert.rejects(job('select * from school_links'), /permission denied/);
});

test('the job needs the server key and sees what is due', async () => {
  await assert.rejects(job(`select * from school_jobs('wrong')`), /bad key/);
  const rows = await job('select * from school_jobs($1)', [KEY]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].due, true);
  assert.equal(rows[0].aula_session, 'secret');
  assert.ok(rows[0].sync_token, 'a sync token is made for the parent');
  await job(`select school_job_update($1, $2, '{"synced": true, "last_result": "ok"}')`, [KEY, DAD]);
  assert.equal((await job('select * from school_jobs($1)', [KEY]))[0].due, false);
});

test('login: requested → running with QR → ok; a stale login is given up', async () => {
  await as(DAD, 'select school_link_login()');
  await job(`select school_job_update($1, $2, '{"status":"login_running","login_qr1":"<svg/>","login_otp":null}')`, [KEY, DAD]);
  const l = await one(DAD, 'select status, login_qr1 from school_links');
  assert.equal(l.status, 'login_running'); assert.equal(l.login_qr1, '<svg/>');
  await q(`update school_links set login_updated = now() - interval '20 minutes'`);
  await job('select * from school_jobs($1)', [KEY]);
  assert.equal((await one(DAD, 'select status from school_links')).status, 'login_needed');
  // a new username forgets the session
  await as(DAD, `select school_link_save('dad2', '[]')`);
  assert.equal((await q('select aula_session, status from school_links'))[0].aula_session, null);
});

test('messages: parents of the family read them, children do not', async () => {
  const items = [
    { kind: 'message', ext_id: 't1', title: 'Forældremøde', sender: 'Lærer', body: 'Husk mødet', sent_at: new Date().toISOString(), unread: true },
    { kind: 'post', ext_id: 'p1', title: 'Juleklip', body: 'Tag saks med', sent_at: new Date().toISOString(), important: true },
    { kind: 'post', ext_id: 'old', title: 'Gammel', sent_at: '2020-01-01T00:00:00Z' },
  ];
  await job('select school_messages_put($1, $2, $3)', [KEY, DAD, JSON.stringify(items)]);
  assert.equal((await as(MOM, 'select * from school_messages')).length, 2, 'old ones are dropped');
  assert.equal((await as(KID, 'select * from school_messages')).length, 0);
  // seen again (now read): updated, not duplicated
  await job('select school_messages_put($1, $2, $3)', [KEY, DAD, JSON.stringify([{ ...items[0], unread: false, body: null }])]);
  const m = await one(DAD, `select unread, body from school_messages where ext_id = 't1'`);
  assert.equal(m.unread, false); assert.equal(m.body, 'Husk mødet');
  await assert.rejects(as(DAD, `insert into school_messages(family_id, user_id, kind, ext_id) values ($1, $2, 'post', 'x')`, [fam.id, DAD]), /permission denied/);
});

test('read / unread is per app user', async () => {
  const [m] = await as(DAD, `select id from school_messages where ext_id = 't1'`);
  await as(DAD, `insert into school_reads(message_id) values ($1)`, [m.id]);
  assert.equal((await as(DAD, 'select * from school_reads')).length, 1);
  assert.equal((await as(MOM, 'select * from school_reads')).length, 0, 'mom still has it unread');
  await assert.rejects(as(KID, `insert into school_reads(message_id) values ($1)`, [m.id]), /row-level security/);
  await as(MOM, 'select school_mark_all_read()');
  assert.equal((await as(MOM, 'select * from school_reads')).length, 2);
  await as(DAD, `delete from school_reads where message_id = $1`, [m.id]);
  assert.equal((await as(DAD, 'select * from school_reads')).length, 0);
});

test('ugenoter and opgaver: replaced per week, parents only', async () => {
  const items = [
    { kind: 'ugenote', ext_id: '1-7-2026-W46', week: '2026-W46', child: 'Victor', grp: '4.B', title: 'Ugenote 4.B', body: 'Husk idrætstøj' },
    { kind: 'opgave', ext_id: 'a1', week: '2026-W46', child: 'Victor', subject: 'Dansk', title: 'Læs kap. 3', due_date: '2026-11-17', url: 'https://www.minuddannelse.net/x' },
    { kind: 'opgave', ext_id: 'bad', week: '2025-W01', title: 'wrong week' },
  ];
  assert.equal((await job('select school_items_put($1, $2, $3, $4) n', [KEY, DAD, ['2026-W46', '2026-W47'], JSON.stringify(items)]))[0].n, 2);
  assert.equal((await as(MOM, 'select * from school_items')).length, 2);
  assert.equal((await as(KID, 'select * from school_items')).length, 0);
  await job('select school_items_put($1, $2, $3, $4)', [KEY, DAD, ['2026-W46'], JSON.stringify(items.slice(1, 2))]);
  assert.deepEqual((await as(DAD, 'select kind from school_items')).map((r) => r.kind), ['opgave']);
});

test('lektieliste: Claude\'s list replaces the old one, check marks survive', async () => {
  const a = { child: 'Victor', due_date: '2026-11-18', kind: 'lektie', text: 'Læs kapitel 15 og 16', subject: 'Dansk' };
  const b = { child: 'Elizabeth', due_date: '2026-11-18', kind: 'husk', text: 'Idrætstøj og håndklæde' };
  await job('select school_homework_put($1, $2, $3, $4)', [KEY, DAD, 'h1', JSON.stringify([a, b, { kind: 'x', text: 'nope' }])]);
  assert.equal((await job('select school_homework_hash($1, $2) h', [KEY, DAD]))[0].h, 'h1');
  const rows = await as(MOM, 'select * from school_homework order by kind');
  assert.equal(rows.length, 2);
  assert.equal((await as(KID, 'select * from school_homework')).length, 0);
  await as(MOM, 'select school_homework_done($1, true)', [rows[0].id]);   // husk checked off by mom
  // next run: same lektie reworded spacing, husk gone from Claude's list -> kept because done
  await job('select school_homework_put($1, $2, $3, $4)', [KEY, DAD, 'h2', JSON.stringify([{ ...a, text: 'Læs  kapitel 15 og 16' }])]);
  const after = await as(DAD, 'select kind, done from school_homework order by kind');
  assert.deepEqual(after.map((r) => [r.kind, r.done]), [['husk', true], ['lektie', false]]);
  await assert.rejects(as(KID, 'select school_homework_done($1, true)', [rows[1].id]), /not found/);
});

test('the job brings calendars in through sync_calendar with the parent sync token', async () => {
  const tok = (await job('select * from school_jobs($1)', [KEY]))[0].sync_token;
  const m = (await job(`select sync_calendar($1, 'Motionsdag', '2026-12-02T00:00:00+01:00', '2026-12-03T00:00:00+01:00', 'Yes', 'Aula – Carl') as m`, [tok]))[0].m;
  assert.match(m, /1 nye kalendere/);
  assert.ok((await q(`select 1 from user_calendars where name = 'Aula – Carl' and user_id = $1`, [DAD])).length);
});

test('login from the phone: the sync code hands over a session; the job stores it encrypted', async () => {
  const tok = (await one(DAD, 'select token from my_sync_token()')).token;
  const session = { username: 'dad3', tokens: { access_token: 'a', refresh_token: 'r', expires_at: 1 }, cookies: {} };
  await assert.rejects(job(`select school_session_import('wrong', 'dad3', $1)`, [JSON.stringify(session)]), /Ukendt/);
  const kidTok = (await one(KID, 'select token from my_sync_token()').catch(() => null))?.token;
  if (kidTok) await assert.rejects(job(`select school_session_import($1, 'k', $2)`, [kidTok, JSON.stringify(session)]), /mor og far/);
  await assert.rejects(job(`select school_session_import($1, 'dad3', '{"x":1}')`, [tok]), /Ugyldigt/);
  await job(`select school_session_import($1, 'dad3', $2)`, [tok, JSON.stringify(session)]);
  await assert.rejects(as(DAD, 'select session_import from school_links'), /permission denied/);
  const j = (await job('select * from school_jobs($1)', [KEY]))[0];
  assert.equal(j.due, true); assert.equal(j.session_import.tokens.refresh_token, 'r');
  assert.equal((await one(DAD, 'select status, mitid_username from school_links')).mitid_username, 'dad3');
  await job(`select school_job_update($1, $2, '{"aula_session": "enc"}')`, [KEY, DAD]);
  const after = (await q('select session_import, aula_session from school_links'))[0];
  assert.equal(after.session_import, null); assert.equal(after.aula_session, 'enc');
});

test('unlinking removes the link and the messages', async () => {
  await as(DAD, 'select school_link_remove()');
  assert.equal((await q('select count(*)::int n from school_links'))[0].n, 0);
  assert.equal((await q('select count(*)::int n from school_messages'))[0].n, 0);
});
