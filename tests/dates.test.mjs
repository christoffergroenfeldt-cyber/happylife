// Tests for dates.js (app date logic). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWeekly, eventStatus, eventOccurrence, periodKey } from '../dates.js';

const lesson = { start_date: '2026-11-10', every_weeks: 1, repeat_until: '2026-12-15', skip_dates: ['2026-11-24', '2026-12-01'] };

test('nextWeekly: next lesson, skipping holidays, null after the end', () => {
  assert.equal(nextWeekly(lesson, '2026-11-01'), '2026-11-10');
  assert.equal(nextWeekly(lesson, '2026-11-10'), '2026-11-10');
  assert.equal(nextWeekly(lesson, '2026-11-11'), '2026-11-17');
  assert.equal(nextWeekly(lesson, '2026-11-18'), '2026-12-08');   // two skipped weeks
  assert.equal(nextWeekly(lesson, '2026-12-16'), null);
  assert.equal(nextWeekly({ start_date: '2026-11-11', every_weeks: 2 }, '2026-11-12'), '2026-11-25');
});

test('eventStatus: weekly series shows the next date; ended series is in the past', () => {
  assert.deepEqual(eventStatus(lesson, '2026-11-11'), { date: '2026-11-17', days: 6, ongoing: false, years: 0 });
  assert.equal(eventStatus(lesson, '2027-01-05').date, '2026-12-15');
  assert.ok(eventStatus(lesson, '2027-01-05').days < 0);
});

test('task on a weekly series: next lesson, shown only the day before the deadline', () => {
  const bag = { recurrence: 'event', start_date: '2026-11-10', event_every_weeks: 1, event_until: '2026-12-15',
    event_skips: ['2026-11-24'], days_before: 1 };
  assert.equal(eventOccurrence(bag, '2026-11-11'), '2026-11-17');
  assert.equal(periodKey(bag, '2026-11-14'), null);             // deadline 16 Nov is 2 days away
  assert.equal(periodKey(bag, '2026-11-15'), '2026-11-17');
  assert.equal(periodKey(bag, '2026-11-16'), '2026-11-17');
});
