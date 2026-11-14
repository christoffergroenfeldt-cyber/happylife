// Database tests for the price watch (schema.sql in PGlite).
// Run: npm i --no-save @electric-sql/pglite && node --test tests/price-watch.test.mjs
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
  grant usage on schema public to authenticated;
`);
await db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
  -- the price tables keep the column grants from schema.sql
  revoke all on price_watches, price_points, price_notified from authenticated;
  grant select on price_watches, price_points to authenticated;
  grant insert (title, details, ref_url, target_price, allow_used, notify, visible_to) on price_watches to authenticated;
  grant update (title, details, ref_url, target_price, allow_used, notify, visible_to, active) on price_watches to authenticated;
  grant delete on price_watches to authenticated;`);

const DAD = '00000000-0000-0000-0000-00000000000d', MOM = '00000000-0000-0000-0000-00000000000a', KID = '00000000-0000-0000-0000-00000000000c';
for (const u of [DAD, MOM, KID]) await db.query('insert into auth.users values ($1)', [u]);
async function as(user, sql, params = []) {
  await db.exec(`set test.uid = '${user}'`);
  await db.exec('set role authenticated');
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const one = async (u, sql, p) => (await as(u, sql, p))[0];
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const fails = (p) => assert.rejects(p);

const fam = await one(DAD, `select * from create_family('Grønfeldt', 'Christoffer', '{father,husband}')`);
await as(MOM, `select join_family($1, 'Mor', '{mother,wife}')`, [fam.invite_code]);
await as(KID, `select join_family($1, 'Carl', '{child}')`, [fam.invite_code]);

test('a child registers a wish; the whole family sees it, the child follows it', async () => {
  const w = await one(KID, `insert into price_watches(title, details) values ('LEGO 42172', 'McLaren P1') returning *`);
  assert.deepEqual(w.followers, [KID]);
  assert.equal(w.family_id, fam.id);
  assert.equal((await as(MOM, 'select id from price_watches where id = $1', [w.id])).length, 1);
});

test('a secret present ("me") is invisible to the others', async () => {
  const w = await one(DAD, `insert into price_watches(title, visible_to) values ('Halskæde', 'me') returning *`);
  assert.equal((await as(MOM, 'select id from price_watches where id = $1', [w.id])).length, 0);
  assert.equal((await as(KID, 'select id from price_watches where id = $1', [w.id])).length, 0);
  await fails(as(MOM, 'select price_follow($1, true)', [w.id]));
});

test('parents-only products are hidden from children', async () => {
  const w = await one(MOM, `insert into price_watches(title, visible_to) values ('Cykel til Carl', 'parents') returning *`);
  assert.equal((await as(DAD, 'select id from price_watches where id = $1', [w.id])).length, 1);
  assert.equal((await as(KID, 'select id from price_watches where id = $1', [w.id])).length, 0);
});

test('the app cannot write prices or followers directly', async () => {
  const w = await one(DAD, `insert into price_watches(title) values ('Robotstøvsuger') returning *`);
  await fails(as(DAD, `update price_watches set best_price = 1 where id = $1`, [w.id]));
  await fails(as(DAD, `update price_watches set followers = '{}' where id = $1`, [w.id]));
  await fails(as(DAD, `insert into price_points(watch_id, shop, price, url) values ($1, 'X', 1, 'https://x.dk')`, [w.id]));
  await fails(as(DAD, `insert into price_watches(title, family_id) values ('x', gen_random_uuid())`));
});

test('follow / unfollow; only creator or a parent changes it', async () => {
  const w = await one(DAD, `insert into price_watches(title) values ('Airfryer') returning *`);
  await as(MOM, 'select price_follow($1, true)', [w.id]);
  await as(MOM, 'select price_follow($1, true)', [w.id]);
  assert.deepEqual((await q('select followers from price_watches where id = $1', [w.id]))[0].followers.sort(), [MOM, DAD].sort());
  await as(DAD, 'select price_follow($1, false)', [w.id]);
  assert.deepEqual((await q('select followers from price_watches where id = $1', [w.id]))[0].followers, [MOM]);
  assert.equal((await as(KID, `update price_watches set title = 'x' where id = $1 returning id`, [w.id])).length, 0);
  assert.equal((await as(MOM, `update price_watches set target_price = 499 where id = $1 returning id`, [w.id])).length, 1);
});

test('price_refresh picks the cheapest in-stock offer incl. shipping, new unless used allowed', async () => {
  const w = await one(DAD, `insert into price_watches(title) values ('Sonos Era 100') returning *`);
  await q(`insert into price_points(watch_id, shop, price, shipping, url, used, in_stock) values
    ($1, 'A', 1499, 0, 'https://a.dk', false, true),
    ($1, 'B', 1399, 149, 'https://b.dk', false, true),
    ($1, 'C', 1299, null, 'https://c.dk', false, false),
    ($1, 'DBA', 900, null, 'https://dba.dk/x', true, true)`, [w.id]);
  await q(`select price_refresh($1, 'Køb nu', null)`, [w.id]);
  let r = (await q('select * from price_watches where id = $1', [w.id]))[0];
  assert.equal(Number(r.best_price), 1499); assert.equal(r.best_shop, 'A'); assert.equal(r.advice, 'Køb nu');
  assert.equal(r.check_note, null); assert.ok(r.last_checked);
  await q(`update price_watches set allow_used = true where id = $1`, [w.id]);
  await q(`select price_refresh($1)`, [w.id]);
  r = (await q('select * from price_watches where id = $1', [w.id]))[0];
  assert.equal(Number(r.best_price), 900); assert.equal(r.best_used, true); assert.equal(r.advice, 'Køb nu');
  // points are visible to whoever sees the product
  assert.equal((await as(KID, 'select * from price_points where watch_id = $1', [w.id])).length, 4);
});

test('no offers today keeps the last best price with a note', async () => {
  const w = await one(DAD, `insert into price_watches(title) values ('Ukendt ting') returning *`);
  await q(`select price_refresh($1)`, [w.id]);
  const r = (await q('select * from price_watches where id = $1', [w.id]))[0];
  assert.equal(r.best_price, null); assert.equal(r.check_note, 'Ingen tilbud fundet i dag');
});
