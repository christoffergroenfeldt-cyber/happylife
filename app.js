// Happy Life – main app
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';
import { t, setLang, getLang, LANGS, IDEAS, EVENT_TASKS } from './i18n.js';
import { AGES, ROUTINES, ROUTINE_REC, ROUTINE_TIME, TEMPLATES } from './templates.js';
import { todayISO, daysBetween, addDays, trackerStatus, eventStatus, periodKey, periodEnd, eventOccurrence, fmtDate } from './dates.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ROLES = ['child', 'mother', 'father', 'husband', 'wife'];
const ITEM_ROLES = ['all', ...ROLES];
const PARENT = ['mother', 'father'];
const HOUSE_ROLES = ['child', 'mother', 'father']; // who sees house chores

const S = {
  session: null, me: null, family: null, members: [],
  plans: [], tasks: [], done: [], takes: [], trackers: [], entries: [], events: [], points: [],
  sync: null, calendars: [], loginCode: null, suggestions: [], ideaTab: 'event',
  places: [], chores: [], houseMode: 'todo',
  tab: 'home', authStep: 'email', authEmail: '', setupMode: 'create', ideaShift: {}, pushOn: false,
};

const app = document.getElementById('app');
const dialog = document.getElementById('dialog');

// ------------------------------------------------------------ utilities

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => todayISO();
const uid = () => S.session?.user?.id;
const myRoles = () => S.me?.roles || [];
const isParent = () => myRoles().some((r) => PARENT.includes(r));
const memberName = (id) => S.members.find((m) => m.user_id === id)?.display_name || '?';
const children = () => S.members.filter((m) => m.roles.includes('child'));

function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); }
  catch { return null; }
}

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function run(promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(error);
    toast(`${t('error')}: ${error.message}`, true);
    throw error;
  }
  return data;
}

const roleChips = (roles) => roles.map((r) => `<span class="chip role-${r}">${esc(t('roles.' + r))}</span>`).join('');

function roleCheckboxes(name, list, selected) {
  return `<div class="checks">${list.map((r) => `
    <label class="check"><input type="checkbox" name="${name}" value="${r}" ${selected.includes(r) ? 'checked' : ''}>
    <span>${esc(t('roles.' + r))}</span></label>`).join('')}</div>`;
}

function memberCheckboxes(name, list, selected) {
  return `<div class="checks">${list.map((m) => `
    <label class="check"><input type="checkbox" name="${name}" value="${m.user_id}" ${selected.includes(m.user_id) ? 'checked' : ''}>
    <span>${esc(m.display_name)}</span></label>`).join('')}</div>`;
}

// ------------------------------------------------------------ data

async function loadAll() {
  const me = await run(sb.from('members').select('*').eq('user_id', uid()).maybeSingle());
  S.me = me;
  if (!me) return;
  const [family, members, plans, tasks, done, takes, trackers, entries, events, points, places, chores] = await Promise.all([
    run(sb.from('families').select('*').eq('id', me.family_id).single()),
    run(sb.from('members').select('*').order('created_at')),
    run(sb.from('plans').select('*').order('created_at')),
    run(sb.from('tasks').select('*').order('created_at')),
    run(sb.from('task_done').select('*').gte('done_on', isoMinus(400))),
    run(sb.from('task_takes').select('*').gte('created_at', isoMinus(400))),
    run(sb.from('trackers').select('*').order('created_at')),
    run(sb.from('tracker_entries').select('*').order('done_on', { ascending: false })),
    run(sb.from('events').select('*')),
    run(sb.rpc('points_summary')),
    run(sb.from('house_places').select('*').order('sort').order('created_at')),
    run(sb.from('house_chores').select('*').order('sort').order('created_at')),
  ]);
  Object.assign(S, { family, members, plans, tasks, done, takes, trackers, entries, events, points: points || [], places, chores });
  // Idea lists (only rows for my roles come back; a missing table just means none)
  const { data: sugg } = await sb.from('suggestions').select('*');
  S.suggestions = sugg || [];
  if (isParent()) {
    const [sync, calendars] = await Promise.all([
      run(sb.from('sync_tokens').select('*').maybeSingle()),
      run(sb.from('user_calendars').select('*').order('name')),
    ]);
    Object.assign(S, { sync, calendars });
  }
}

function isoMinus(days) {
  const d = new Date(); d.setDate(d.getDate() - days); return todayISO(d);
}

async function refresh() {
  await loadAll();
  render();
}

// ------------------------------------------------------------ task logic

function taskKind(task) {
  if (task.open) return 'open';
  if (task.assignees?.length) return 'assigned';
  return 'role';
}

const isHouse = (task) => !!task.place_id;

// House chores are shown as "Chore – Room" using the current names
function taskTitle(task) {
  if (!isHouse(task)) return task.title;
  const c = byId(S.chores, task.chore_id), p = byId(S.places, task.place_id);
  return c && p ? `${c.name} – ${p.name}` : task.title;
}

// Everything the UI needs to know about a task right now
function taskState(task) {
  const td = today();
  const period = periodKey(task, td);
  const doneRows = S.done.filter((d) => d.task_id === task.id && d.period === period);
  const takers = S.takes.filter((x) => x.task_id === task.id && x.period === period).map((x) => x.user_id);
  const kind = taskKind(task);
  const forMe = kind === 'assigned' ? task.assignees.includes(uid())
    : kind === 'role' ? task.roles.includes('all') || task.roles.some((r) => myRoles().includes(r))
    : true;
  const doneByMe = doneRows.some((d) => d.done_by === uid());
  const done = kind === 'assigned' ? doneByMe : doneRows.length > 0;
  // A one-off task that was finished in an earlier period is finished for good
  const finishedOnce = task.recurrence === 'once' && S.done.some((d) => d.task_id === task.id &&
    (kind !== 'assigned' || d.done_by === uid()));
  return {
    kind, period, doneRows, takers, forMe,
    done: done || finishedOnce,
    doneByMe, took: takers.includes(uid()),
    full: takers.length >= (task.need || 1),
    end: period ? periodEnd(task, td) : null,
    active: period !== null,
  };
}

function recLabel(task) {
  if (task.recurrence === 'event') return eventTaskLabel(task);
  if (task.recurrence === 'custom') return t('everyN', task.interval_days);
  return t('rec.' + task.recurrence);
}

// "7 dage før Annas fødselsdag" (the event may be hidden from a child: then the date)
function eventTaskLabel(task) {
  const ev = S.events.find((e) => e.id === task.event_id);
  const n = task.days_before || 0;
  if (!ev) {
    const occ = eventOccurrence(task, today());
    return `${n ? t('daysBefore', n) : t('onTheDay')}${occ ? ` ${fmtDate(occ, getLang())}` : ''}`;
  }
  const title = ev.title;
  return n === 0 ? t('onEventDay', { title }) : n === 1 ? t('dayBeforeEvent', { title }) : t('daysBeforeEvent', { n, title });
}

const eventIcon = (type) => ({ vacation: '🏖️', anniversary: '💍', birthday: '🎂', other: '📌' }[type] || '📌');

// Point counters: a child sees their own, parents see every child's
function pointsCard() {
  if (!S.points.length) return '';
  const rows = S.points
    .map((p) => ({ ...p, name: memberName(p.user_id), total: Number(p.total), week: Number(p.week) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  if (!isParent() && rows.length === 1 && rows[0].user_id === uid()) {
    const me = rows[0];
    return `<div class="card points solo">
      <div class="pts-label">${esc(t('myPoints'))}</div>
      <div class="pts-big">★ ${me.total}</div>
      ${me.week ? `<div class="meta">${esc(t('weekPts', me.week))}</div>` : ''}
    </div>`;
  }
  return `<div class="card points">
    <div class="pts-label">${esc(t('kidsPoints'))}</div>
    ${rows.map((p) => `<div class="pts-row">
      <span class="pts-name">${esc(p.name)}</span>
      <span class="meta">${p.week ? esc(t('weekPts', p.week)) : ''}</span>
      <span class="pts-n">★ ${p.total}</span></div>`).join('')}
  </div>`;
}

function remindLabel(task) {
  if (!task.remind_time) return '';
  const before = task.remind_days_before || 0;
  return `🔔 ${task.remind_time.slice(0, 5)}${before ? `, ${t('daysBefore', before)}` : ''}`;
}

// ------------------------------------------------------------ push notifications
// Same approach as the Friends app: web push via the `remind` Edge Function.

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => !!VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Save this phone's subscription for the signed-in person (also updates the language)
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.rpc('save_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_lang: getLang() });
  if (error) throw error;
  S.pushOn = true;
}

// Already allowed on this phone? Then (re)connect silently – no tap needed.
async function ensurePush() {
  if (!S.me || !pushSupported() || Notification.permission !== 'granted') return;
  try { await subscribePush(); } catch (e) { console.warn('push subscribe failed', e); }
}

function pushSection() {
  let inner;
  if (!pushSupported()) inner = `<p class="hint">${esc(t('pushNotSupported'))}</p>`;
  else if (!isStandalone()) inner = `<p class="hint">${esc(t('pushHome'))}</p>`;
  else if (Notification.permission === 'denied') inner = `<p class="hint">${esc(t('pushBlocked'))}</p>`;
  else if (S.pushOn) inner = `<p>${esc(t('pushOnText'))}</p>
    <button class="small" data-act="pushTest">${t('pushTest')}</button>`;
  else inner = `<p class="meta">${esc(t('pushWhy'))}</p>
    <button class="primary" data-act="pushEnable">${t('pushEnable')}</button>`;
  return `<h2>${esc(t('notifications'))}</h2><div class="card">${inner}</div>`;
}

// ------------------------------------------------------------ render root

function render() {
  setLang(store('hl-lang') || getLang());
  if (!S.session) return renderAuth();
  if (!S.me) return renderSetup();
  const tabs = ['home', 'tasks', 'house', 'moments', 'calendar', 'family'];
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const icons = {
    home: svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
    tasks: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
    house: svg('<path d="M4 20V10.5L12 4l8 6.5V20"/><path d="M9 20v-5h6v5"/><path d="M15 3.5l5 0.5-0.5 5"/>'),
    moments: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
    calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    family: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>'),
  };
  const views = { home: viewHome, tasks: viewTasks, house: viewHouse, moments: viewMoments, calendar: viewCalendar, family: viewFamily };
  app.innerHTML = `
    <header class="top"><h1>${esc(t('tabs.' + S.tab))}</h1><span class="fam">${esc(S.family?.name)}</span></header>
    <main class="view">${views[S.tab]()}</main>
    <nav class="tabs">${tabs.map((k) => `
      <button data-act="tab" data-id="${k}" class="${S.tab === k ? 'on' : ''}">
        <span class="ico">${icons[k]}</span><span>${esc(t('tabs.' + k))}</span></button>`).join('')}
    </nav>`;
}

function langPicker() {
  return `<div class="langs">${Object.entries(LANGS).map(([k, v]) =>
    `<button data-act="lang" data-id="${k}" class="${getLang() === k ? 'on' : ''}">${v}</button>`).join('')}</div>`;
}

// ------------------------------------------------------------ auth + setup

// Sign in with a one-time code sent by email (no passwords) – same flow as the Friends app.
// New email addresses get an account automatically.
function renderAuth() {
  const codeStep = S.authStep === 'code';
  app.innerHTML = `
    <div class="center">
      <div class="brand"><div class="logo">💛</div><h1>${t('appName')}</h1><p>${esc(t('tagline'))}</p></div>
      ${S.authStep === 'login' ? '' : codeStep ? `
      <form class="card" id="codeForm">
        <p class="hint">${esc(t('codeSent', { email: S.authEmail }))}</p>
        <label>${t('code')}<input name="code" class="otp" type="text" inputmode="numeric"
          autocomplete="one-time-code" maxlength="10" required></label>
        <button class="primary" type="submit">${t('signIn')}</button>
        <button class="link" type="button" data-act="otherEmail">${t('otherEmail')}</button>
      </form>` : `
      <form class="card" id="emailForm">
        <label>${t('email')}<input name="email" type="email" inputmode="email" autocomplete="email"
          value="${esc(S.authEmail)}" required></label>
        <button class="primary" type="submit">${t('sendCode')}</button>
        <p class="hint">${esc(t('noPassword'))}</p>
      </form>`}
      ${S.authStep === 'login' ? `
      <form class="card" id="loginCodeForm">
        <p class="hint">${esc(t('loginCodeHelp'))}</p>
        <label>${t('loginCode')}<input name="code" class="otp" type="text" autocapitalize="characters"
          autocomplete="off" autocorrect="off" spellcheck="false" maxlength="9" placeholder="ABCD-EFGH" required></label>
        <button class="primary" type="submit">${t('signIn')}</button>
        <button class="link" type="button" data-act="otherEmail">${t('useEmail')}</button>
      </form>` : `<button class="link" type="button" data-act="useLoginCode">📲 ${t('haveLoginCode')}</button>`}
      ${langPicker()}
    </div>`;

  const busy = (e, on) => { if (e.submitter) e.submitter.disabled = on; };
  if (S.authStep === 'login') {
    const form = document.getElementById('loginCodeForm');
    form.elements.code.focus();
    form.elements.code.oninput = (e) => { // ABCDEFGH -> ABCD-EFGH while typing
      const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      e.target.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      busy(e, true);
      const { data, error } = await sb.functions.invoke('login-code', { body: { code: form.elements.code.value } });
      let reason = data?.error;
      if (error) reason = (await error.context?.json?.().catch(() => null))?.error || 'server';
      if (!reason && data?.token_hash) {
        const { error: e2 } = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
        if (!e2) return; // onAuthStateChange takes over
        console.error(e2); reason = 'server';
      }
      toast(t({ invalid: 'loginCodeWrong', too_many: 'loginCodeTooMany', invite_code: 'loginCodeIsInvite' }[reason] || 'loginCodeError'), true);
      busy(e, false);
    };
  } else if (codeStep) {
    const form = document.getElementById('codeForm');
    form.elements.code.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      busy(e, true);
      const token = form.elements.code.value.replace(/\s/g, '');
      const { error } = await sb.auth.verifyOtp({ email: S.authEmail, token, type: 'email' });
      if (error) {
        console.error(error);
        toast(/expired|invalid/i.test(error.message) ? t('codeWrong') : `${t('error')}: ${error.message}`, true);
        busy(e, false);
      }
      // on success onAuthStateChange loads the family and renders
    };
  } else {
    document.getElementById('emailForm').onsubmit = async (e) => {
      e.preventDefault();
      busy(e, true);
      S.authEmail = new FormData(e.target).get('email').trim().toLowerCase();
      try {
        await run(sb.auth.signInWithOtp({ email: S.authEmail, options: { shouldCreateUser: true } }));
        S.authStep = 'code';
        render();
      } catch { busy(e, false); }
    };
  }
}

function renderSetup() {
  const create = S.setupMode === 'create';
  app.innerHTML = `
    <div class="center">
      <div class="brand"><div class="logo">💛</div><h1>${esc(t('setupTitle'))}</h1></div>
      <div class="seg">
        <button data-act="setupMode" data-id="create" class="${create ? 'on' : ''}">${t('createFamily')}</button>
        <button data-act="setupMode" data-id="join" class="${create ? '' : 'on'}">${t('joinFamily')}</button>
      </div>
      <form class="card" id="setupForm">
        ${create ? `<label>${t('familyName')}<input name="family" required></label>`
                 : `<label>${t('inviteCode')}<input name="code" required autocapitalize="characters"></label>`}
        <label>${t('yourName')}<input name="name" required></label>
        <fieldset><legend>${t('yourRoles')}</legend>${roleCheckboxes('roles', ROLES, [])}
          <p class="hint">${esc(t('rolesHelp'))}</p></fieldset>
        <button class="primary" type="submit">${create ? t('create') : t('join')}</button>
      </form>
      <button class="link" data-act="signOut">${t('signOut')}</button>
      ${langPicker()}
    </div>`;
  document.getElementById('setupForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const roles = f.getAll('roles');
    if (!roles.length) return toast(t('needRole'), true);
    if (create) {
      await run(sb.rpc('create_family', { p_name: f.get('family'), p_display_name: f.get('name'), p_roles: roles, p_lang: getLang() }));
    } else {
      await run(sb.rpc('join_family', { p_code: f.get('code'), p_display_name: f.get('name'), p_roles: roles }));
    }
    await refresh();
  };
}

// ------------------------------------------------------------ home

function viewHome() {
  const td = today();
  // Moments that are due
  const due = S.trackers
    .map((tr) => ({ tr, st: trackerStatus(tr.interval_days, entriesOf(tr.id).map((e) => e.done_on), td) }))
    .filter((x) => x.st.dueIn <= 0 && !plannedAhead(x.tr))
    .sort((a, b) => a.st.dueIn - b.st.dueIn);
  // Planned moments in the next 14 days
  const plannedSoon = S.trackers.filter((tr) => plannedAhead(tr) && daysBetween(td, tr.planned_on) <= 14)
    .sort((a, b) => a.planned_on.localeCompare(b.planned_on));

  // Events within their reminder window
  const upcoming = S.events
    .map((ev) => ({ ev, st: eventStatus(ev, td) }))
    .filter(({ ev, st }) => !ev.every_weeks && (st.ongoing || (st.days >= 0 && st.days <= ev.remind_days)))
    .sort((a, b) => a.st.days - b.st.days);

  // Tasks for me in the current period (house chores only once I've taken them)
  const all = S.tasks.map((task) => ({ task, st: taskState(task) }));
  const mine = all.filter(({ task, st }) => st.active && !st.done && (isHouse(task) ? st.took
    : st.kind === 'open' ? (st.took || !st.full) : st.forMe));
  const houseFree = all.filter(({ task, st }) => isHouse(task) && st.active && !st.done && !st.took && !st.full).length;

  return `
    <p class="hello">${esc(t('hello', { name: S.me.display_name }))}</p>
    ${pointsCard()}
    ${due.length ? `<h2>${esc(t('timeFor'))}</h2>${due.map(({ tr, st }) => momentCard(tr, st, true)).join('')}` : ''}
    <h2>${esc(t('upcoming'))}</h2>
    ${plannedSoon.map(plannedRow).join('')}
    ${upcoming.length ? upcoming.map(({ ev, st }) => eventRow(ev, st)).join('') : plannedSoon.length ? '' : `<p class="empty">${esc(t('noUpcoming'))}</p>`}
    <h2>${esc(t('today'))}</h2>
    ${mine.length ? `<div class="list">${mine.map(({ task, st }) => taskRow(task, st)).join('')}</div>`
                  : `<p class="empty">${esc(t('nothingToday'))}</p>`}
    ${houseFree ? `<button class="row go" data-act="tab" data-id="house"><span class="lead big">🧹</span>
      <span class="body"><span class="ttl">${esc(t('houseHome', houseFree))}</span></span><span class="arrow">›</span></button>` : ''}
    ${!due.length && !mine.length ? `<p class="allgood">${esc(t('allGood'))}</p>` : ''}`;
}

// ------------------------------------------------------------ tasks + plans

function taskRow(task, st, opts = {}) {
  const plan = task.plan_id && !opts.inPlan ? S.plans.find((p) => p.id === task.plan_id) : null;
  const meta = [recLabel(task)];
  if (task.points) meta.push(`⭐ ${t('pointsN', task.points)}`);
  if (st.end && !st.done) meta.push(t('dueBy', { date: fmtDate(st.end, getLang()) }));
  if (plan) meta.push(plan.title);
  if (st.kind === 'role') meta.push(task.roles.map((r) => t('roles.' + r)).join(', '));
  if (task.remind_time && !st.done) meta.push(remindLabel(task));

  let actions = '';
  let extra = '';
  if (st.kind === 'open') {
    const names = st.takers.map(memberName);
    extra = `<div class="takers">${esc(t('takenBy'))}: ${names.length ? names.map((n) => `<span class="chip">${esc(n)}</span>`).join('') : `<em>${esc(t('nobodyYet'))}</em>`}
      <span class="need">${st.takers.length}/${task.need}</span></div>`;
    if (st.done) actions = `<span class="ok">✓</span>`;
    else if (st.took) actions = `<button class="small primary" data-act="done" data-id="${task.id}">${t('markDone')}</button>
      <button class="small" data-act="untake" data-id="${task.id}">${t('untake')}</button>`;
    else actions = st.full ? `<span class="chip">${t('full')}</span>`
      : `<button class="small primary" data-act="take" data-id="${task.id}">${t('take')}</button>`;
  } else if (st.kind === 'assigned' && !st.forMe) {
    // a parent looking at children's tasks: status per person
    extra = `<div class="takers">${task.assignees.map((a) => {
      const ok = st.doneRows.some((d) => d.done_by === a) ||
        (task.recurrence === 'once' && S.done.some((d) => d.task_id === task.id && d.done_by === a));
      return `<span class="chip ${ok ? 'yes' : ''}">${ok ? '✓' : '○'} ${esc(memberName(a))}</span>`;
    }).join('')}</div>`;
  } else {
    actions = st.done
      ? `<button class="tick on" data-act="undo" data-id="${task.id}" aria-label="${t('undo')}">✓</button>`
      : `<button class="tick" data-act="done" data-id="${task.id}" aria-label="${t('markDone')}"></button>`;
    if (st.kind === 'assigned' && task.assignees.length > 1) {
      extra = `<div class="takers">${task.assignees.map((a) => {
        const ok = st.doneRows.some((d) => d.done_by === a);
        return `<span class="chip ${ok ? 'yes' : ''}">${ok ? '✓' : '○'} ${esc(memberName(a))}</span>`;
      }).join('')}</div>`;
    }
  }
  const canEdit = !isHouse(task) && (task.created_by === uid() || isParent());
  return `
    <div class="row ${st.done ? 'is-done' : ''}">
      ${st.kind === 'open' ? '' : `<div class="lead">${actions}</div>`}
      <div class="body">
        <div class="ttl">${esc(taskTitle(task))}</div>
        ${task.notes ? `<div class="notes">${esc(task.notes)}</div>` : ''}
        <div class="meta">${meta.map(esc).join(' · ')}</div>
        ${extra}
        ${st.kind === 'open' ? `<div class="acts">${actions}</div>` : ''}
      </div>
      ${canEdit && opts.manage ? `<button class="icon" data-act="editTask" data-id="${task.id}" aria-label="${t('edit')}">✎</button>` : ''}
    </div>`;
}

function viewTasks() {
  const all = S.tasks.filter((task) => !isHouse(task)).map((task) => ({ task, st: taskState(task) }));
  const active = all.filter((x) => x.st.active || x.task.recurrence === 'once');
  const mine = active.filter(({ task, st }) => !task.plan_id && st.kind !== 'open' && st.forMe)
    .concat(active.filter(({ task, st }) => task.plan_id && st.kind === 'assigned' && st.forMe));
  const fam = active.filter(({ st }) => st.kind === 'open');
  const others = active.filter(({ task, st }) => !task.plan_id && st.kind !== 'open' && !st.forMe);

  const plans = S.plans.map((p) => {
    const items = all.filter(({ task }) => task.plan_id === p.id);
    if (!items.length && !isParent()) return '';
    return `
      <div class="card plan">
        <div class="plan-head"><div><h3>${esc(p.title)}</h3>${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ''}</div>
          ${isParent() ? `<button class="icon" data-act="editPlan" data-id="${p.id}" aria-label="${t('edit')}">✎</button>` : ''}</div>
        <div class="list">${items.map(({ task, st }) => taskRow(task, st, { inPlan: true, manage: true })).join('') ||
          `<p class="empty">${esc(t('noTasks'))}</p>`}</div>
        ${isParent() ? `<button class="small" data-act="newTask" data-id="${p.id}">＋ ${t('addTask')}</button>` : ''}
      </div>`;
  }).join('');

  return `
    ${pointsCard()}
    <div class="toolbar">
      <button class="primary" data-act="newTask">＋ ${t('newTask')}</button>
      ${isParent() ? `<button data-act="newPlan">＋ ${t('newPlan')}</button>
        <button data-act="templatePlan">📋 ${t('fromTemplate')}</button>` : ''}
    </div>
    <h2>${esc(t('myTasks'))}</h2>
    ${mine.length ? `<div class="list">${mine.map(({ task, st }) => taskRow(task, st, { manage: true })).join('')}</div>`
                  : `<p class="empty">${esc(t('noTasks'))}</p>`}
    <h2>${esc(t('familyTasks'))}</h2>
    ${fam.length ? `<div class="list">${fam.map(({ task, st }) => taskRow(task, st, { manage: true })).join('')}</div>`
                 : `<p class="empty">${esc(t('noTasks'))}</p>`}
    ${isParent() ? `<h2>${esc(t('plans'))}</h2>${plans || `<p class="empty">${esc(t('noPlans'))}</p>`}` : ''}
    ${others.length ? `<h2>${esc(t('forOthers'))}</h2><div class="list">${others.map(({ task, st }) => taskRow(task, st, { manage: true })).join('')}</div>` : ''}
    ${isParent() ? upcomingEventTasks(all) : ''}`;
}

// Event tasks that haven't come up yet (they appear above 14 days before their deadline)
function upcomingEventTasks(all) {
  const td = today();
  const rows = all.filter(({ task, st }) => task.recurrence === 'event' && !st.active)
    .map(({ task }) => ({ task, occ: eventOccurrence(task, td) }))
    .filter((x) => x.occ)
    .map((x) => ({ ...x, deadline: addDays(x.occ, -(x.task.days_before || 0)) }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (!rows.length) return '';
  return `<h2>${esc(t('upcomingEventTasks'))}</h2><div class="list">${rows.map(({ task, deadline }) => {
    const ev = S.events.find((e) => e.id === task.event_id);
    return `<div class="row">
      <div class="lead big">${eventIcon(ev?.type)}</div>
      <div class="body"><div class="ttl">${esc(task.title)}</div>
        <div class="meta">${esc(recLabel(task))} · ${esc(t('dueBy', { date: fmtDate(deadline, getLang()) }))}${task.points ? ` · ⭐ ${esc(t('pointsN', task.points))}` : ''}</div></div>
      <button class="icon" data-act="editTask" data-id="${task.id}" aria-label="${t('edit')}">✎</button>
    </div>`;
  }).join('')}</div>`;
}

// preset (optional): { event_id, title, days_before } for a task tied to a calendar event
function taskForm(task, planId, preset = null) {
  const editing = !!task;
  const tk = task || {
    title: '', notes: '', recurrence: planId ? 'daily' : 'once', interval_days: 3,
    start_date: today(), due_date: '', need: 1, open: false, remind_time: '', remind_days_before: 0, points: 0,
    assignees: planId ? children().map((c) => c.user_id) : [],
    roles: planId ? [] : ['all'], plan_id: planId || null, event_id: null, days_before: 0,
    ...(preset ? { recurrence: 'event', assignees: [uid()], roles: [], ...preset } : {}),
  };
  const isEvent = !!tk.event_id;
  const ev = isEvent ? S.events.find((e) => e.id === tk.event_id) : null;
  const kind = editing ? taskKind(tk) : (planId || isEvent ? 'assigned' : 'open');
  const kinds = isParent() ? ['assigned', 'open', 'role'] : ['open', 'role'];
  const assignable = isParent() ? S.members : S.members.filter((m) => m.user_id === uid());
  const recs = ['once', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'];
  openDialog(`
    <form id="taskForm" class="form">
      <h2>${editing ? t('edit') : t('newTask')}</h2>
      ${ev ? `<p class="for-event">${eventIcon(ev.type)} ${esc(ev.title)}</p>` : ''}
      <label>${t('title')}<input name="title" value="${esc(tk.title)}" required></label>
      <label>${t('note')}<input name="notes" value="${esc(tk.notes || '')}"></label>
      <label>${t('taskType')}<select name="kind">${kinds.map((k) =>
        `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(t('tt.' + k))}</option>`).join('')}</select></label>
      <fieldset data-show="assigned"><legend>${t('assignTo')}</legend>${memberCheckboxes('assignees', assignable, tk.assignees)}</fieldset>
      <fieldset data-show="open role"><legend>${t('visibleTo')}</legend>${roleCheckboxes('roles', ITEM_ROLES, tk.roles.length ? tk.roles : ['all'])}</fieldset>
      <label data-show="open">${t('need')}<input name="need" type="number" min="1" max="20" value="${tk.need}"></label>
      ${isParent() ? `<label>⭐ ${t('points')}<input name="points" type="number" min="0" max="1000" value="${tk.points || 0}"></label>
      <p class="hint">${esc(t('pointsHelp'))}</p>` : ''}
      ${isEvent ? `<input type="hidden" name="recurrence" value="event">
      <label>${t('daysBeforeField')}<input name="days_before" type="number" min="0" max="365" value="${tk.days_before || 0}"></label>
      <p class="hint">${esc(t(ev?.every_weeks || tk.event_every_weeks ? 'eventTaskHelpWeekly'
        : ev?.yearly || tk.event_yearly ? 'eventTaskHelpYearly' : 'eventTaskHelp'))}</p>`
      : `<label>${t('recurrence')}<select name="recurrence">${recs.map((r) =>
        `<option value="${r}" ${r === tk.recurrence ? 'selected' : ''}>${esc(t('rec.' + r))}</option>`).join('')}</select></label>`}
      <label data-rec="custom">${t('intervalN')}<input name="interval_days" type="number" min="1" value="${tk.interval_days || 3}"></label>
      <label data-rec="daily weekdays weekly monthly yearly custom">${t('startDate')}<input name="start_date" type="date" value="${tk.start_date}"></label>
      <label data-rec="once">${t('due')}<input name="due_date" type="date" value="${tk.due_date || ''}"></label>
      <fieldset><legend>🔔 ${t('reminder')}</legend>
        <div class="two">
          <label>${t('remindAt')}<input name="remind_time" type="time" value="${esc((tk.remind_time || '').slice(0, 5))}"></label>
          <label>${t('daysBeforeDue')}<input name="remind_days_before" type="number" min="0" max="60" value="${tk.remind_days_before || 0}"></label>
        </div>
        <p class="hint" data-rec="once">${esc(t('reminderHelpOnce'))}</p>
        <p class="hint" data-rec="daily weekdays weekly monthly yearly custom">${esc(t('reminderHelp'))}</p>
        <p class="hint" data-rec="event">${esc(t('reminderHelpEvent'))}</p>
      </fieldset>
      <div class="btns">
        ${editing ? `<button type="button" class="danger" data-act="delTask" data-id="${task.id}">${t('delete')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  const form = document.getElementById('taskForm');
  const sync = () => {
    const k = form.elements.kind.value, r = form.elements.recurrence.value;
    form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(k); });
    form.querySelectorAll('[data-rec]').forEach((el) => { el.hidden = !el.dataset.rec.split(' ').includes(r); });
  };
  form.elements.kind.onchange = sync; form.elements.recurrence.onchange = sync; sync();
  if (!editing && isEvent) form.elements.title.select();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const k = f.get('kind');
    const rec = f.get('recurrence');
    const row = {
      title: f.get('title').trim(), notes: f.get('notes').trim() || null,
      recurrence: rec,
      interval_days: rec === 'custom' ? Number(f.get('interval_days')) : null,
      start_date: f.get('start_date') || today(),
      due_date: rec === 'once' ? (f.get('due_date') || null) : null,
      open: k === 'open', need: k === 'open' ? Number(f.get('need')) || 1 : 1,
      assignees: k === 'assigned' ? f.getAll('assignees') : [],
      roles: k === 'assigned' ? (isParent() ? PARENT : []) : f.getAll('roles'),
      plan_id: tk.plan_id,
      remind_time: f.get('remind_time') || null,
      remind_days_before: Math.min(60, Math.max(0, Number(f.get('remind_days_before')) || 0)),
    };
    if (isEvent) Object.assign(row, {
      event_id: tk.event_id, days_before: Math.min(365, Math.max(0, Number(f.get('days_before')) || 0)),
    });
    // only parents can set points; a child editing keeps whatever was there
    if (isParent()) row.points = Math.min(1000, Math.max(0, Math.round(Number(f.get('points')) || 0)));
    if (!row.title) return toast(t('needTitle'), true);
    if (k === 'assigned' && !row.assignees.length) return toast(t('assignTo') + '?', true);
    if (k !== 'assigned' && !row.roles.length) return toast(t('needRole'), true);
    if (editing) await run(sb.from('tasks').update(row).eq('id', task.id));
    else await run(sb.from('tasks').insert(row));
    closeDialog(); await refresh();
    if (isEvent && ev) eventForm(S.events.find((e) => e.id === ev.id)); // back to the event
  };
}

// Ready-made routines for children (templates.js) -> normal, editable plans
function templateForm() {
  const kids = children();
  const lang = TEMPLATES[getLang()] ? getLang() : 'da';
  openDialog(`
    <form id="tplForm" class="form">
      <h2>📋 ${t('fromTemplate')}</h2>
      <p class="hint">${esc(t('templateHelp'))}</p>
      ${kids.length ? `<fieldset><legend>${t('forChildren')}</legend>${memberCheckboxes('kids', kids, kids.length === 1 ? [kids[0].user_id] : [])}</fieldset>`
        : `<p class="hint">⚠️ ${esc(t('noChildrenYet'))}</p>`}
      <fieldset><legend>${t('ageGroup')}</legend><div class="checks">${AGES.map((a, i) => `
        <label class="check"><input type="radio" name="age" value="${a}" ${i === 1 ? 'checked' : ''}><span>${esc(t('ageN', a))}</span></label>`).join('')}</div></fieldset>
      <fieldset><legend>${t('routines')}</legend><div class="checks">${ROUTINES.map((r) => `
        <label class="check"><input type="checkbox" name="routines" value="${r}" checked><span>${esc(t('routine.' + r))}</span></label>`).join('')}</div></fieldset>
      <div class="two">
        <label>⭐ ${t('pointsPerTask')}<input name="points" type="number" min="0" max="1000" value="1"></label>
        <label class="check tall"><input type="checkbox" name="remind"><span>🔔 ${t('withReminders')}</span></label>
      </div>
      <div id="tplPreview" class="tpl-preview"></div>
      <div class="btns"><span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit" ${kids.length ? '' : 'disabled'}>${t('create')}</button></div>
    </form>`);
  const form = document.getElementById('tplForm');
  const preview = () => {
    const age = Number(new FormData(form).get('age'));
    const chosen = new FormData(form).getAll('routines');
    const remind = form.elements.remind.checked;
    document.getElementById('tplPreview').innerHTML = chosen.map((r) => `
      <div class="tpl-routine"><div class="ttl">${esc(t('routine.' + r))}
        <span class="meta">· ${esc(t('rec.' + ROUTINE_REC[r]))}${remind ? ` · 🔔 ${ROUTINE_TIME[r][age]}` : ''}</span></div>
        <ul>${TEMPLATES[lang][age][r].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
  };
  form.onchange = preview; preview();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const kidIds = f.getAll('kids');
    const age = Number(f.get('age'));
    const chosen = f.getAll('routines');
    const points = Math.min(1000, Math.max(0, Math.round(Number(f.get('points')) || 0)));
    if (!kidIds.length) return toast(t('pickChild'), true);
    if (!chosen.length) return toast(t('pickRoutine'), true);
    if (e.submitter) e.submitter.disabled = true;
    const names = kidIds.map(memberName).join(' & ');
    try {
      for (const r of chosen) {
        const [plan] = await run(sb.from('plans').insert({
          title: `${t('routine.' + r)} – ${names}`, notes: t('templateNote', { age }),
        }).select());
        await run(sb.from('tasks').insert(TEMPLATES[lang][age][r].map((title) => ({
          title, plan_id: plan.id, recurrence: ROUTINE_REC[r], start_date: today(),
          assignees: kidIds, roles: PARENT, open: false, need: 1, points,
          remind_time: f.get('remind') === 'on' ? ROUTINE_TIME[r][age] : null, remind_days_before: 0,
        }))));
      }
      closeDialog(); await refresh();
      toast(t('templateCreated', { n: chosen.length }));
    } catch { if (e.submitter) e.submitter.disabled = false; }
  };
}

function planForm(plan) {
  openDialog(`
    <form id="planForm" class="form">
      <h2>${plan ? t('edit') : t('newPlan')}</h2>
      <label>${t('planName')}<input name="title" value="${esc(plan?.title || '')}" required></label>
      <label>${t('note')}<input name="notes" value="${esc(plan?.notes || '')}"></label>
      <div class="btns">
        ${plan ? `<button type="button" class="danger" data-act="delPlan" data-id="${plan.id}">${t('delete')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  document.getElementById('planForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const row = { title: f.get('title').trim(), notes: f.get('notes').trim() || null };
    if (plan) await run(sb.from('plans').update(row).eq('id', plan.id));
    else {
      const [created] = await run(sb.from('plans').insert(row).select());
      closeDialog(); await refresh();
      return taskForm(null, created.id); // straight on to the first task
    }
    closeDialog(); await refresh();
  };
}

// ------------------------------------------------------------ house

// Latest completion of a task, in any period
function lastDone(task) {
  return S.done.filter((d) => d.task_id === task.id).reduce((a, d) => (!a || d.done_on > a.done_on ? d : a), null);
}
function lastAgo(d) {
  if (!d) return t('house.never');
  const n = daysBetween(d.done_on, today());
  return `${t('house.last')} ${n <= 0 ? t('house.today') : t('daysAgo', n)}`;
}

const houseTask = (placeId, choreId) => S.tasks.find((x) => x.place_id === placeId && x.chore_id === choreId);
const sortOf = (list, id) => byId(list, id)?.sort ?? 0;

function viewHouse() {
  const parent = isParent();
  const mode = parent ? S.houseMode : 'todo';
  const seg = parent ? `<div class="seg house-seg">${['todo', 'setup', 'log'].map((m) =>
    `<button data-act="houseMode" data-id="${m}" class="${mode === m ? 'on' : ''}">${esc(t('house.' + m))}</button>`).join('')}</div>` : '';
  if (parent && !S.places.length && !S.chores.length) {
    return `${seg}<div class="card"><p>${esc(t('house.empty'))}</p>
      <button class="primary" data-act="seedHouse">${t('house.loadDefaults')}</button></div>`;
  }
  const body = mode === 'setup' ? houseSetup() : mode === 'log' ? houseLog() : houseTodo();
  return (mode === 'todo' ? pointsCard() : '') + seg + body;
}

function houseRow(task, st, withPlace = false) {
  const chore = byId(S.chores, task.chore_id);
  const meta = [recLabel(task)];
  if (task.points) meta.push(`⭐ ${t('pointsN', task.points)}`);
  if (st.end && !st.done && task.recurrence !== 'daily') meta.push(t('dueBy', { date: fmtDate(st.end, getLang()) }));
  if (!st.done) { const ld = lastDone(task); meta.push(ld ? `${lastAgo(ld)} (${memberName(ld.done_by)})` : t('house.never')); }
  let acts;
  if (st.done) {
    acts = `<span class="chip yes">✓ ${st.doneRows.map((d) => esc(memberName(d.done_by))).join(', ')}</span>
      ${st.doneByMe ? `<button class="link" data-act="undo" data-id="${task.id}">${t('undo')}</button>` : ''}`;
  } else if (st.took) {
    acts = `<button class="small primary" data-act="done" data-id="${task.id}">${t('house.didIt')}</button>
      <button class="small" data-act="untake" data-id="${task.id}">${t('untake')}</button>`;
  } else if (st.full) {
    acts = `<span class="chip">${t('full')}</span>`;
  } else {
    acts = `<button class="small primary" data-act="houseDone" data-id="${task.id}">${t('house.didIt')}</button>
      <button class="small" data-act="take" data-id="${task.id}">${t('house.illDoIt')}</button>`;
  }
  const takers = !st.done && st.takers.length
    ? `<div class="takers">${esc(t('takenBy'))}: ${st.takers.map((u) => `<span class="chip">${esc(memberName(u))}</span>`).join('')}
       ${task.need > 1 ? `<span class="need">${st.takers.length}/${task.need}</span>` : ''}</div>` : '';
  const where = withPlace ? `<span class="where">${esc(byId(S.places, task.place_id)?.name)}</span> ` : '';
  return `
    <div class="row hrow ${st.done ? 'is-done' : ''}">
      <div class="body">
        <div class="ttl">${where}${esc(chore?.name || task.title)}</div>
        ${task.notes ? `<div class="notes">${esc(task.notes)}</div>` : ''}
        <div class="meta">${meta.map(esc).join(' · ')}</div>
        ${takers}
        <div class="acts">${acts}</div>
      </div>
    </div>`;
}

function houseTodo() {
  const items = S.tasks.filter(isHouse).map((task) => ({ task, st: taskState(task) })).filter((x) => x.st.active);
  if (!items.length) return `<p class="empty">${esc(t(isParent() ? 'house.noneSetUp' : 'house.nothing'))}</p>`;
  const byChore = (a, b) => sortOf(S.chores, a.task.chore_id) - sortOf(S.chores, b.task.chore_id);
  const mineNow = items.filter((x) => x.st.took && !x.st.done);
  const open = items.filter((x) => !x.st.took && !x.st.done);
  const doneNow = items.filter((x) => x.st.done);

  const placeCards = (outdoor) => S.places.filter((p) => p.outdoor === outdoor).map((p) => {
    const rows = open.filter((x) => x.task.place_id === p.id).sort(byChore);
    if (!rows.length) return '';
    return `<div class="card place"><h3>${esc(p.name)}</h3>
      <div class="list">${rows.map(({ task, st }) => houseRow(task, st)).join('')}</div></div>`;
  }).join('');
  const inside = placeCards(false), outside = placeCards(true);
  const withPlace = (list) => list.map(({ task, st }) => houseRow(task, st, true)).join('');

  return `
    ${mineNow.length ? `<h2>${esc(t('house.mineNow'))}</h2><div class="list">${withPlace(mineNow)}</div>` : ''}
    ${!inside && !outside ? `<p class="allgood">${esc(t('house.nothing'))}</p>` : ''}
    ${inside ? `<h2>🏠 ${esc(t('house.indoor'))}</h2>${inside}` : ''}
    ${outside ? `<h2>🌳 ${esc(t('house.outdoor'))}</h2>${outside}` : ''}
    ${doneNow.length ? `<details><summary>${esc(t('house.doneNow'))} (${doneNow.length})</summary>
      <div class="list">${withPlace(doneNow)}</div></details>` : ''}`;
}

function houseSetup() {
  const section = (outdoor) => {
    const places = S.places.filter((p) => p.outdoor === outdoor);
    const chores = S.chores.filter((c) => c.outdoor === outdoor);
    const io = outdoor ? 'out' : 'in';
    return `
      <h2>${outdoor ? '🌳' : '🏠'} ${esc(t('house.' + (outdoor ? 'outdoor' : 'indoor')))}</h2>
      <div class="card">
        <h3>${esc(t('house.choreTypes'))}</h3>
        <div class="hchips">${chores.map((c) =>
          `<button class="hchip type" data-act="editChoreType" data-id="${c.id}">${esc(c.name)} ✎</button>`).join('')}
          <button class="hchip add" data-act="addChoreType" data-id="${io}">＋ ${t('house.addChore')}</button></div>
      </div>
      ${places.map((p) => `
        <div class="card place">
          <div class="plan-head"><h3>${esc(p.name)}</h3>
            <button class="icon" data-act="editPlace" data-id="${p.id}" aria-label="${t('edit')}">✎</button></div>
          <div class="hchips">${chores.map((c) => {
            const tk = houseTask(p.id, c.id);
            return `<button class="hchip ${tk ? 'on' : ''}" data-act="setChore" data-id="${p.id}|${c.id}">
              ${esc(c.name)}${tk ? ` · ${esc(recLabel(tk))}${tk.need > 1 ? ` · ${tk.need}👤` : ''}${tk.points ? ` · ⭐${tk.points}` : ''}
              <small class="last">${esc(lastAgo(lastDone(tk)))}</small>` : ''}</button>`;
          }).join('') || `<span class="hint">${esc(t('house.noTypes'))}</span>`}</div>
        </div>`).join('')}
      <button class="add-place" data-act="addPlace" data-id="${io}">＋ ${t('house.addPlace')}</button>`;
  };
  return `<p class="hint">${esc(t('house.setupHelp'))}</p>${section(false)}${section(true)}`;
}

function houseLog() {
  const ids = new Set(S.tasks.filter(isHouse).map((x) => x.id));
  const since = isoMinus(30);
  const rows = S.done.filter((d) => ids.has(d.task_id) && d.done_on >= since)
    .sort((a, b) => b.done_on.localeCompare(a.done_on) || String(b.created_at).localeCompare(String(a.created_at)));
  if (!rows.length) return `<p class="empty">${esc(t('house.noLog'))}</p>`;
  const counts = {};
  rows.forEach((d) => { counts[d.done_by] = (counts[d.done_by] || 0) + 1; });
  const tally = Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([u, n]) => `<span class="chip yes">${esc(memberName(u))}: ${n}</span>`).join('');
  return `
    <h2>${esc(t('house.last30'))}</h2>
    <div class="card"><div>${tally}</div></div>
    <div class="list">${rows.map((d) => `
      <div class="row"><div class="body">
        <div class="ttl">${esc(taskTitle(byId(S.tasks, d.task_id)))}</div>
        <div class="meta">${esc(fmtDate(d.done_on, getLang()))} · ${esc(memberName(d.done_by))}</div>
      </div></div>`).join('')}</div>`;
}

// Set how often a chore is done in a room (or switch it off)
function choreSetForm(placeId, choreId) {
  const p = byId(S.places, placeId), c = byId(S.chores, choreId);
  const tk = houseTask(placeId, choreId);
  const recs = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'custom', 'yearly'];
  const cur = tk ? tk.recurrence : 'weekly';
  const on = 'daily weekdays weekly monthly custom yearly';
  openDialog(`
    <form id="choreForm" class="form">
      <h2>${esc(c.name)} – ${esc(p.name)}</h2>
      <label>${t('recurrence')}<select name="recurrence">${recs.map((r) =>
        `<option value="${r}" ${r === cur ? 'selected' : ''}>${esc(r === 'none' ? t('house.off') : t('rec.' + r))}</option>`).join('')}</select></label>
      <label data-rec="custom">${t('intervalN')}<input name="interval_days" type="number" min="1" value="${tk?.interval_days || 14}"></label>
      <label data-rec="${on}">${t('need')}<input name="need" type="number" min="1" max="20" value="${tk?.need || 1}"></label>
      <label data-rec="${on}">⭐ ${t('points')}<input name="points" type="number" min="0" max="1000" value="${tk?.points || 0}"></label>
      <label data-rec="${on}">${t('note')}<input name="notes" value="${esc(tk?.notes || '')}"></label>
      <div class="btns"><span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button></div>
    </form>`);
  const form = document.getElementById('choreForm');
  const sync = () => {
    const r = form.elements.recurrence.value;
    form.querySelectorAll('[data-rec]').forEach((el) => { el.hidden = !el.dataset.rec.split(' ').includes(r); });
  };
  form.elements.recurrence.onchange = sync; sync();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const rec = f.get('recurrence');
    if (rec === 'none') {
      if (tk) await run(sb.from('tasks').delete().eq('id', tk.id));
    } else {
      const row = {
        title: `${c.name} – ${p.name}`, notes: f.get('notes').trim() || null,
        recurrence: rec, interval_days: rec === 'custom' ? Math.max(1, Number(f.get('interval_days')) || 1) : null,
        need: Math.min(20, Math.max(1, Number(f.get('need')) || 1)),
        points: Math.min(1000, Math.max(0, Math.round(Number(f.get('points')) || 0))),
        open: true, roles: HOUSE_ROLES, assignees: [], place_id: placeId, chore_id: choreId,
      };
      // keep the start date when only the details change, so periods don't shift
      if (!tk || tk.recurrence !== rec || tk.interval_days !== row.interval_days) row.start_date = today();
      if (tk) await run(sb.from('tasks').update(row).eq('id', tk.id));
      else await run(sb.from('tasks').insert(row));
    }
    closeDialog(); await refresh();
  };
}

// Add/rename/move/delete a room (house_places) or a chore type (house_chores)
function houseItemForm(table, item, outdoor) {
  const isPlace = table === 'house_places';
  const out = item ? item.outdoor : outdoor;
  openDialog(`
    <form id="houseItemForm" class="form">
      <h2>${item ? t('edit') : t(isPlace ? 'house.addPlace' : 'house.addChore')}</h2>
      <label>${t('house.name')}<input name="name" value="${esc(item?.name || '')}" required></label>
      <label>${t('house.where')}<select name="outdoor">
        <option value="in" ${out ? '' : 'selected'}>${esc(t('house.indoor'))}</option>
        <option value="out" ${out ? 'selected' : ''}>${esc(t('house.outdoor'))}</option></select></label>
      ${item && isPlace ? `<p class="hint">${esc(t('house.moveHint'))}</p>` : ''}
      <div class="btns">
        ${item ? `<button type="button" class="danger" data-act="delHouseItem" data-id="${table}|${item.id}">${t('delete')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  document.getElementById('houseItemForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const row = { name: f.get('name').trim(), outdoor: f.get('outdoor') === 'out' };
    if (!row.name) return;
    if (item) await run(sb.from(table).update(row).eq('id', item.id));
    else {
      const list = isPlace ? S.places : S.chores;
      row.sort = list.reduce((m, x) => Math.max(m, x.sort), 0) + 1;
      await run(sb.from(table).insert(row));
    }
    closeDialog(); await refresh();
  };
}

// ------------------------------------------------------------ moments

const entriesOf = (id) => S.entries.filter((e) => e.tracker_id === id);
const FAMILY_KINDS = ['vacation', 'takeaway', 'restaurant', 'movie', 'weekend', 'themepark'];
const COUPLE_KINDS = ['flowers', 'surprise', 'date', 'trip'];
const KIND_ICON = { vacation: '🏖️', takeaway: '🥡', restaurant: '🍽️', movie: '🎬', weekend: '🧳', themepark: '🎢', custom: '⭐' };
const isFamilyMoment = (tr) => tr.roles.includes('all');
const canEditMoment = (tr) => !isFamilyMoment(tr) || isParent();
// The planned next time, while it is today or later
const plannedAhead = (tr) => (tr.planned_on && tr.planned_on >= today() ? tr.planned_on : null);

function plannedRow(tr) {
  const n = daysBetween(today(), tr.planned_on);
  return `
    <div class="row event" data-act="tab" data-id="moments">
      <div class="lead big">${KIND_ICON[tr.kind] || '💛'}</div>
      <div class="body"><div class="ttl">${esc(tr.title)}${tr.plan_note ? ` · ${esc(tr.plan_note)}` : ''}</div>
        <div class="meta">${esc(fmtDate(tr.planned_on, getLang()))} · <strong>${esc(n === 0 ? t('isToday') : t('inDays', n))}</strong></div></div>
    </div>`;
}

function ideaFor(tr) {
  const list = IDEAS[getLang()][tr.kind] || IDEAS[getLang()].custom;
  const base = daysBetween('2026-01-01', today()) + tr.id.charCodeAt(0);
  return list[(base + (S.ideaShift[tr.id] || 0)) % list.length];
}

function momentCard(tr, st, compact = false) {
  const fam = isFamilyMoment(tr);
  const plan = plannedAhead(tr);
  const lastTxt = st.last ? `${t('lastDone')}: ${fmtDate(st.last, getLang())} (${t('daysAgo', st.since)})` : t('never');
  const dueTxt = plan ? (plan === today() ? t('plannedToday') : t('plannedIn', daysBetween(today(), plan)))
    : st.dueIn < 0 ? t('overdueBy', -st.dueIn) : st.dueIn === 0 ? t('dueToday') : t('dueIn', st.dueIn);
  const due = st.dueIn <= 0 && !plan;
  const pct = st.last ? Math.min(100, Math.round((st.since / tr.interval_days) * 100)) : 100;
  const hist = entriesOf(tr.id).slice(0, 5);
  const editable = canEditMoment(tr);
  return `
    <div class="card moment kind-${tr.kind} ${fam ? 'family' : ''} ${due ? 'due' : ''}">
      <div class="m-head">
        <div><h3>${fam ? `<span class="kicon">${KIND_ICON[tr.kind] || '⭐'}</span>` : ''}${esc(tr.title)}</h3>
          <div class="meta">${fam ? esc(t('wholeFamily')) : roleChips(tr.roles)} · ${esc(t('every', tr.interval_days))}</div></div>
        ${compact || !editable ? '' : `<button class="icon" data-act="editMoment" data-id="${tr.id}" aria-label="${t('edit')}">✎</button>`}
      </div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="meta">${esc(lastTxt)} · <strong>${esc(dueTxt)}</strong></div>
      ${tr.planned_on ? `<div class="planline">📅 ${esc(t('planned'))}: <strong>${esc(fmtDate(tr.planned_on, getLang()))}</strong>${tr.plan_note ? ` – ${esc(tr.plan_note)}` : ''}</div>` : ''}
      ${due ? `<div class="idea">💡 ${esc(ideaFor(tr))}
        <button class="link" data-act="idea" data-id="${tr.id}">${t('anotherIdea')}</button></div>` : ''}
      <div class="acts">
        <button class="primary" data-act="logMoment" data-id="${tr.id}">${t('logIt')}</button>
        <button data-act="logOther" data-id="${tr.id}">${t('logOther')}</button>
        ${editable && !compact ? `<button data-act="planMoment" data-id="${tr.id}">📅 ${t(tr.planned_on ? 'changePlan' : 'plan')}</button>` : ''}
      </div>
      ${!compact && hist.length ? `<details><summary>${t('history')}</summary><ul class="hist">${hist.map((e) => `
        <li>${fmtDate(e.done_on, getLang())} ${t('by')} ${esc(memberName(e.done_by))}${e.note ? ` – ${esc(e.note)}` : ''}
        ${e.done_by === uid() ? `<button class="link" data-act="delEntry" data-id="${e.id}">${t('delete')}</button>` : ''}</li>`).join('')}
      </ul></details>` : ''}
    </div>`;
}

function viewMoments() {
  const td = today();
  const order = (x) => (plannedAhead(x.tr) ? 100000 + daysBetween(td, x.tr.planned_on) : x.st.dueIn);
  const items = S.trackers
    .map((tr) => ({ tr, st: trackerStatus(tr.interval_days, entriesOf(tr.id).map((e) => e.done_on), td) }))
    .sort((a, b) => order(a) - order(b));
  const fam = items.filter((x) => isFamilyMoment(x.tr)).map(({ tr, st }) => momentCard(tr, st)).join('');
  const own = items.filter((x) => !isFamilyMoment(x.tr)).map(({ tr, st }) => momentCard(tr, st)).join('');
  return `<div class="toolbar">
      ${isParent() ? `<button class="primary" data-act="newFamilyMoment">＋ ${t('newFamilyMoment')}</button>` : ''}
      <button class="${isParent() ? '' : 'primary'}" data-act="newMoment">＋ ${t('newMoment')}</button></div>
    ${fam ? `<h2>👨‍👩‍👧‍👦 ${esc(t('momentsFamily'))}</h2>${fam}` : ''}
    ${own ? `<h2>💛 ${esc(t('momentsOwn'))}</h2>${own}` : ''}
    ${!fam && !own ? `<p class="empty">${esc(t('noMoments'))}</p>` : ''}
    ${ideasSection()}`;
}

// ------------------------------------------------------------ ideas for the two of you
// Experiences, restaurant deals and getaways, kept up to date by a weekly job.

const fmtDrive = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} t${m ? ` ${m} min` : ''}` : `${m} min`;
};

function ideasSection() {
  if (!S.suggestions.length) return '';
  const kinds = ['event', 'restaurant', 'getaway'];
  const icons = { event: '🎭', restaurant: '🍽️', getaway: '🧳' };
  const list = S.suggestions.filter((x) => x.kind === S.ideaTab)
    .sort((a, b) => S.ideaTab === 'getaway'
      ? (a.needs_flight - b.needs_flight) || ((a.drive_minutes ?? 9999) - (b.drive_minutes ?? 9999))
      : (a.starts_on || '9999').localeCompare(b.starts_on || '9999') || a.title.localeCompare(b.title));
  const checked = S.suggestions.map((x) => x.checked_on).sort().pop();
  return `
    <h2>💡 ${esc(t('ideasTitle'))}</h2>
    <p class="hint">${esc(t('ideasHelp'))}</p>
    <div class="seg ideas-seg">${kinds.map((k) => `
      <button data-act="ideaTab" data-id="${k}" class="${S.ideaTab === k ? 'on' : ''}">${icons[k]} ${esc(t('ideaKind.' + k))}
        <small>${S.suggestions.filter((x) => x.kind === k).length}</small></button>`).join('')}</div>
    <div class="list ideas">${list.map(ideaCard).join('') || `<p class="empty">${esc(t('noIdeas'))}</p>`}</div>
    ${checked ? `<p class="hint">${esc(t('ideasUpdated', { date: fmtDate(checked, getLang()) }))}</p>` : ''}`;
}

function ideaCard(x) {
  const L = getLang();
  const when = x.starts_on
    ? (x.ends_on && x.ends_on !== x.starts_on ? `${fmtDate(x.starts_on, L)} – ${fmtDate(x.ends_on, L)}` : fmtDate(x.starts_on, L))
    : x.ends_on ? t('until', { date: fmtDate(x.ends_on, L) }) : '';
  const travel = x.needs_flight ? `✈️ ${t('byPlane')}`
    : x.drive_minutes != null ? `🚗 ${t('driveApprox', { time: fmtDrive(x.drive_minutes) })}` : '';
  return `
    <div class="card idea-card">
      <div class="idea-head">
        <h3>${esc(x.title)}</h3>
        ${travel ? `<span class="travel ${x.needs_flight ? 'fly' : ''}">${esc(travel)}</span>` : ''}
      </div>
      <div class="meta">${[x.place, when].filter(Boolean).map(esc).join(' · ')}</div>
      ${x.price ? `<div class="deal">${esc(x.price)}</div>` : ''}
      ${x.description ? `<p class="notes">${esc(x.description)}</p>` : ''}
      ${x.travel_note ? `<p class="hint">${esc(x.travel_note)}</p>` : ''}
      <div class="acts">
        <a class="btnlink primary-link" href="${esc(x.url)}" target="_blank" rel="noopener">${t('seeOffer')} ↗</a>
        <button type="button" class="small" data-act="ideaToCalendar" data-id="${x.id}">📅 ${t('toCalendar')}</button>
      </div>
      ${x.source ? `<div class="src">${esc(t('source'))}: ${esc(x.source)}</div>` : ''}
    </div>`;
}

function momentForm(tr, family = false) {
  const m = tr || (family ? { title: '', kind: 'vacation', roles: ['all'], interval_days: 90 }
    : { title: '', kind: 'custom', roles: myRoles().length ? [...myRoles()] : ['all'], interval_days: 30 });
  const famNow = m.roles.includes('all');
  const kinds = famNow ? [...FAMILY_KINDS, 'custom', ...COUPLE_KINDS] : [...COUPLE_KINDS, 'custom', ...FAMILY_KINDS];
  const roleList = isParent() ? ITEM_ROLES : ROLES; // only parents make whole-family moments
  openDialog(`
    <form id="momentForm" class="form">
      <h2>${tr ? t('edit') : t(family ? 'newFamilyMoment' : 'newMoment')}</h2>
      <label>${t('title')}<input name="title" value="${esc(m.title)}" required></label>
      <label>${t('kind')}<select name="kind">${kinds.map((k) =>
        `<option value="${k}" ${k === m.kind ? 'selected' : ''}>${esc((famNow && KIND_ICON[k] ? KIND_ICON[k] + ' ' : '') + t('kinds.' + k))}</option>`).join('')}</select></label>
      <label>${t('intervalDays')}<input name="interval_days" type="number" min="1" value="${m.interval_days}" required></label>
      <fieldset><legend>${t('visibleTo')}</legend>${roleCheckboxes('roles', roleList, m.roles)}</fieldset>
      <div class="btns">
        ${tr ? `<button type="button" class="danger" data-act="delMoment" data-id="${tr.id}">${t('delete')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  document.getElementById('momentForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const row = { title: f.get('title').trim(), kind: f.get('kind'),
      interval_days: Number(f.get('interval_days')), roles: f.getAll('roles') };
    if (!row.roles.length) return toast(t('needRole'), true);
    if (tr) await run(sb.from('trackers').update(row).eq('id', tr.id));
    else await run(sb.from('trackers').insert(row));
    closeDialog(); await refresh();
  };
  if (!tr) {
    const f = document.getElementById('momentForm');
    f.elements.kind.onchange = () => { if (!f.elements.title.dataset.typed) f.elements.title.value = t('kinds.' + f.elements.kind.value); };
    f.elements.title.oninput = () => { f.elements.title.dataset.typed = '1'; };
    if (family) f.elements.title.value = t('kinds.' + m.kind);
  }
}

// Plan the next time: a date and a note (e.g. "Legoland" or "Mallorca")
function momentPlanForm(tr) {
  const h = t('planNoteHint.' + tr.kind);
  const hint = h.startsWith('planNoteHint') ? '' : h;
  openDialog(`
    <form id="momentPlanForm" class="form">
      <h2>📅 ${esc(tr.title)}</h2>
      <label>${t('date')}<input name="planned_on" type="date" min="${today()}" value="${tr.planned_on || ''}" required></label>
      <label>${t('planNote')}<input name="plan_note" value="${esc(tr.plan_note || '')}" placeholder="${esc(hint)}"></label>
      <div class="btns">
        ${tr.planned_on ? `<button type="button" class="danger" data-act="clearPlan" data-id="${tr.id}">${t('removePlan')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  document.getElementById('momentPlanForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await run(sb.from('trackers').update({ planned_on: f.get('planned_on'), plan_note: f.get('plan_note').trim() || null }).eq('id', tr.id));
    closeDialog(); toast('📅'); await refresh();
  };
}

function logOtherForm(trId) {
  openDialog(`
    <form id="logForm" class="form">
      <h2>${t('logOther')}</h2>
      <label>${t('date')}<input name="done_on" type="date" value="${today()}" max="${today()}" required></label>
      <label>${t('note')}<input name="note"></label>
      <div class="btns"><span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button></div>
    </form>`);
  document.getElementById('logForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await run(sb.from('tracker_entries').insert({ tracker_id: trId, done_on: f.get('done_on'), note: f.get('note').trim() || null }));
    closeDialog(); toast('💛'); await refresh();
  };
}

// ------------------------------------------------------------ calendar

function eventRow(ev, st) {
  const when = st.ongoing ? t('ongoing') : st.days === 0 ? t('isToday') : st.days > 0 ? t('inDays', st.days) : '';
  const range = ev.every_weeks ? weeklyLabel(ev, st)
    : ev.end_date ? `${fmtDate(ev.start_date, getLang())} – ${fmtDate(ev.end_date, getLang())}` : fmtDate(st.date, getLang());
  const nTasks = isParent() ? S.tasks.filter((x) => x.event_id === ev.id).length : 0;
  // imported birthdays have no known first year, so no "N years"
  const years = ev.yearly && !ev.imported && st.years > 0 ? ` · ${esc(t('years', st.years))}` : '';
  return `
    <div class="row event" data-act="editEvent" data-id="${ev.id}">
      <div class="lead big">${eventIcon(ev.type)}</div>
      <div class="body"><div class="ttl">${esc(ev.title)}${years}</div>
        <div class="meta">${esc(range)}${when ? ` · <strong>${esc(when)}</strong>` : ''}${ev.imported ? ' · 📱' : ''}${nTasks ? ` · ✅ ${esc(t('nTasks', nTasks))}` : ''}</div></div>
    </div>`;
}

// "Hver mandag · næste 16. nov."
function weeklyLabel(ev, st) {
  const lang = getLang();
  const day = new Date(`${ev.start_date}T12:00:00Z`).toLocaleDateString({ da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[lang] || 'da-DK', { weekday: 'long', timeZone: 'UTC' });
  const every = t(ev.every_weeks === 2 ? 'every2Weekday' : 'everyWeekday', { d: day });
  const done = st.days < 0;
  return `${every} · ${t(done ? 'ended' : 'nextOn', { d: fmtDate(st.date, lang) })}`;
}

function viewCalendar() {
  const td = today();
  const all = S.events.map((ev) => ({ ev, st: eventStatus(ev, td) }));
  // weekly series (lessons etc.) get their own folded section, so they don't crowd the list
  const weekly = all.filter(({ ev, st }) => ev.every_weeks && st.days >= 0).sort((a, b) => a.st.days - b.st.days);
  const list = all.filter((x) => !weekly.includes(x));
  const future = list.filter(({ ev, st }) => st.ongoing || st.days >= 0 || (ev.end_date && ev.end_date >= td))
    .sort((a, b) => a.st.days - b.st.days);
  const past = list.filter((x) => !future.includes(x)).sort((a, b) => b.st.date.localeCompare(a.st.date));
  const syncHint = isParent() && !S.sync?.last_sync_at
    ? `<p class="hint">📱 ${esc(t('calSyncHint'))} <button class="link" data-act="tab" data-id="family">${t('tabs.family')} →</button></p>` : '';
  return `<div class="toolbar"><button class="primary" data-act="newEvent">＋ ${t('newEvent')}</button></div>
    ${isParent() && S.events.length ? `<p class="hint">${esc(t('tapEventForTasks'))}</p>` : ''}
    ${future.length ? `<div class="list">${future.map(({ ev, st }) => eventRow(ev, st)).join('')}</div>` : `<p class="empty">${esc(t('noEvents'))}</p>`}
    ${weekly.length ? `<details class="weekly"><summary>🔁 ${esc(t('weeklyEvents'))} (${weekly.length})</summary><div class="list">${weekly.map(({ ev, st }) => eventRow(ev, st)).join('')}</div></details>` : ''}
    ${syncHint}
    ${past.length ? `<details><summary>${t('history')}</summary><div class="list">${past.map(({ ev, st }) => eventRow(ev, st)).join('')}</div></details>` : ''}`;
}

// Tasks attached to an event + quick suggestions (parents)
function eventTasksSection(ev) {
  if (!ev || !isParent()) return '';
  const list = S.tasks.filter((x) => x.event_id === ev.id);
  const sugg = (EVENT_TASKS[getLang()] || EVENT_TASKS.da)[ev.type] || [];
  return `
    <fieldset class="ev-tasks"><legend>✅ ${t('eventTasks')}</legend>
      ${list.length ? `<div class="list">${list.map((x) => `
        <button type="button" class="ev-task" data-act="editTask" data-id="${x.id}">
          <span class="ttl">${esc(x.title)}</span>
          <span class="meta">${esc(recLabel(x))}${x.assignees?.length ? ` · ${esc(x.assignees.map(memberName).join(', '))}` : ''}${x.remind_time ? ` · 🔔 ${esc(x.remind_time.slice(0, 5))}` : ''}${x.points ? ` · ⭐ ${x.points}` : ''}</span>
        </button>`).join('')}</div>` : `<p class="hint">${esc(t('noEventTasks'))}</p>`}
      <div class="sugg">${sugg.map(([title, days], i) => `
        <button type="button" class="chip-btn" data-act="newEventTask" data-id="${ev.id}|${i}">＋ ${esc(title)} <small>${esc(t('daysBefore', days))}</small></button>`).join('')}
        <button type="button" class="chip-btn" data-act="newEventTask" data-id="${ev.id}|">＋ ${t('otherTask')}</button>
      </div>
    </fieldset>`;
}

function eventForm(ev, preset = null) {
  const e0 = ev || { type: 'vacation', title: '', start_date: today(), end_date: '', yearly: false, remind_days: 14, roles: ['all'], ...preset };
  const fixed = !!ev?.imported; // title and dates come from the phone
  openDialog(`
    <form id="eventForm" class="form">
      <h2>${ev ? `${eventIcon(ev.type)} ${esc(ev.title)}` : t('newEvent')}</h2>
      ${eventTasksSection(ev)}
      ${fixed ? `<p class="hint">📱 ${esc(t('fromPhone'))}</p>` : ''}
      <label>${t('kind')}<select name="type">${['vacation', 'anniversary', 'birthday', 'other'].map((k) =>
        `<option value="${k}" ${k === e0.type ? 'selected' : ''}>${esc(t('types.' + k))}</option>`).join('')}</select></label>
      <label>${t('title')}<input name="title" value="${esc(e0.title)}" required ${fixed ? 'disabled' : ''}></label>
      <div class="two"><label>${t('start')}<input name="start_date" type="date" value="${e0.start_date}" required ${fixed ? 'disabled' : ''}></label>
        <label>${t('end')}<input name="end_date" type="date" value="${e0.end_date || ''}" ${fixed ? 'disabled' : ''}></label></div>
      <label class="check"><input type="checkbox" name="yearly" ${e0.yearly ? 'checked' : ''} ${fixed ? 'disabled' : ''}><span>${t('yearly')}</span></label>
      <label>${t('remindBefore')}<input name="remind_days" type="number" min="0" value="${e0.remind_days}"></label>
      <fieldset><legend>${t('visibleTo')}</legend>${roleCheckboxes('roles', ITEM_ROLES, e0.roles)}</fieldset>
      <div class="btns">
        ${ev && !fixed ? `<button type="button" class="danger" data-act="delEvent" data-id="${ev.id}">${t('delete')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  const form = document.getElementById('eventForm');
  form.elements.type.onchange = () => {
    if (!fixed) form.elements.yearly.checked = ['anniversary', 'birthday'].includes(form.elements.type.value);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const row = { type: f.get('type'), remind_days: Number(f.get('remind_days')) || 0, roles: f.getAll('roles') };
    if (!fixed) Object.assign(row, { title: f.get('title').trim(), start_date: f.get('start_date'),
      end_date: f.get('end_date') || null, yearly: f.get('yearly') === 'on' });
    if (row.end_date && row.end_date < row.start_date) row.end_date = row.start_date;
    if (!row.roles.length) return toast(t('needRole'), true);
    if (ev) { await run(sb.from('events').update(row).eq('id', ev.id)); closeDialog(); await refresh(); return; }
    const [created] = await run(sb.from('events').insert(row).select());
    closeDialog(); await refresh();
    if (isParent() && created) eventForm(S.events.find((x) => x.id === created.id)); // straight on to tasks
  };
}

// ------------------------------------------------------------ family

function viewFamily() {
  const admin = S.me.is_admin;
  return `
    ${loginCodeSection()}
    <h2>✉️ ${esc(t('inviteTitle'))}</h2>
    <div class="card invite">
      <p class="meta">${esc(t('inviteHelp', { family: S.family.name }))}</p>
      <div class="code invite-code">${esc(S.family.invite_code)}</div>
      <p class="hint">${esc(t('inviteNotLogin'))}</p>
      ${admin ? `<button class="small" data-act="newCode">${t('newInviteCode')}</button>` : ''}
    </div>
    <h2>${esc(t('members'))}</h2>
    <div class="list">${S.members.map((m) => `
      <div class="row">
        <div class="lead big">${m.roles.includes('child') ? '🧒' : '🧑'}</div>
        <div class="body"><div class="ttl">${esc(m.display_name)}${m.user_id === uid() ? ` (${t('you')})` : ''}
          ${m.is_admin ? `<span class="chip">${t('admin')}</span>` : ''}</div>
          <div class="meta">${roleChips(m.roles)}</div></div>
        ${admin ? `<button class="icon" data-act="editMember" data-id="${m.user_id}" aria-label="${t('editRoles')}">✎</button>` : ''}
      </div>`).join('')}</div>
    ${admin ? '' : `<p class="hint">${esc(t('adminOnly'))}</p>`}
    <h2>${esc(t('myName'))}</h2>
    <form class="inline" id="nameForm"><input name="name" value="${esc(S.me.display_name)}" required>
      <button type="submit">${t('save')}</button></form>
    ${pushSection()}
    ${calendarSection()}
    <h2>${esc(t('language'))}</h2>
    ${langPicker()}
    <button class="link out" data-act="signOut">${t('signOut')}</button>`;
}

// A short code that signs this account in on another device (valid 10 minutes, once)
function loginCodeSection() {
  const lc = S.loginCode && new Date(S.loginCode.expires_at) > new Date() ? S.loginCode : null;
  const until = lc ? new Date(lc.expires_at).toLocaleTimeString(
    { da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[getLang()], { hour: '2-digit', minute: '2-digit' }) : '';
  return `
    <h2>📲 ${esc(t('otherDevice'))}</h2>
    <div class="card">
      ${lc ? `
        <div class="code login-code">${esc(lc.code.slice(0, 4))}-${esc(lc.code.slice(4))}</div>
        <p class="meta">${esc(t('loginCodeValid', { time: until }))}</p>
        <p class="hint">${esc(t('loginCodeHow'))}</p>
        <button type="button" class="small" data-act="makeLoginCode">${t('newLoginCode')}</button>`
      : `<p class="meta">${esc(t('otherDeviceHelp'))}</p>
        <button type="button" class="primary" data-act="makeLoginCode">${t('makeLoginCode')}</button>`}
    </div>`;
}

// Step-by-step page (kalender-guide.html); the sync code travels in the #fragment, which is never sent to a server
const shortcutGuide = (token) => `kalender-guide.html#kode=${encodeURIComponent(token || '')}`;

// Parents: personal sync code for the iPhone Shortcut, and which phone calendars to import
function calendarSection() {
  if (!isParent()) return '';
  const s = S.sync;
  const when = s?.last_sync_at ? new Date(s.last_sync_at).toLocaleString(
    { da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[getLang()], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return `
    <h2>📱 ${esc(t('calSync'))}</h2>
    <div class="card cal-sync">
      <p class="meta">${esc(t('calSyncHelp'))}</p>
      ${s ? `
        <label>${t('yourCode')}<div class="copyrow"><input class="mono" value="${esc(s.token)}" readonly>
          <button type="button" class="small primary" data-act="copyCode">${t('copy')}</button></div></label>
        <p class="meta">${s.last_sync_at ? `${esc(t('lastSync'))}: ${esc(when)}<br>${esc(s.last_result || '')}` : esc(t('notSynced'))}</p>
        ${S.calendars.length ? `<div class="cal-list"><div class="cal-head"><span>${esc(t('calendars'))}</span>
            <span>${esc(t('calInclude'))}</span><span>${esc(t('calYearly'))}</span></div>
          ${S.calendars.map((c) => `<div class="cal-row">
            <span class="cal-name">${esc(c.name)}</span>
            <button type="button" class="switch ${c.included ? 'on' : ''}" data-act="calToggle" data-id="${c.id}|included"
              role="switch" aria-checked="${c.included}" aria-label="${esc(t('calInclude'))} ${esc(c.name)}"></button>
            <button type="button" class="switch ${c.yearly ? 'on' : ''}" data-act="calToggle" data-id="${c.id}|yearly"
              role="switch" aria-checked="${c.yearly}" aria-label="${esc(t('calYearly'))} ${esc(c.name)}" ${c.included ? '' : 'disabled'}></button>
          </div>`).join('')}</div>
          <p class="hint">${esc(t('calListHelp'))}</p>` : ''}
        <div class="acts">
          <a class="btnlink primary-link" href="${shortcutGuide(s.token)}" target="_blank" rel="noopener">📖 ${t('howTo')}</a>
          <button type="button" class="small" data-act="newSyncCode">${t('newSyncCode')}</button>
        </div>`
      : `<button type="button" class="primary" data-act="makeSyncCode">${t('makeCode')}</button>`}
    </div>`;
}

function memberForm(m) {
  openDialog(`
    <form id="memberForm" class="form">
      <h2>${esc(m.display_name)}</h2>
      <fieldset><legend>${t('editRoles')}</legend>${roleCheckboxes('roles', ROLES, m.roles)}</fieldset>
      <label class="check"><input type="checkbox" name="admin" ${m.is_admin ? 'checked' : ''} ${m.user_id === uid() ? 'disabled' : ''}>
        <span>${t('admin')}</span></label>
      <div class="btns">
        ${m.user_id !== uid() ? `<button type="button" class="danger" data-act="delMember" data-id="${m.user_id}">${t('remove')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  document.getElementById('memberForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await run(sb.rpc('set_member_roles', { p_user: m.user_id, p_roles: f.getAll('roles'),
      p_admin: m.user_id === uid() ? null : f.get('admin') === 'on' }));
    closeDialog(); await refresh();
  };
}

// ------------------------------------------------------------ dialog

function openDialog(html) {
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { if (dialog.open) dialog.close(); dialog.innerHTML = ''; }

// ------------------------------------------------------------ actions

const byId = (list, id, key = 'id') => list.find((x) => x[key] === id);

const ACTIONS = {
  tab: (id) => { S.tab = id; render(); window.scrollTo(0, 0); },
  lang: (id) => {
    store('hl-lang', id); setLang(id); render();
    if (S.pushOn) subscribePush().catch(() => {}); // notifications follow the language
  },
  pushEnable: async () => {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { render(); return toast(t('pushBlocked'), true); }
    try { await subscribePush(); } catch (e) { console.error(e); return toast(`${t('error')}: ${e.message}`, true); }
    toast(t('pushEnabled')); render();
  },
  pushTest: async () => {
    const { data, error } = await sb.functions.invoke('remind', { body: { test: true } });
    if (error) { console.error(error); return toast(`${t('error')}: ${error.message}`, true); }
    toast(data?.sent ? t('testSent') : t('testNone'), !data?.sent);
  },
  otherEmail: () => { S.authStep = 'email'; render(); },
  useLoginCode: () => { S.authStep = 'login'; render(); },
  makeLoginCode: async () => {
    S.loginCode = await run(sb.rpc('create_login_code'));
    render();
  },
  setupMode: (id) => { S.setupMode = id; render(); },
  signOut: async () => { await sb.auth.signOut(); },
  close: () => closeDialog(),

  newTask: (planId) => taskForm(null, planId || null),
  editTask: (id) => taskForm(byId(S.tasks, id)),
  delTask: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('tasks').delete().eq('id', id)); closeDialog(); await refresh(); },
  done: async (id) => {
    const task = byId(S.tasks, id); const st = taskState(task);
    if (st.kind === 'open' && !st.took) return toast(t('takeFirst'), true);
    await run(sb.from('task_done').insert({ task_id: id, period: st.period, done_on: today() }));
    toast(task.points ? `+${task.points} ⭐` : '✓'); await refresh();
  },
  undo: async (id) => {
    const task = byId(S.tasks, id);
    const q = sb.from('task_done').delete().eq('task_id', id).eq('done_by', uid());
    await run(task.recurrence === 'once' ? q : q.eq('period', taskState(task).period));
    await refresh();
  },
  take: async (id) => {
    await run(sb.rpc('take_task', { p_task: id, p_period: taskState(byId(S.tasks, id)).period }));
    await refresh();
  },
  untake: async (id) => {
    await run(sb.from('task_takes').delete().eq('task_id', id)
      .eq('period', taskState(byId(S.tasks, id)).period).eq('user_id', uid()));
    await refresh();
  },

  newPlan: () => planForm(null),
  templatePlan: () => templateForm(),
  ideaTab: (id) => { S.ideaTab = id; render(); },
  ideaToCalendar: (id) => {
    const x = byId(S.suggestions, id);
    const start = x.starts_on && x.starts_on >= today() ? x.starts_on : today();
    eventForm(null, {
      type: x.kind === 'getaway' ? 'vacation' : 'other', title: x.title, start_date: start,
      end_date: x.ends_on && x.starts_on && x.ends_on !== x.starts_on && x.kind === 'getaway' ? x.ends_on : '',
      remind_days: 7, roles: myRoles().filter((r) => ['husband', 'wife'].includes(r)).length
        ? myRoles().filter((r) => ['husband', 'wife'].includes(r)) : ['all'],
    });
  },
  editPlan: (id) => planForm(byId(S.plans, id)),
  delPlan: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('plans').delete().eq('id', id)); closeDialog(); await refresh(); },

  // house
  houseMode: (id) => { S.houseMode = id; render(); window.scrollTo(0, 0); },
  seedHouse: async () => { await run(sb.rpc('seed_house')); await refresh(); },
  // "Done!" straight away: take it (if not already) and tick it in one go
  houseDone: async (id) => {
    const st = taskState(byId(S.tasks, id));
    if (!st.took) await run(sb.rpc('take_task', { p_task: id, p_period: st.period }));
    await run(sb.from('task_done').insert({ task_id: id, period: st.period, done_on: today() }));
    toast('✓ 💪'); await refresh();
  },
  setChore: (id) => { const [p, c] = id.split('|'); choreSetForm(p, c); },
  addPlace: (io) => houseItemForm('house_places', null, io === 'out'),
  editPlace: (id) => houseItemForm('house_places', byId(S.places, id)),
  addChoreType: (io) => houseItemForm('house_chores', null, io === 'out'),
  editChoreType: (id) => houseItemForm('house_chores', byId(S.chores, id)),
  delHouseItem: async (ref) => {
    const [table, id] = ref.split('|');
    if (!confirm(t('house.confirmDel'))) return;
    await run(sb.from(table).delete().eq('id', id)); closeDialog(); await refresh();
  },

  newMoment: () => momentForm(null),
  newFamilyMoment: () => momentForm(null, true),
  planMoment: (id) => momentPlanForm(byId(S.trackers, id)),
  clearPlan: async (id) => {
    await run(sb.from('trackers').update({ planned_on: null, plan_note: null }).eq('id', id));
    closeDialog(); await refresh();
  },
  editMoment: (id) => momentForm(byId(S.trackers, id)),
  delMoment: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('trackers').delete().eq('id', id)); closeDialog(); await refresh(); },
  logMoment: async (id) => {
    await run(sb.from('tracker_entries').insert({ tracker_id: id, done_on: today() }));
    toast('💛'); await refresh();
  },
  logOther: (id) => logOtherForm(id),
  delEntry: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('tracker_entries').delete().eq('id', id)); await refresh(); },
  idea: (id) => { S.ideaShift[id] = (S.ideaShift[id] || 0) + 1; render(); },

  newEvent: () => eventForm(null),
  editEvent: (id) => eventForm(byId(S.events, id)),
  newEventTask: (id) => {
    const [evId, idx] = id.split('|');
    const ev = byId(S.events, evId);
    const sugg = idx === '' ? null : ((EVENT_TASKS[getLang()] || EVENT_TASKS.da)[ev.type] || [])[Number(idx)];
    taskForm(null, null, {
      event_id: evId, title: sugg ? `${sugg[0]} – ${ev.title}` : '', days_before: sugg ? sugg[1] : 1,
    });
  },

  makeSyncCode: async () => { await run(sb.rpc('my_sync_token')); await refresh(); },
  newSyncCode: async () => {
    if (!confirm(t('newCodeConfirm'))) return;
    await run(sb.rpc('my_sync_token', { p_new: true })); await refresh();
  },
  copyCode: async () => {
    try { await navigator.clipboard.writeText(S.sync.token); toast(t('copied')); }
    catch { document.querySelector('.cal-sync input.mono')?.select(); }
  },
  calToggle: async (id) => {
    const [calId, field] = id.split('|');
    const c = byId(S.calendars, calId);
    const next = { included: c.included, yearly: c.yearly, [field]: !c[field] };
    if (field === 'included' && !next.included && !confirm(t('calOffConfirm'))) return;
    await run(sb.rpc('set_calendar', { p_id: calId, p_included: next.included, p_yearly: next.yearly }));
    if (field === 'included' && next.included) toast(t('calOnNote'));
    await refresh();
  },
  delEvent: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('events').delete().eq('id', id)); closeDialog(); await refresh(); },

  newCode: async () => {
    if (!confirm(t('newInviteConfirm'))) return;
    await run(sb.rpc('new_invite_code')); await refresh();
  },
  editMember: (id) => memberForm(byId(S.members, id, 'user_id')),
  delMember: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('members').delete().eq('user_id', id)); closeDialog(); await refresh(); },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  el.disabled = true;
  try { await fn(el.dataset.id); } catch { /* toast already shown */ } finally { el.disabled = false; }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'nameForm') {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (name) run(sb.rpc('rename_me', { p_name: name })).then(refresh).catch(() => {});
  }
});

// Refresh when the app comes back to the foreground (dates may have changed)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.me) refresh().catch(() => {});
});

// ------------------------------------------------------------ start

(async function start() {
  const saved = store('hl-lang');
  const nav = (navigator.language || 'da').slice(0, 2);
  setLang(saved || (LANGS[nav] ? nav : 'da'));
  if (SUPABASE_URL.includes('YOUR-PROJECT')) {
    app.innerHTML = '<div class="center"><div class="card"><h2>Setup</h2><p>Fill in config.js with your Supabase URL and anon key (see README).</p></div></div>';
    return;
  }
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (S.session) { try { await loadAll(); } catch { /* shown */ } }
  render();
  ensurePush().then(() => { if (S.pushOn && S.tab === 'family') render(); });
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'TOKEN_REFRESHED') { S.session = session; return; }
    if (event === 'INITIAL_SESSION') return;
    S.session = session;
    S.me = null;
    S.pushOn = false;
    S.loginCode = null;
    S.authStep = 'email';
    if (session) { try { await loadAll(); } catch { /* shown */ } }
    render();
    ensurePush();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
