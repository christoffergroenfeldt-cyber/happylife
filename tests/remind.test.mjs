// Tests for the pure part of supabase/functions/remind/index.ts
// Run: node --test tests/remind.test.mjs   (Node 22.18+, uses built-in TypeScript stripping)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = readFileSync(new URL('../supabase/functions/remind/index.ts', import.meta.url), 'utf8');
const logic = src.slice(src.indexOf('// ------------------------------------------------------------ logic start'),
  src.indexOf('// ------------------------------------------------------------ logic end'));
const file = join(mkdtempSync(join(tmpdir(), 'remind-')), 'logic.ts');
writeFileSync(file, logic);
const { localNow, dueOccurrence, whoToRemind, reminderBody } = await import(file);

const base = {
  id: 't1', family_id: 'f', title: 'Tøm opvaskeren', roles: [], assignees: [], open: false, need: 1,
  recurrence: 'daily', interval_days: null, start_date: '2026-11-01', due_date: null, created_by: 'dad',
  remind_time: '07:30:00', remind_days_before: 0,
};
const task = (x) => ({ ...base, ...x });

test('local time in Copenhagen (winter and summer)', () => {
  assert.deepEqual(localNow('Europe/Copenhagen', new Date('2026-11-08T23:30:00Z')), { date: '2026-11-09', time: '00:30' });
  assert.deepEqual(localNow('Europe/Copenhagen', new Date('2026-07-01T05:15:00Z')), { date: '2026-07-01', time: '07:15' });
});

test('daily: due at the time on the day, not before', () => {
  assert.equal(dueOccurrence(task({}), '2026-11-09', '07:29'), null);
  assert.deepEqual(dueOccurrence(task({}), '2026-11-09', '07:30'), { period: '2026-11-09', deadline: '2026-11-09', before: 0 });
  assert.equal(dueOccurrence(task({ remind_time: null }), '2026-11-09', '23:59'), null);
});

test('daily, 1 day before: reminds about tomorrow', () => {
  assert.deepEqual(dueOccurrence(task({ remind_days_before: 1 }), '2026-11-09', '20:00'),
    { period: '2026-11-10', deadline: '2026-11-10', before: 1 });
});

test('not before the task starts', () => {
  assert.equal(dueOccurrence(task({ start_date: '2026-11-20' }), '2026-11-09', '08:00'), null);
});

test('weekly: deadline is Sunday', () => {
  const w = task({ recurrence: 'weekly', remind_days_before: 2 });
  assert.deepEqual(dueOccurrence(w, '2026-11-13', '08:00'), { period: '2026-11-09', deadline: '2026-11-15', before: 2 }); // Fri
  assert.equal(dueOccurrence(w, '2026-11-12', '08:00'), null); // Thu
});

test('monthly: last day of month; yearly: 31 Dec', () => {
  assert.equal(dueOccurrence(task({ recurrence: 'monthly' }), '2026-11-30', '08:00').period, '2026-11');
  assert.equal(dueOccurrence(task({ recurrence: 'monthly' }), '2026-11-29', '08:00'), null);
  assert.equal(dueOccurrence(task({ recurrence: 'yearly', remind_days_before: 7 }), '2026-12-24', '08:00').period, '2026');
});

test('every 3 days: last day of each interval', () => {
  const c = task({ recurrence: 'custom', interval_days: 3 }); // periods 1-3, 4-6, 7-9 Nov
  assert.equal(dueOccurrence(c, '2026-11-09', '08:00').period, '2026-11-07');
  assert.equal(dueOccurrence(c, '2026-11-08', '08:00'), null);
});

test('once: due date, or start date when no due date', () => {
  assert.equal(dueOccurrence(task({ recurrence: 'once', due_date: '2026-11-12', remind_days_before: 3 }), '2026-11-09', '08:00').period, 'once');
  assert.equal(dueOccurrence(task({ recurrence: 'once', due_date: '2026-11-12' }), '2026-11-09', '08:00'), null);
  assert.equal(dueOccurrence(task({ recurrence: 'once', start_date: '2026-11-09' }), '2026-11-09', '08:00').period, 'once');
});

test('event task: N days before a yearly birthday, every year', () => {
  const gift = task({ recurrence: 'event', start_date: '2020-11-20', event_yearly: true, days_before: 7, remind_days_before: 1 });
  // deadline 13 Nov, reminder 1 day before = 12 Nov
  assert.deepEqual(dueOccurrence(gift, '2026-11-12', '08:00'), { period: '2026-11-20', deadline: '2026-11-13', before: 1 });
  assert.equal(dueOccurrence(gift, '2026-11-13', '08:00'), null);
  assert.equal(dueOccurrence(gift, '2027-11-12', '08:00').period, '2027-11-20');
});

test('event task: one-off event only on its date; Feb 29 birthday on Feb 28', () => {
  const pack = task({ recurrence: 'event', start_date: '2027-07-01', event_yearly: false, days_before: 1 });
  assert.equal(dueOccurrence(pack, '2027-06-30', '08:00').period, '2027-07-01');
  assert.equal(dueOccurrence(pack, '2028-06-30', '08:00'), null);
  const leap = task({ recurrence: 'event', start_date: '2024-02-29', event_yearly: true, days_before: 0 });
  assert.equal(dueOccurrence(leap, '2027-02-28', '08:00').period, '2027-02-28');
});

const members = [
  { user_id: 'dad', roles: ['father', 'husband'] }, { user_id: 'mum', roles: ['mother', 'wife'] },
  { user_id: 'anna', roles: ['child'] }, { user_id: 'emil', roles: ['child'] },
];

test('assigned: only those who have not ticked it off this period', () => {
  const t = task({ assignees: ['anna', 'emil'], roles: ['mother', 'father'] });
  const r = whoToRemind(t, '2026-11-09', members, [{ done_by: 'anna', period: '2026-11-09' }, { done_by: 'emil', period: '2026-11-08' }], []);
  assert.deepEqual(r, { ids: ['emil'], missing: 0 });
});

test('role task: everyone with the role, nobody once done', () => {
  const t = task({ roles: ['husband'] });
  assert.deepEqual(whoToRemind(t, 'p', members, [], []).ids, ['dad']);
  assert.deepEqual(whoToRemind(t, 'p', members, [{ done_by: 'dad', period: 'p' }], []).ids, []);
  assert.deepEqual(whoToRemind(task({ roles: ['all'] }), 'p', members, [], []).ids, ['dad', 'mum', 'anna', 'emil']);
});

test('once: done in an earlier period still counts as done', () => {
  const t = task({ recurrence: 'once', assignees: ['anna'] });
  assert.deepEqual(whoToRemind(t, 'once', members, [{ done_by: 'anna', period: 'once' }], []).ids, []);
});

test('open family task: takers when full, otherwise everyone who can see it', () => {
  const t = task({ open: true, need: 2, roles: ['child'] });
  assert.deepEqual(whoToRemind(t, 'p', members, [], ['anna']), { ids: ['dad', 'anna', 'emil'], missing: 1 }); // dad created it
  assert.deepEqual(whoToRemind(t, 'p', members, [], ['anna', 'emil']), { ids: ['anna', 'emil'], missing: 0 });
  assert.deepEqual(whoToRemind(t, 'p', members, [{ done_by: 'anna', period: 'p' }], ['anna', 'emil']).ids, []);
});

test('notification text', () => {
  assert.equal(reminderBody('da', 0, '2026-11-09', 0), 'Skal gøres i dag');
  assert.match(reminderBody('da', 1, '2026-11-10', 0), /^Frist i morgen \(tirsdag 10\. november\)$/);
  assert.match(reminderBody('en', 3, '2026-11-12', 2), /^Due in 3 days \(Thursday 12 November\) · 2 more people needed/);
  assert.match(reminderBody('fr', 0, '2026-11-09', 1), /^À faire aujourd’hui · encore 1 personne/);
});
