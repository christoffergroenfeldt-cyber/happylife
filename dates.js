// Date helpers working on local 'YYYY-MM-DD' strings (no time-zone drift)

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// whole days from a to b (b - a)
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function addDays(iso, n) {
  const d = new Date(toUTC(iso) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// Monday of the week containing iso
export function weekStart(iso) {
  const dow = new Date(toUTC(iso)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

// Next date (>= today) a yearly event falls on. Feb 29 -> Feb 28 in non-leap years.
export function nextYearly(startIso, today) {
  const [, m, d] = startIso.split('-').map(Number);
  const make = (y) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const day = m === 2 && d === 29 && !leap ? 28 : d;
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const y = Number(today.slice(0, 4));
  const thisYear = make(y);
  return thisYear >= today ? thisYear : make(y + 1);
}

// Status of a moment: { last, since, dueIn } — dueIn <= 0 means it's time
export function trackerStatus(intervalDays, entryDates, today) {
  const last = entryDates.length ? entryDates.reduce((a, b) => (a > b ? a : b)) : null;
  if (!last) return { last: null, since: null, dueIn: 0 };
  const since = daysBetween(last, today);
  return { last, since, dueIn: intervalDays - since };
}

// Event tasks: the event date they are for next (null when a one-off event has passed)
export function eventOccurrence(task, today) {
  if (task.event_yearly) return nextYearly(task.start_date, today);
  return task.start_date >= today ? task.start_date : null;
}

// Event tasks show up this many days before their deadline
export const EVENT_LEAD_DAYS = 14;

// Key of the occurrence a task is in today:
// once -> 'once', daily -> date, weekly -> Monday's date, monthly -> 'YYYY-MM',
// yearly -> 'YYYY', custom (every N days from start_date) -> that period's first date,
// event -> the event date (only from EVENT_LEAD_DAYS before the deadline).
// Returns null when the task hasn't started yet.
export function periodKey(task, today) {
  if (task.recurrence === 'event') {
    const occ = eventOccurrence(task, today);
    if (!occ) return null;
    const deadline = addDays(occ, -(task.days_before || 0));
    return daysBetween(today, deadline) > EVENT_LEAD_DAYS ? null : occ;
  }
  if (task.start_date && today < task.start_date && task.recurrence !== 'once') return null;
  switch (task.recurrence) {
    case 'daily': return today;
    case 'weekly': return weekStart(today);
    case 'monthly': return today.slice(0, 7);
    case 'yearly': return today.slice(0, 4);
    case 'custom': {
      const n = Math.max(1, task.interval_days || 1);
      const idx = Math.floor(daysBetween(task.start_date, today) / n);
      return addDays(task.start_date, idx * n);
    }
    default: return 'once';
  }
}

// Last day of the current occurrence (for "due by")
export function periodEnd(task, today) {
  switch (task.recurrence) {
    case 'event': {
      const occ = eventOccurrence(task, today);
      return occ ? addDays(occ, -(task.days_before || 0)) : null;
    }
    case 'daily': return today;
    case 'weekly': return addDays(weekStart(today), 6);
    case 'monthly': {
      const [y, m] = today.split('-').map(Number);
      return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
    }
    case 'yearly': return `${today.slice(0, 4)}-12-31`;
    case 'custom': {
      const p = periodKey(task, today);
      return p ? addDays(p, Math.max(1, task.interval_days || 1) - 1) : null;
    }
    default: return task.due_date || null;
  }
}

// Info for showing an event relative to today
// -> { date, days, ongoing, years }  (years: how many years it's been, for yearly events)
export function eventStatus(ev, today) {
  if (ev.yearly) {
    const date = nextYearly(ev.start_date, today);
    const years = Number(date.slice(0, 4)) - Number(ev.start_date.slice(0, 4));
    return { date, days: daysBetween(today, date), ongoing: false, years };
  }
  const end = ev.end_date || ev.start_date;
  if (ev.start_date <= today && end >= today && ev.end_date) {
    return { date: ev.start_date, days: 0, ongoing: true, years: 0 };
  }
  return { date: ev.start_date, days: daysBetween(today, ev.start_date), ongoing: false, years: 0 };
}

export function fmtDate(iso, lang) {
  const [y, m, d] = iso.split('-').map(Number);
  const locale = { da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[lang] || 'da-DK';
  return new Date(y, m - 1, d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
