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
};
type Member = { user_id: string; roles: string[] };
type Done = { done_by: string; period: string };

const toUTC = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const addDays = (iso: string, n: number) => new Date(toUTC(iso) + n * 86400000).toISOString().slice(0, 10);
const weekStart = (iso: string) => addDays(iso, -((new Date(toUTC(iso)).getUTCDay() + 6) % 7));

function periodKey(task: Task, day: string): string | null {
  if (task.start_date && day < task.start_date && task.recurrence !== 'once') return null;
  switch (task.recurrence) {
    case 'daily': return day;
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
    case 'daily': return day;
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
    return json({ today, now, sent });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
