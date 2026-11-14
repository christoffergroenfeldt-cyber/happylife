// Happy Life – task reminders as push notifications.
//
// Called every 5 minutes by pg_cron (see cron.sql) with an empty body: sends
// every reminder that is due, once, to the people who still have to do the task.
// Called by the app with { test: true } and the user's session: sends a test
// notification to that user's phones.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com),
//   APP_URL (https://christoffergroenfeldt-cyber.github.io/happylife/),
//   APP_TIMEZONE (optional, default Europe/Copenhagen)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// ------------------------------------------------------------ logic start
// Pure functions (no I/O) – tested in tests/remind.test.mjs.
// Date helpers are the same as the app's dates.js.

type Task = {
  id: string; family_id: string; title: string; roles: string[]; assignees: string[];
  open: boolean; need: number; recurrence: string; interval_days: number | null;
  start_date: string; due_date: string | null; created_by: string | null;
  remind_time: string | null; remind_days_before: number;
  days_before?: number; event_yearly?: boolean;
  event_every_weeks?: number | null; event_until?: string | null; event_skips?: string[];
};
type Member = { user_id: string; roles: string[] };
type Done = { done_by: string; period: string };

const toUTC = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const addDays = (iso: string, n: number) => new Date(toUTC(iso) + n * 86400000).toISOString().slice(0, 10);
const weekStart = (iso: string) => addDays(iso, -((new Date(toUTC(iso)).getUTCDay() + 6) % 7));

// Next date (>= day) a yearly date falls on; Feb 29 -> Feb 28 in non-leap years
function nextYearly(startIso: string, day: string) {
  const [, m, d] = startIso.split('-').map(Number);
  const make = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const dd = m === 2 && d === 29 && !leap ? 28 : d;
    return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };
  const y = Number(day.slice(0, 4));
  return make(y) >= day ? make(y) : make(y + 1);
}

function periodKey(task: Task, day: string): string | null {
  if (task.start_date && day < task.start_date && task.recurrence !== 'once') return null;
  switch (task.recurrence) {
    case 'daily': return day;
    case 'weekdays': return [0, 6].includes(new Date(toUTC(day)).getUTCDay()) ? null : day;
    case 'weekly': return weekStart(day);
    case 'monthly': return day.slice(0, 7);
    case 'yearly': return day.slice(0, 4);
    case 'custom': {
      const n = Math.max(1, task.interval_days || 1);
      return addDays(task.start_date, Math.floor(daysBetween(task.start_date, day) / n) * n);
    }
    default: return 'once';
  }
}

function periodEnd(task: Task, day: string): string | null {
  switch (task.recurrence) {
    case 'daily': case 'weekdays': return day;
    case 'weekly': return addDays(weekStart(day), 6);
    case 'monthly': {
      const [y, m] = day.split('-').map(Number);
      return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
    }
    case 'yearly': return `${day.slice(0, 4)}-12-31`;
    case 'custom': {
      const p = periodKey(task, day);
      return p ? addDays(p, Math.max(1, task.interval_days || 1) - 1) : null;
    }
    default: return task.due_date || null;
  }
}

// Is `day` one of the dates of a weekly series (every N weeks, until, minus skipped weeks)?
function isWeeklyOcc(task: Task, day: string) {
  const diff = daysBetween(task.start_date, day);
  return diff >= 0 && diff % (7 * (task.event_every_weeks || 1)) === 0
    && !(task.event_until && day > task.event_until) && !(task.event_skips || []).includes(day);
}

// Local date and time ('YYYY-MM-DD', 'HH:MM') in the family's time zone
export function localNow(tz: string, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Is a reminder due for this task right now? -> the occurrence it is for, or null.
// Due = the remind time has passed today, and today is `remind_days_before`
// days before the deadline (last day of the period / due date).
export function dueOccurrence(task: Task, today: string, now: string) {
  if (!task.remind_time || task.remind_time.slice(0, 5) > now) return null;
  const before = task.remind_days_before || 0;
  const deadline = addDays(today, before);
  if (task.recurrence === 'event') {
    // deadline = event date minus days_before
    const occ = addDays(deadline, task.days_before || 0);
    const isOcc = task.event_yearly ? nextYearly(task.start_date, occ) === occ
      : task.event_every_weeks ? isWeeklyOcc(task, occ) : task.start_date === occ;
    return isOcc ? { period: occ, deadline, before } : null;
  }
  if (task.recurrence === 'once') {
    const due = task.due_date || task.start_date;
    return due === deadline ? { period: 'once', deadline, before } : null;
  }
  const period = periodKey(task, deadline);
  if (!period || periodEnd(task, deadline) !== deadline) return null;
  return { period, deadline, before };
}

// Who still has to do it. `missing` > 0 for an open family task that needs more people.
export function whoToRemind(task: Task, period: string, members: Member[], done: Done[], takers: string[]) {
  const doneRows = done.filter((d) => task.recurrence === 'once' || d.period === period);
  const hasRole = (m: Member) => task.roles.includes('all') || m.roles.some((r) => task.roles.includes(r));
  if (task.open) {
    if (doneRows.length) return { ids: [], missing: 0 };
    const need = task.need || 1;
    if (takers.length >= need) return { ids: takers, missing: 0 };
    const ids = members.filter((m) => hasRole(m) || m.user_id === task.created_by).map((m) => m.user_id);
    return { ids: [...new Set([...ids, ...takers])], missing: need - takers.length };
  }
  if (task.assignees?.length) {
    return { ids: task.assignees.filter((a) => !doneRows.some((d) => d.done_by === a)), missing: 0 };
  }
  if (doneRows.length) return { ids: [], missing: 0 };
  return { ids: members.filter(hasRole).map((m) => m.user_id), missing: 0 };
}

const TEXT: Record<string, Record<string, (n: number, s?: string) => string>> = {
  da: {
    today: () => 'Skal gøres i dag',
    before: (n, d) => `Frist ${n === 1 ? 'i morgen' : `om ${n} dage`} (${d})`,
    missing: (n) => ` · mangler ${n} ${n === 1 ? 'person' : 'personer'} – tag den i appen`,
    testTitle: () => 'Happy Life', testBody: () => 'Notifikationer virker 💛',
  },
  en: {
    today: () => 'Due today',
    before: (n, d) => `Due ${n === 1 ? 'tomorrow' : `in ${n} days`} (${d})`,
    missing: (n) => ` · ${n} more ${n === 1 ? 'person' : 'people'} needed – take it in the app`,
    testTitle: () => 'Happy Life', testBody: () => 'Notifications are working 💛',
  },
  fr: {
    today: () => 'À faire aujourd’hui',
    before: (n, d) => `Échéance ${n === 1 ? 'demain' : `dans ${n} jours`} (${d})`,
    missing: (n) => ` · encore ${n} ${n === 1 ? 'personne' : 'personnes'} – prenez-la dans l’app`,
    testTitle: () => 'Happy Life', testBody: () => 'Les notifications fonctionnent 💛',
  },
};

export function reminderBody(lang: string, before: number, deadline: string, missing: number) {
  const tx = TEXT[lang] || TEXT.da;
  const locale = { da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[lang] || 'da-DK';
  const [y, m, d] = deadline.split('-').map(Number);
  const when = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return (before > 0 ? tx.before(before, when) : tx.today(0)) + (missing > 0 ? tx.missing(missing) : '');
}

// ------------------------------------------------------------ price watch
// One push a day per person with the best prices of the products they follow,
// once the daily price check has run (sent from PRICE_TIME, local time).
export const PRICE_TIME = '08:00';
type Watch = {
  id: string; family_id: string; title: string; notify: string; visible_to: string; active: boolean;
  created_by: string | null; followers: string[]; target_price: number | string | null; allow_used: boolean;
  best_price: number | string | null; best_shop: string | null; last_checked: string | null;
};
type Point = { watch_id: string; checked_on: string; price: number | string; shipping: number | string | null;
  used: boolean; in_stock: boolean | null };

// Best total price per day (in stock unless unknown; used only when allowed)
export function dailyBest(w: Watch, points: Point[]) {
  const best: Record<string, number> = {};
  for (const p of points) {
    if (p.watch_id !== w.id || p.in_stock === false || (p.used && !w.allow_used)) continue;
    const v = Number(p.price) + Number(p.shipping || 0);
    if (!(p.checked_on in best) || v < best[p.checked_on]) best[p.checked_on] = v;
  }
  return best;
}

export function priceStatus(w: Watch, points: Point[], today: string) {
  const days = dailyBest(w, points);
  const best = days[today] ?? null;
  const earlier = Object.keys(days).filter((d) => d < today).sort();
  const prev = earlier.length ? days[earlier[earlier.length - 1]] : null;
  const low = earlier.length ? Math.min(...earlier.map((d) => days[d])) : null;
  const target = w.target_price == null ? null : Number(w.target_price);
  return {
    best, prev, change: best != null && prev != null ? Math.round((best - prev) * 100) / 100 : null,
    lowest: best != null && low != null && best < low, atTarget: best != null && target != null && best <= target,
  };
}

// Who gets which products today: { userId: [watch, status][] }
export function priceDigest(watches: Watch[], points: Point[], members: (Member & { family_id: string })[],
                            today: string, now: string, checkedToday: (w: Watch) => boolean) {
  const out: Record<string, { w: Watch; st: ReturnType<typeof priceStatus> }[]> = {};
  if (now < PRICE_TIME) return out;
  for (const w of watches) {
    if (!w.active || w.notify === 'off' || !checkedToday(w)) continue;
    const st = priceStatus(w, points, today);
    if (st.best == null) continue;
    if (w.notify === 'drop' && !((st.change ?? 0) < 0 || st.atTarget || st.lowest)) continue;
    for (const u of w.followers || []) {
      const m = members.find((x) => x.user_id === u && x.family_id === w.family_id);
      if (!m) continue;
      const sees = w.created_by === u || w.visible_to === 'family'
        || (w.visible_to === 'parents' && m.roles.some((r) => r === 'mother' || r === 'father'));
      if (sees) (out[u] ||= []).push({ w, st });
    }
  }
  return out;
}

const PTEXT: Record<string, Record<string, (x?: string) => string>> = {
  da: { many: () => 'Dagens bedste priser', at: (s) => `billigst hos ${s}`, since: (x) => `${x} siden sidst`,
        lowest: () => 'laveste pris hidtil', target: () => 'under din målpris 🎯', same: () => 'uændret',
        none: () => 'Ingen tilbud fundet', checked: () => 'Priserne er tjekket' },
  en: { many: () => 'Today’s best prices', at: (s) => `cheapest at ${s}`, since: (x) => `${x} since last time`,
        lowest: () => 'lowest price so far', target: () => 'below your target 🎯', same: () => 'unchanged',
        none: () => 'No offers found', checked: () => 'Prices checked' },
  fr: { many: () => 'Meilleurs prix du jour', at: (s) => `le moins cher chez ${s}`, since: (x) => `${x} depuis la dernière fois`,
        lowest: () => 'prix le plus bas à ce jour', target: () => 'sous votre prix cible 🎯', same: () => 'inchangé',
        none: () => 'Aucune offre trouvée', checked: () => 'Prix vérifiés' },
};
const LOC: Record<string, string> = { da: 'da-DK', en: 'en-GB', fr: 'fr-FR' };
export const kr = (lang: string, v: number) => new Intl.NumberFormat(LOC[lang] || 'da-DK',
  { style: 'currency', currency: 'DKK', maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);

export function priceMessage(lang: string, items: { w: Watch; st: ReturnType<typeof priceStatus> }[]) {
  const tx = PTEXT[lang] || PTEXT.da;
  const extras = (st: ReturnType<typeof priceStatus>) => [
    st.change == null ? '' : st.change === 0 ? tx.same() : tx.since(`${st.change < 0 ? '↓' : '↑'} ${kr(lang, Math.abs(st.change))}`),
    st.lowest ? tx.lowest() : '', st.atTarget ? tx.target() : ''].filter(Boolean);
  if (items.length === 1) {
    const { w, st } = items[0];
    return { title: `🏷️ ${w.title}: ${kr(lang, st.best!)}`,
             body: [tx.at(w.best_shop || '?'), ...extras(st)].join(' · ') };
  }
  return { title: `🏷️ ${tx.many()}`,
           body: items.map(({ w, st }) => `${w.title}: ${kr(lang, st.best!)}${w.best_shop ? ` (${w.best_shop})` : ''}`
             + (st.change ? ` ${st.change < 0 ? '↓' : '↑'}${kr(lang, Math.abs(st.change))}` : '')
             + (st.atTarget ? ' 🎯' : '')).join('\n') };
}
// After "check now": what was found (products without a price today say so)
export function checkedMessage(lang: string, items: { w: Watch & { check_note?: string | null }; st: ReturnType<typeof priceStatus> }[]) {
  const tx = PTEXT[lang] || PTEXT.da;
  const found = items.filter((x) => x.st.best != null);
  if (items.length === 1 && !found.length) {
    return { title: `🏷️ ${items[0].w.title}`, body: items[0].w.check_note || tx.none() };
  }
  if (found.length === items.length) return priceMessage(lang, found);
  const m = found.length ? priceMessage(lang, found) : { title: '', body: '' };
  return { title: `🏷️ ${tx.checked()}`,
           body: [found.length > 1 ? m.body : found.length ? `${m.title.replace('🏷️ ', '')}` : '',
                  ...items.filter((x) => x.st.best == null).map((x) => `${x.w.title}: ${x.w.check_note || tx.none()}`)]
             .filter(Boolean).join('\n') };
}
// ------------------------------------------------------------ logic end

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const pub = Deno.env.get('VAPID_PUBLIC_KEY');
    const priv = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!pub || !priv) return json({ error: 'VAPID keys are not set' }, 500);
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com', pub, priv);
    const appUrl = Deno.env.get('APP_URL') || '';
    const tz = Deno.env.get('APP_TIMEZONE') || 'Europe/Copenhagen';

    // Send to every phone of these users; payload depends on the phone's language
    async function sendTo(userIds: string[], make: (lang: string) => Record<string, string>) {
      if (!userIds.length) return 0;
      const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', userIds);
      const results = await Promise.allSettled((subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(make(s.lang)), { TTL: 60 * 60 * 12, urgency: 'high' });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
          throw e;
        }
      }));
      return results.filter((r) => r.status === 'fulfilled').length;
    }

    const body = await req.json().catch(() => ({}));

    if (body?.test) {
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: { user } } = await admin.auth.getUser(jwt);
      if (!user) return json({ error: 'Not signed in' }, 401);
      const sent = await sendTo([user.id], (lang) => ({
        title: (TEXT[lang] || TEXT.da).testTitle(0), body: (TEXT[lang] || TEXT.da).testBody(0), url: appUrl, tag: 'test',
      }));
      return json({ sent });
    }

    const { date: today, time: now } = localNow(tz);
    const { data: tasks, error } = await admin.from('tasks').select('*').not('remind_time', 'is', null);
    if (error) throw error;

    let sent = 0;
    for (const task of (tasks ?? []) as Task[]) {
      const occ = dueOccurrence(task, today, now);
      if (!occ) continue;

      const [{ data: members }, { data: done }, { data: takes }, { data: already }] = await Promise.all([
        admin.from('members').select('user_id,roles').eq('family_id', task.family_id),
        admin.from('task_done').select('done_by,period').eq('task_id', task.id),
        admin.from('task_takes').select('user_id').eq('task_id', task.id).eq('period', occ.period),
        admin.from('reminders_sent').select('user_id').eq('task_id', task.id).eq('period', occ.period),
      ]);
      const { ids, missing } = whoToRemind(task, occ.period, members ?? [], done ?? [],
        (takes ?? []).map((x) => x.user_id));
      const todo = ids.filter((id) => !(already ?? []).some((a) => a.user_id === id));
      if (!todo.length) continue;

      // Claim first, so two overlapping runs can't both send
      const { data: claimed } = await admin.from('reminders_sent')
        .upsert(todo.map((user_id) => ({ task_id: task.id, period: occ.period, user_id })),
          { onConflict: 'task_id,period,user_id', ignoreDuplicates: true })
        .select('user_id');
      sent += await sendTo((claimed ?? []).map((c) => c.user_id), (lang) => ({
        title: `🔔 ${task.title}`,
        body: reminderBody(lang, occ.before, occ.deadline, missing),
        url: appUrl, tag: `${task.id}:${occ.period}`,
      }));
    }
    // Daily price push (a missing table just means an older database)
    let priceSent = 0;
    if (now >= PRICE_TIME) {
      const { data: watches } = await admin.from('price_watches').select('*').eq('active', true).neq('notify', 'off')
        .gte('last_checked', new Date(Date.now() - 36 * 3600 * 1000).toISOString());
      if (watches?.length) {
        const ids = watches.map((w) => w.id);
        const [{ data: points }, { data: members }, { data: sentRows }] = await Promise.all([
          admin.from('price_points').select('watch_id,checked_on,price,shipping,used,in_stock').in('watch_id', ids)
            .gte('checked_on', addDays(today, -400)),
          admin.from('members').select('user_id,roles,family_id'),
          admin.from('price_notified').select('user_id').eq('on_date', today),
        ]);
        const digest = priceDigest(watches as Watch[], (points ?? []) as Point[], members ?? [], today, now,
          (w) => !!w.last_checked && localNow(tz, new Date(w.last_checked)).date === today);
        for (const [user, items] of Object.entries(digest)) {
          if ((sentRows ?? []).some((r) => r.user_id === user)) continue;
          const { data: claimed } = await admin.from('price_notified')
            .upsert({ user_id: user, on_date: today }, { onConflict: 'user_id,on_date', ignoreDuplicates: true }).select('user_id');
          if (!claimed?.length) continue;
          priceSent += await sendTo([user], (lang) => ({
            ...priceMessage(lang, items),
            url: `${appUrl}?prices=${items.length === 1 ? items[0].w.id : 'all'}`, tag: `prices:${today}`,
          }));
        }
      }
    }
    // "Check now" results: tell whoever asked, one message per person
    const { data: told } = await admin.from('price_watches').select('*').not('tell_user', 'is', null);
    if (told?.length) {
      const byUser: Record<string, { w: Watch; st: ReturnType<typeof priceStatus> }[]> = {};
      for (const w of told as (Watch & { tell_user: string })[]) {
        const { data: claimed } = await admin.from('price_watches').update({ tell_user: null })
          .eq('id', w.id).eq('tell_user', w.tell_user).select('id');
        if (!claimed?.length) continue;   // another run took it
        const { data: pts } = await admin.from('price_points').select('watch_id,checked_on,price,shipping,used,in_stock')
          .eq('watch_id', w.id).gte('checked_on', addDays(today, -400));
        (byUser[w.tell_user] ||= []).push({ w, st: priceStatus(w, (pts ?? []) as Point[], today) });
      }
      for (const [user, items] of Object.entries(byUser)) {
        priceSent += await sendTo([user], (lang) => ({
          ...checkedMessage(lang, items),
          url: `${appUrl}?prices=${items.length === 1 ? items[0].w.id : 'all'}`, tag: `checked:${Date.now()}`,
        }));
      }
    }
    return json({ today, now, sent, priceSent });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
