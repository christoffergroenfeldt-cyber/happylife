// Happy Life – main app
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';
import { t, setLang, getLang, LANGS, IDEAS, EVENT_TASKS, PACK_IDEAS } from './i18n.js';
import { RAINBOW_SMALL, PAGE_ART } from './art.js';
import { CUISINES, CATALOG, NEARBY, onlineLinks, MAP_QUERY } from './catalog.js';
import { geocode, fetchNearby } from './places.js';
import { AGES, ROUTINES, ROUTINE_REC, ROUTINE_TIME, TEMPLATES } from './templates.js';
import { todayISO, daysBetween, addDays, trackerStatus, eventStatus, periodKey, periodEnd, eventOccurrence, fmtDate, nextWeekly, isoDow, weekStart } from './dates.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ROLES = ['child', 'mother', 'father', 'husband', 'wife'];
const ITEM_ROLES = ['all', ...ROLES];
const PARENT = ['mother', 'father'];
const HOUSE_ROLES = ['child', 'mother', 'father']; // who sees house chores
const APP_VERSION = '48'; // keep in step with CACHE in sw.js

// Get the newest version: update the service worker, drop cached files, reload
async function hardRefresh() {
  toast(t('updating'));
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update();
      const next = reg.installing || reg.waiting;
      if (next) await new Promise((ok) => {
        next.addEventListener('statechange', () => next.state === 'activated' && ok());
        setTimeout(ok, 3000);
      });
    }
  } catch { /* offline or no service worker */ }
  try { await Promise.all((await caches.keys()).map((k) => caches.delete(k))); } catch { /* ignore */ }
  location.replace(location.pathname + '?v=' + Date.now());
}

// Invite links (…/?invite=CODE) – kept until the family is joined, so it survives the e-mail login step.
function pendingInvite() {
  try {
    const code = new URLSearchParams(location.search).get('invite');
    if (code) { localStorage.setItem('hl-invite', code.toUpperCase()); history.replaceState(null, '', location.pathname); }
    return localStorage.getItem('hl-invite') || '';
  } catch { return ''; }
}

const S = {
  session: null, me: null, family: null, members: [],
  plans: [], tasks: [], done: [], takes: [], trackers: [], entries: [], events: [], points: [],
  sync: null, calendars: [], inbox: [], calView: 'list', findQ: '', loginCode: null, suggestions: [], ideaTab: 'event',
  places: [], chores: [], houseMode: 'todo', setupZone: 'daily', momentTab: 'family',
  find: null, nearby: null, nearbyMeta: null, findItems: [],
  packs: [], packDone: [], todayDay: null,
  fdReady: false, fdOrder: [], fdIdeas: [], fdWeeks: [],
  watches: [], wpoints: [], pricesReady: false,
  school: null, schoolMsgs: [], schoolFeeds: null, schoolRead: new Set(), schoolItems: [],
  skemaWho: null, skemaWeek: null, skemaDay: null, skemaHidden: null,
  tab: 'today', authStep: 'email', authEmail: '', setupMode: pendingInvite() ? 'join' : 'create', ideaShift: {}, pushOn: false,
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
  // How many places near home are saved (the list itself is loaded when Find opens)
  try {
    const r = await sb.from('nearby_places').select('created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(1);
    S.nearbyMeta = r.error ? null : { n: r.count || 0, at: r.data?.[0]?.created_at || null };
  } catch { S.nearbyMeta = null; }
  // Idea lists (only rows for my roles come back; a missing table just means none)
  const { data: sugg } = await sb.from('suggestions').select('*');
  S.suggestions = sugg || [];
  // Family day (a missing table just means an older database)
  const [fd, fdIdeas, fdWeeks] = await Promise.all([
    sb.from('famday').select('*').maybeSingle(),
    sb.from('famday_ideas').select('*'),
    sb.from('famday_weeks').select('*').gte('week_start', isoMinus(200)),
  ]);
  S.fdReady = !fd.error && !fdIdeas.error;
  // Price watch (a missing table just means an older database)
  const [pw, pp] = await Promise.all([
    sb.from('price_watches').select('*').order('created_at'),
    sb.from('price_points').select('*').gte('checked_on', isoMinus(400)).order('checked_on'),
  ]);
  S.pricesReady = !pw.error;
  Object.assign(S, { watches: pw.data || [], wpoints: pp.data || [] });
  // Skema subjects hidden by the family (null = older database without the table)
  const sh = await sb.from('skema_hidden').select('title');
  S.skemaHidden = sh.error ? null : sh.data.map((x) => x.title.toLowerCase());
  Object.assign(S, { fdOrder: fd.data?.turn_order || [], fdIdeas: fdIdeas.data || [], fdWeeks: fdWeeks.data || [] });
  if (isParent()) {
    const td = today();
    const [sync, calendars, inbox, evSources] = await Promise.all([
      run(sb.from('sync_tokens').select('*').maybeSingle()),
      run(sb.from('user_calendars').select('*').order('name')),
      // Find events: what is still coming (a missing table just means an older database)
      sb.from('calendar_inbox').select('*')
        .or(`start_date.gte.${td},end_date.gte.${td},repeat_until.gte.${td}`)
        .order('start_date').order('start_time', { nullsFirst: true }).then((r) => r.data || []),
      // which of my phone calendars each imported event comes from
      sb.from('event_sources').select('event_id, calendar_id').then((r) => r.data || []),
    ]);
    Object.assign(S, { sync, calendars, inbox, evSources });
    const [packs, packDone] = await Promise.all([
      sb.from('pack_items').select('*').order('created_at').then((r) => r.data || []),
      sb.from('pack_done').select('*').gte('on_date', isoMinus(7)).then((r) => r.data || []),
    ]);
    Object.assign(S, { packs, packDone });
    // School direct (a missing table just means an older database)
    const [sl, sm, sr, si] = await Promise.all([
      sb.from('school_links').select(SCHOOL_COLS).maybeSingle(),
      sb.from('school_messages').select('*').gte('sent_at', isoMinus(60)).order('sent_at', { ascending: false }).limit(100),
      sb.from('school_reads').select('message_id'),
      sb.from('school_items').select('*').order('due_date').order('child'),
    ]);
    S.school = sl.error ? undefined : sl.data;
    S.schoolMsgs = sm.data || [];
    S.schoolRead = new Set((sr.data || []).map((r) => r.message_id));
    S.schoolItems = si.data || [];
  }
}

// The husband lands on the Today page
function landing() { S.tab = 'today'; }

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
  return c && p ? (p.daily ? c.name : `${c.name} – ${p.name}`) : task.title;
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

const EVENT_TYPES = ['vacation', 'anniversary', 'birthday', 'school', 'sport', 'show', 'other'];
const eventIcon = (type) => ({ vacation: '🏖️', anniversary: '💍', birthday: '🎂', school: '🏫', sport: '⚽', show: '🎭', other: '📌' }[type] || '📌');

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
  const tabs = ['today', 'tasks', ...(isParent() ? ['plan'] : []), 'moments', 'calendar', 'family'];
  if (!tabs.includes(S.tab) && !(S.tab === 'prices' && S.pricesReady)) S.tab = 'today';
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const icons = {
    today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>'),
    home: svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
    tasks: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
    plan: svg('<rect x="4" y="4.5" width="16" height="16" rx="3"/><path d="M8 3v3M16 3v3M4 9.5h16M8 13.5h3M8 16.5h6"/>'),
    moments: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
    calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    family: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>'),
  };
  const views = { today: viewToday, home: viewHome, tasks: viewTasks, plan: viewPlan, moments: viewMoments, calendar: viewCalendar, family: viewFamily, prices: viewPrices };
  app.innerHTML = `
    <header class="top hero hero-${S.tab === 'today' ? 'home' : S.tab}">
      <div class="hero-text">
        <h1>${esc(S.tab === 'today' ? t('hello', { name: S.me.display_name }) : t('tabs.' + S.tab))}</h1>
        <span class="fam">${esc(S.tab === 'today' ? cap(new Date().toLocaleDateString(LOCALE(), { weekday: 'long', day: 'numeric', month: 'long' })) : S.family?.name)}</span>
      </div>
      <div class="hero-art">${S.tab === 'today' ? RAINBOW_SMALL : PAGE_ART[S.tab] || ''}</div>
      <button class="icon refresh" data-act="hardRefresh" aria-label="${t('updateApp')}" title="${t('updateApp')}">↻</button></header>
    <main class="view">${views[S.tab]()}</main>
    <nav class="tabs" style="grid-template-columns:repeat(${tabs.length},1fr)">${tabs.map((k) => `
      <button data-act="tab" data-id="${k}" class="${S.tab === k ? 'on' : ''}">
        <span class="ico">${icons[k]}</span><span>${esc(t('tabs.' + k))}</span></button>`).join('')}
    </nav>`;
  keepChipsInView();
  schoolPoll();
}

// A sideways-scrolling row of chips is redrawn on every tap; bring the chosen
// chip back into view (centred) instead of jumping back to the start
document.addEventListener('toggle', (e) => {
  const f = e.target?.dataset?.fold;
  if (f) store('hl-fold-' + f, e.target.open ? '1' : '0');
}, true);

function keepChipsInView() {
  document.querySelectorAll('.kind-chips').forEach((row) => {
    const on = row.querySelector('.hchip.on');
    if (!on || row.scrollWidth <= row.clientWidth) return;
    const shift = on.getBoundingClientRect().left - row.getBoundingClientRect().left;
    row.scrollLeft = Math.max(0, row.scrollLeft + shift - (row.clientWidth - on.offsetWidth) / 2);
  });
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
                 : `<label>${t('inviteCode')}<input name="code" required autocapitalize="characters" value="${esc(pendingInvite())}"></label>`}
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
      try { localStorage.removeItem('hl-invite'); } catch {}
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
    .filter(({ ev, st }) => !ev.every_weeks && !ev.lesson && (st.ongoing || (st.days >= 0 && st.days <= ev.remind_days)))
    .sort((a, b) => a.st.days - b.st.days);

  // Snart can be narrowed to one phone calendar (or the events made in the app)
  const upCals = isParent() ? S.calendars.filter((c) => upcoming.some(({ ev }) => evCalIds(ev).includes(c.id))) : [];
  let hf = store('hl-homecalf') || 'all';
  if (hf !== 'all' && hf !== 'own' && !upCals.some((c) => c.id === hf)) hf = 'all';
  const upIn = (ev) => hf === 'all' || (hf === 'own' ? !ev.imported : evCalIds(ev).includes(hf));
  const upShown = upcoming.filter(({ ev }) => upIn(ev));
  const nUp = (fn) => upcoming.filter(({ ev }) => fn(ev)).length;
  const upcomingChips = upCals.length ? `<div class="kind-chips cal-chips">
      <button class="hchip ${hf === 'all' ? 'on' : ''}" data-act="homeCalFilter" data-id="all">${esc(t('calFilterAll'))} (${upcoming.length})</button>
      ${nUp((ev) => !ev.imported) ? `<button class="hchip ${hf === 'own' ? 'on' : ''}" data-act="homeCalFilter" data-id="own">✏️ ${esc(t('calFilterOwn'))} (${nUp((ev) => !ev.imported)})</button>` : ''}
      ${upCals.map((c) => `<button class="hchip ${hf === c.id ? 'on' : ''}" data-act="homeCalFilter" data-id="${c.id}">${calDot(c.id)}${esc(c.name)} (${nUp((ev) => evCalIds(ev).includes(c.id))})</button>`).join('')}
    </div>` : '';

  const all = S.tasks.map((task) => ({ task, st: taskState(task) })).filter(({ st }) => st.active && !st.done);
  // Free tasks nobody has taken yet: daily chores, family tasks, then rooms inside and outside
  const zoneRank = (task) => (!isHouse(task) ? 1 : { daily: 0, in: 2, out: 3 }[zoneOf(byId(S.places, task.place_id) || {})] ?? 2);
  const free = all.filter(({ st }) => st.kind === 'open' && !st.took && !st.full)
    .sort((a, b) => zoneRank(a.task) - zoneRank(b.task)
      || sortOf(S.places, a.task.place_id) - sortOf(S.places, b.task.place_id)
      || sortOf(S.chores, a.task.chore_id) - sortOf(S.chores, b.task.chore_id));
  // Mine: taken by me, or given to me / my role
  const mine = all.filter(({ st }) => (st.kind === 'open' ? st.took : st.forMe));
  const row = ({ task, st }) => (isHouse(task) ? houseRow(task, st, true) : taskRow(task, st));
  const FIRST = 8;

  // "Time for something special" grouped like Øjeblikke: whole family / just us
  const famDue = due.filter((x) => isFamilyMoment(x.tr)), ownDue = due.filter((x) => !isFamilyMoment(x.tr));
  const both = famDue.length && ownDue.length;
  const mtab = !both ? (famDue.length ? 'family' : 'own') : S.momentTab === 'own' ? 'own' : 'family';
  const shown = mtab === 'family' ? famDue : ownDue;
  const pick = both ? `<div class="seg zone-seg">
      <button data-act="momentTab" data-id="family" class="${mtab === 'family' ? 'on' : ''}">👨‍👩‍👧‍👦 ${esc(t('momentsFamily'))} (${famDue.length})</button>
      <button data-act="momentTab" data-id="own" class="${mtab === 'own' ? 'on' : ''}">💛 ${esc(t('momentsOwn'))} (${ownDue.length})</button></div>`
    : `<h3 class="subhead">${esc(t(mtab === 'family' ? 'momentsFamily' : 'momentsOwn'))}</h3>`;

  return `
    ${pointsCard()}
    ${famdayCard(true)}
    <h2>${esc(t('upcoming'))}</h2>
    ${upcomingChips}
    ${plannedSoon.map(plannedRow).join('')}
    ${upShown.length ? `<div class="list cols">${upShown.map(({ ev, st }) => eventRow(ev, st)).join('')}</div>`
      : plannedSoon.length ? '' : `<p class="empty">${esc(t('noUpcoming'))}</p>`}
    ${familyTodaySection()}
    ${due.length ? `<h2>${esc(t('timeFor'))}</h2>${pick}${shown.map(({ tr, st }) => momentCard(tr, st, true)).join('')}` : ''}
`;
}

// ------------------------------------------------------------ today (the husband's page)
// One screen for the morning: what goes in the children's bags, what happens
// today, my tasks, and what is coming up for the children and for my wife.

const WIFE = '@wife';                     // tag for "my wife" that works before she has joined
const ME = '@me', FAMILY = '@family';      // "me" and "the whole family" – never counted as a child
const TOKENS = [WIFE, ME, FAMILY];
const KID_TYPES = ['school', 'sport', 'show'];
const AHEAD = 30;                         // days of "coming up"
const LOCALE = () => ({ da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[getLang()] || 'da-DK');

const wifeMember = () => S.members.find((m) => m.roles.includes('wife'));
const isWifeTag = (p) => p === WIFE || (!!wifeMember() && p === wifeMember().display_name);
const isMeTag = (p) => p === ME || p === S.me.display_name;
const personLabel = (p) => (p === WIFE ? wifeMember()?.display_name || t('td.myWife')
  : p === ME ? t('td.me') : p === FAMILY ? t('td.family') : p);
const isKidTag = (p) => !isWifeTag(p) && !isMeTag(p) && p !== FAMILY;
const aboutWife = (ev) => (ev.people || []).some(isWifeTag);
const aboutFamily = (ev) => (ev.people || []).includes(FAMILY);
const aboutKids = (ev) => (ev.people || []).some(isKidTag)
  || (!(ev.people || []).length && KID_TYPES.includes(ev.type));

// Names used anywhere: children who have joined, event and calendar tags, pack list
function knownPeople() {
  const names = new Set(children().map((c) => c.display_name));
  S.events.forEach((ev) => (ev.people || []).forEach((p) => names.add(p)));
  (S.calendars || []).forEach((c) => (c.people || []).forEach((p) => names.add(p)));
  (S.packs || []).forEach((x) => x.who && names.add(x.who));
  return [...names].filter((p) => p && isKidTag(p)).sort((a, b) => a.localeCompare(b));
}

// Checkboxes for "my wife" + every known name, and a box to add a new name
function peoplePicker(name, selected) {
  const list = [...TOKENS, ...knownPeople()];
  selected.forEach((p) => { if (!list.includes(p) && isKidTag(p)) list.push(p); });
  const on = (p) => selected.includes(p) || (p === WIFE && selected.some(isWifeTag)) || (p === ME && selected.some(isMeTag));
  return `<div data-people="${name}">
    <div class="checks">${list.map((p) => `
      <label class="check"><input type="checkbox" name="${name}" value="${esc(p)}" ${on(p) ? 'checked' : ''}>
      <span>${{ [WIFE]: '💛 ', [ME]: '🙋 ', [FAMILY]: '👨‍👩‍👧‍👦 ' }[p] || ''}${esc(personLabel(p))}</span></label>`).join('')}</div>
    <div class="copyrow"><input class="newperson" placeholder="${esc(t('td.otherName'))}" maxlength="40">
      <button type="button" class="small" data-act="addPerson" data-id="${name}">＋</button></div></div>`;
}
const pickedPeople = (form, name) => {
  const typed = form.querySelector(`[data-people="${name}"] input.newperson`)?.value.trim();
  return [...new Set([...new FormData(form).getAll(name), ...(typed ? [typed] : [])])].slice(0, 12);
};

// Does the event happen on this date? (multi-day, yearly and weekly series included)
function occursOn(ev, iso) {
  const st = eventStatus(ev, iso);
  return st.ongoing || st.days === 0;
}

// Which day the page shows: today, or tomorrow from 15:00 (packing the night before)
function todayDate() {
  if (!S.todayDay) S.todayDay = new Date().getHours() >= 15 ? 'tomorrow' : 'today';
  return S.todayDay === 'tomorrow' ? addDays(today(), 1) : today();
}
const fmtDay = (iso, opts) => new Date(`${iso}T12:00:00`).toLocaleDateString(LOCALE(), opts);
const packIsDone = (id, d) => S.packDone.some((x) => x.item_id === id && x.on_date === d);

function packsOn(d) {
  const dow = isoDow(d);
  return S.packs.filter((x) => (x.days || []).includes(dow) || x.on_date === d
    || (x.event_id && S.events.some((ev) => ev.id === x.event_id && occursOn(ev, d))));
}

function packRow(x, d) {
  const done = packIsDone(x.id, d);
  const ev = x.event_id ? byId(S.events, x.event_id) : null;
  const meta = [ev ? `${eventIcon(ev.type)} ${ev.title}` : '', x.notes || ''].filter(Boolean);
  return `<div class="row pack ${done ? 'is-done' : ''}">
    <div class="lead"><button class="tick ${done ? 'on' : ''}" data-act="packTick" data-id="${x.id}" aria-label="${esc(t('td.packed'))}">${done ? '✓' : ''}</button></div>
    <div class="body"><div class="ttl">${esc(x.title)}</div>${meta.length ? `<div class="meta">${meta.map(esc).join(' · ')}</div>` : ''}</div>
    <button class="icon" data-act="editPack" data-id="${x.id}" aria-label="${t('edit')}">✎</button></div>`;
}

const timeOf = (ev) => (ev.start_time ? ev.start_time.slice(0, 5) : '');
const whoChips = (ev) => (ev.people || []).map((p) =>
  `<span class="chip ${isWifeTag(p) ? 'role-wife' : isKidTag(p) ? 'kid' : ''}">${esc(personLabel(p))}</span>`).join('');

// One event on the Today page; withDate for the "coming up" lists
function dayEventRow(ev, date, withDate) {
  const packs = S.packs.filter((x) => x.event_id === ev.id).map((x) => x.title);
  const days = daysBetween(today(), date);
  const when = withDate ? `<div class="when"><b>${esc(fmtDay(date, { day: 'numeric' }))}</b><small>${esc(fmtDay(date, { month: 'short' }))}</small></div>`
    : `<div class="when time">${timeOf(ev) ? `<b>${esc(timeOf(ev))}</b>` : `<small>${esc(t('td.allDay'))}</small>`}</div>`;
  const meta = [];
  if (withDate) meta.push(esc(`${cap(fmtDay(date, { weekday: 'short' }))}${timeOf(ev) ? ` ${timeOf(ev)}` : ''}`));
  if (withDate && days > 0) meta.push(`<strong>${esc(t('inDays', days))}</strong>`);
  if (packs.length) meta.push(`🎒 ${esc(packs.join(', '))}`);
  return `<div class="row event dayev" data-act="editEvent" data-id="${ev.id}">
    ${when}
    <div class="body"><div class="ttl one">${esc(ev.title)}</div>
      ${meta.length || (ev.people || []).length ? `<div class="meta one">${whoChips(ev)}${meta.join(' · ')}</div>` : ''}
    </div></div>`;
}

// Events in the next AHEAD days after date d (weekly series are left out – they show on their day)
function comingUp(d, test) {
  const from = addDays(d, 1);
  return S.events.filter((ev) => !ev.every_weeks && !ev.lesson && test(ev))
    .map((ev) => ({ ev, st: eventStatus(ev, from) }))
    .filter(({ st }) => st.ongoing || (st.days >= 0 && st.days < AHEAD))
    .map(({ ev, st }) => ({ ev, date: st.ongoing ? from : st.date }))
    .sort((a, b) => a.date.localeCompare(b.date) || timeOf(a.ev).localeCompare(timeOf(b.ev)));
}

function comingList(rows, emptyKey) {
  const FIRST = 6;
  if (!rows.length) return `<p class="empty">${esc(t(emptyKey))}</p>`;
  const html = (list) => `<div class="list cols">${list.map(({ ev, date }) => dayEventRow(ev, date, true)).join('')}</div>`;
  return html(rows.slice(0, FIRST)) + (rows.length > FIRST
    ? `<details class="more"><summary>${esc(t('showAll'))} (${rows.length})</summary>${html(rows.slice(FIRST))}</details>` : '');
}

// A section that can be folded up; the app remembers it per section
function fold(id, title, body, count = '') {
  if (!body) return '';
  const closed = store('hl-fold-' + id) === '0';
  return `<details class="fold" data-fold="${id}" ${closed ? '' : 'open'}>
    <summary><h2>${title}${count !== '' ? ` <small class="count">${count}</small>` : ''}</h2></summary>${body}</details>`;
}

// One slim line of stars instead of the big points card
function pointsStrip() {
  if (!S.points.length) return '';
  const rows = S.points.map((p) => ({ name: memberName(p.user_id), total: Number(p.total), week: Number(p.week), me: p.user_id === uid() }))
    .filter((p) => isParent() || p.me).sort((a, b) => b.total - a.total);
  if (!rows.length) return '';
  return `<div class="pstrip">${rows.map((p) => `<span class="pchip"><b>⭐ ${p.total}</b> ${esc(p.me && !isParent() ? t('myPoints') : p.name)}${p.week ? ` <small>+${p.week}</small>` : ''}</span>`).join('')}</div>`;
}

function viewToday() {
  const d = todayDate();
  const isToday = d === today();
  const parent = isParent();
  const head = `<div class="today-head">
      ${pointsStrip()}
      <div class="seg"><button data-act="todayDay" data-id="today" class="${isToday ? 'on' : ''}">${esc(t('td.today'))}</button>
        <button data-act="todayDay" data-id="tomorrow" class="${isToday ? '' : 'on'}">${esc(t('td.tomorrow'))}</button></div></div>`;

  // 1. Mit: my tasks and the bags
  const mine = isToday ? myTasksToday() : [];
  const nOpen = mine.filter((x) => !x.st.done).length;
  const tasksBlock = isToday ? `<div class="mytasks-head"><h2>✅ ${esc(t('myToday'))}</h2>
      ${mine.length ? `<span class="chip ${nOpen ? '' : 'yes'}">${mine.length - nOpen}/${mine.length}</span>` : ''}</div>
    ${mine.length ? `<div class="list cols">${mine.map(({ task, st }) => myTaskRow(task, st)).join('')}</div>` : `<p class="empty">${esc(t('pk.noneMine'))}</p>`}
    <button class="small" data-act="tab" data-id="tasks">🎯 ${esc(t('pk.pickMore'))}</button>` : '';
  const packs = packsOn(d);
  const groups = {};
  packs.forEach((x) => { (groups[x.who || ''] ||= []).push(x); });
  const order = Object.keys(groups).sort((a, b) => (!a) - (!b) || a.localeCompare(b));
  const nDone = packs.filter((x) => packIsDone(x.id, d)).length;
  const bag = parent ? `<div class="card bag">
      <div class="bag-head"><h2>🎒 ${esc(t('td.pack'))}</h2>
        ${packs.length ? `<span class="chip ${nDone === packs.length ? 'yes' : ''}">${nDone}/${packs.length}</span>` : ''}</div>
      ${packs.length ? order.map((w) => `<h3 class="subhead">${esc(w || t('td.everyone'))}</h3>
        <div class="list cols">${groups[w].map((x) => packRow(x, d)).join('')}</div>`).join('')
        : `<p class="empty">${esc(t('td.packEmpty'))}</p>`}
      <div class="acts"><button class="small primary" data-act="newPack">＋ ${t('td.addPack')}</button></div>
      ${S.packs.length ? `<h3 class="subhead">${esc(t('td.allPack'))} (${S.packs.length})</h3>${packOverview()}` : ''}
    </div>` : '';

  // 2. Dagen: the program
  const fdRow = S.fdWeeks.find((w) => w.on_date === d && w.title && !w.cancelled);
  const program = S.events.filter((ev) => !ev.lesson && occursOn(ev, d))
    .sort((a, b) => (timeOf(a) || '00').localeCompare(timeOf(b) || '00'));
  const day = `${skemaLink(d)}
    ${fdRow ? `<div class="list fd-today"><div class="row dayev" data-act="fdPick" data-id="${fdRow.week_start}"><div class="when time">${fdRow.at_time ? `<b>${esc(fdRow.at_time)}</b>` : `<small>${esc(t('td.allDay'))}</small>`}</div>
      <div class="body"><div class="ttl">${esc(fdRow.emoji || '🎉')} ${esc(t('fd.title'))}: ${esc(fdRow.title)}</div><div class="meta">${esc(t('fd.chosenBy', { name: personLabel(fdRow.chooser) }))}</div></div></div></div>` : ''}
    ${program.length ? `<div class="list">${program.map((ev) => dayEventRow(ev, d, false)).join('')}</div>` : fdRow ? '' : `<p class="empty">${esc(t('td.noProgram'))}</p>`}
    ${fdRow ? '' : famdayCard(true)}`;

  // 4. Snart: one list for the next 30 days, filtered by who it's about or by calendar
  const all = comingUp(d, () => true);
  const special = (ev) => ['birthday', 'anniversary'].includes(ev.type) && ev.yearly;
  const filters = [['all', t('calFilterAll'), () => true]];
  if (parent) {
    filters.push(['kids', `👧 ${t('td.kidsShort')}`, aboutKids]);
    filters.push(['wife', `💛 ${personLabel(WIFE)}`, (ev) => aboutWife(ev)]);
    filters.push(['family', `👨‍👩‍👧‍👦 ${t('td.family')}`, (ev) => aboutFamily(ev)]);
  }
  filters.push(['special', `🎂 ${t('td.specialShort')}`, special]);
  (parent ? S.calendars || [] : []).filter((c) => all.some(({ ev }) => evCalIds(ev).includes(c.id)))
    .forEach((c) => filters.push([c.id, `${calDot(c.id)}${esc(c.name)}`, (ev) => evCalIds(ev).includes(c.id), true]));
  const counted = filters.map(([id, label, fn, raw]) => ({ id, label, raw, n: all.filter(({ ev }) => fn(ev)).length, fn }))
    .filter((f) => f.id === 'all' || f.n);
  let sf = store('hl-snartf') || 'all';
  if (!counted.some((f) => f.id === sf)) sf = 'all';
  const cur = counted.find((f) => f.id === sf);
  const snartChips = counted.length > 1 ? `<div class="kind-chips cal-chips">${counted.map((f) =>
    `<button class="hchip ${f.id === sf ? 'on' : ''}" data-act="snartFilter" data-id="${f.id}">${f.raw ? f.label : esc(f.label)} (${f.n})</button>`).join('')}</div>` : '';
  const snart = `${snartChips}${comingList(all.filter(({ ev }) => cur.fn(ev)), 'td.none')}`;

  // 5. Tid til noget særligt: the two most overdue moments
  const due = S.trackers
    .map((tr) => ({ tr, st: trackerStatus(tr.interval_days, entriesOf(tr.id).map((e) => e.done_on), today()) }))
    .filter((x) => x.st.dueIn <= 0 && !plannedAhead(x.tr))
    .sort((a, b) => a.st.dueIn - b.st.dueIn);
  const moments = due.length ? `${due.slice(0, 2).map(({ tr, st }) => momentCard(tr, st, true)).join('')}
    <button class="small" data-act="tab" data-id="moments">${esc(t('td.allMoments', due.length))} →</button>` : '';

  const anyTags = S.events.some((ev) => (ev.people || []).length);
  return `${head}
    ${tasksBlock}
    ${bag}
    <h2>📅 ${esc(t(isToday ? 'td.program' : 'td.programTomorrow'))}</h2>${day}
    ${parent ? schoolDay(d) : ''}
    ${parent ? schoolInbox() : ''}
    ${isToday ? fold('who', `👨‍👩‍👧‍👦 ${esc(t('pk.whoWhat'))}`, familyTodaySection()) : ''}
    ${fold('snart', `🗓️ ${esc(t('upcoming'))}`, snart, all.length)}
    ${fold('moments', `💛 ${esc(t('timeFor'))}`, moments, due.length || '')}
    ${pricesTeaser()}
    ${parent && !anyTags ? `<p class="hint">💡 ${esc(t('td.tagHint'))}</p>` : ''}`;
}

// All pack items, for changing ones that aren't due today
function packOverview() {
  const dayNames = [1, 2, 3, 4, 5, 6, 7].map((i) => fmtDay(addDays('2024-01-01', i - 1), { weekday: 'short' }));
  const whenOf = (x) => {
    if (x.days?.length) return x.days.length === 5 && [1, 2, 3, 4, 5].every((i) => x.days.includes(i))
      ? t('td.weekdays') : x.days.slice().sort().map((i) => dayNames[i - 1]).join(', ');
    if (x.on_date) return fmtDate(x.on_date, getLang());
    const ev = byId(S.events, x.event_id);
    return ev ? `${eventIcon(ev.type)} ${ev.title}` : '';
  };
  // small tiles, as many across as fit; tap one to change it
  return `<div class="pack-tiles">${S.packs.slice().sort((a, b) => (a.who || '~').localeCompare(b.who || '~') || a.title.localeCompare(b.title)).map((x) => `
    <button type="button" class="pack-tile" data-act="editPack" data-id="${x.id}">
      <b>${esc(x.title)}</b><small>${esc(x.who || t('td.everyone'))} · ${esc(whenOf(x))}</small></button>`).join('')}</div>`;
}

// preset: { event_id } when started from an event
function packForm(item, preset = {}) {
  const x = item || { title: '', who: '', days: [], on_date: '', event_id: null, notes: '', ...preset };
  const mode = x.event_id ? 'event' : x.on_date ? 'date' : 'days';
  const dayNames = [1, 2, 3, 4, 5, 6, 7].map((i) => fmtDay(addDays('2024-01-01', i - 1), { weekday: 'short' }));
  const td = today();
  const evs = S.events.filter((ev) => ev.id === x.event_id
      || (ev.every_weeks ? nextWeekly(ev, td) : eventStatus(ev, td).days >= 0 && eventStatus(ev, td).days <= 120))
    .map((ev) => ({ ev, date: eventStatus(ev, td).date })).sort((a, b) => a.date.localeCompare(b.date));
  const ideas = PACK_IDEAS[getLang()] || PACK_IDEAS.da;
  openDialog(`
    <form id="packForm" class="form">
      <h2>🎒 ${item ? esc(item.title) : t('td.packNew')}</h2>
      <label>${t('td.packTitle')}<input name="title" value="${esc(x.title)}" maxlength="120" required></label>
      <div class="sugg">${ideas.map((i) => `<button type="button" class="chip-btn" data-idea="${esc(i)}">${esc(i)}</button>`).join('')}</div>
      <label>${t('td.whoPack')}<input name="who" value="${esc(x.who || '')}" list="packWho" maxlength="40" placeholder="${esc(t('td.everyone'))}">
        <datalist id="packWho">${knownPeople().map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>
      <label>${t('td.when')}<select name="mode">
        ${['days', 'date', 'event'].map((m) => `<option value="${m}" ${m === mode ? 'selected' : ''}>${esc(t('td.when_' + m))}</option>`).join('')}</select></label>
      <fieldset data-mode="days"><div class="checks days">${dayNames.map((n, i) => `
        <label class="check"><input type="checkbox" name="days" value="${i + 1}" ${(x.days || []).includes(i + 1) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div></fieldset>
      <label data-mode="date">${t('td.date')}<input name="on_date" type="date" value="${esc(x.on_date || td)}"></label>
      <label data-mode="event">${t('td.pickEvent')}<select name="event_id">${evs.map(({ ev, date }) =>
        `<option value="${ev.id}" ${ev.id === x.event_id ? 'selected' : ''}>${eventIcon(ev.type)} ${esc(ev.title)} – ${esc(ev.every_weeks ? weeklyLabel(ev, eventStatus(ev, td)) : fmtDate(date, getLang()))}</option>`).join('')}</select></label>
      <label>${t('notes')}<input name="notes" value="${esc(x.notes || '')}" maxlength="300"></label>
      <div class="btns">
        ${item ? `<button type="button" class="danger" data-act="delPack" data-id="${item.id}">${t('delete')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  const form = document.getElementById('packForm');
  const show = () => form.querySelectorAll('[data-mode]').forEach((el) => { el.hidden = el.dataset.mode !== form.elements.mode.value; });
  form.elements.mode.onchange = show; show();
  form.querySelectorAll('[data-idea]').forEach((b) => { b.onclick = () => { form.elements.title.value = b.dataset.idea; }; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const m = f.get('mode');
    const row = { title: f.get('title').trim(), who: f.get('who').trim() || null, notes: f.get('notes').trim() || null,
      days: m === 'days' ? f.getAll('days').map(Number) : [], on_date: m === 'date' ? f.get('on_date') || null : null,
      event_id: m === 'event' ? f.get('event_id') || null : null };
    if (!row.title) return toast(t('needTitle'), true);
    if (m === 'days' && !row.days.length) return toast(t('td.needDay'), true);
    if ((m === 'date' && !row.on_date) || (m === 'event' && !row.event_id)) return toast(t('td.needWhen'), true);
    if (item) await run(sb.from('pack_items').update(row).eq('id', item.id));
    else await run(sb.from('pack_items').insert(row));
    closeDialog(); await refresh();
  };
}

// Inside an event: what has to be packed for it
function eventPackSection(ev) {
  if (!ev || !isParent()) return '';
  const list = S.packs.filter((x) => x.event_id === ev.id);
  return `<fieldset class="ev-tasks"><legend>🎒 ${t('td.eventPack')}</legend>
    ${list.length ? `<div class="list">${list.map((x) => `
      <button type="button" class="ev-task" data-act="editPack" data-id="${x.id}">
        <span class="ttl">${esc(x.title)}</span><span class="meta">${esc(x.who || t('td.everyone'))}</span></button>`).join('')}</div>` : ''}
    <div class="sugg"><button type="button" class="chip-btn" data-act="eventPack" data-id="${ev.id}">＋ ${t('td.addToPack')}</button></div>
  </fieldset>`;
}

// Family → Calendar from iPhone: who a phone calendar is about (e.g. Aula → Victor)
function calPeopleForm(cal) {
  openDialog(`
    <form id="calPeopleForm" class="form">
      <h2>👤 ${esc(cal.name)}</h2>
      <p class="hint">${esc(t('td.calWhoHelp'))}</p>
      ${peoplePicker('people', cal.people || [])}
      <div class="btns"><span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button></div>
    </form>`);
  const form = document.getElementById('calPeopleForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    await run(sb.rpc('set_calendar_people', { p_id: cal.id, p_people: pickedPeople(form, 'people') }));
    closeDialog(); await refresh();
  };
}

// ------------------------------------------------------------ skema (school timetable)
// Lessons from calendars marked Skema, one child at a time, as a week grid.
// They are left out of every other list; the Today page links here instead.

const lessonHidden = (ev) => (S.skemaHidden || []).includes(ev.title.trim().toLowerCase());
const allLessons = () => S.events.filter((ev) => ev.lesson);
const lessons = () => allLessons().filter((ev) => !lessonHidden(ev));
const lessonsOn = (d, who) => lessons().filter((ev) => occursOn(ev, d) && (!who || (ev.people || []).includes(who)))
  .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
const skemaKids = () => [...new Set(lessons().flatMap((ev) => ev.people || []))].filter(isKidTag).sort((a, b) => a.localeCompare(b));

function isoWeek(iso) {
  const th = addDays(weekStart(iso), 3);
  return Math.floor(daysBetween(`${th.slice(0, 4)}-01-01`, th) / 7) + 1;
}

// Today page: one line per child instead of the lessons
function skemaLink(d) {
  const kids = skemaKids().map((k) => ({ k, n: lessonsOn(d, k) })).filter((x) => x.n.length);
  if (!kids.length) return '';
  return `<button class="row skema-link" data-act="openSkema" data-id="${d}">
    <span class="lead big">📚</span>
    <span class="body"><span class="ttl">${esc(t('sk.title'))}</span>
      <span class="meta">${kids.map(({ k, n }) => `<b>${esc(personLabel(k))}</b> ${esc(t('sk.lessons', { n: n.length, t: n[0].start_time || '' }))}`).join(' · ')}</span></span>
    <span class="icon">›</span></button>`;
}

// Setup: the names used for "who is it about" – rename or remove one everywhere
function peopleSetupSection() {
  if (!isParent()) return '';
  const names = knownPeople().filter((p) => !children().some((c) => c.display_name === p));
  const joined = children().map((c) => c.display_name).filter((p) => knownPeople().includes(p));
  const all = [...joined, ...names];
  if (!all.length) return '';
  const uses = (p) => S.events.filter((ev) => (ev.people || []).includes(p)).length
    + (S.calendars || []).filter((c) => (c.people || []).includes(p)).length
    + S.packs.filter((x) => x.who === p).length;
  return `<h2>👤 ${esc(t('td.names'))}</h2>
    <div class="card"><p class="meta">${esc(t('td.namesHelp'))}</p>
      <div class="kind-chips sk-hide">${all.map((p) => `<button class="hchip" data-act="editPerson" data-id="${esc(p)}">${esc(p)} <small>${uses(p)}</small> ✎</button>`).join('')}</div></div>`;
}

function personForm(name) {
  openDialog(`
    <form id="personForm" class="form">
      <h2>👤 ${esc(name)}</h2>
      <label>${t('td.rename')}<input name="name" value="${esc(name)}" maxlength="40" required></label>
      <p class="hint">${esc(t('td.renameHelp'))}</p>
      <div class="btns">
        <button type="button" class="danger" data-act="delPerson" data-id="${esc(name)}">${t('delete')}</button>
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  const form = document.getElementById('personForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const nw = form.elements.name.value.trim();
    if (!nw || nw === name) return closeDialog();
    await run(sb.rpc('rename_person', { p_old: name, p_new: nw }));
    closeDialog(); await refresh();
  };
}

// Setup: tap a subject to hide or show it on the Skema page (e.g. RESS)
function skemaSetupSection() {
  if (!isParent() || S.skemaHidden === null) return '';
  const titles = [...new Set(allLessons().map((ev) => ev.title.trim()))].sort((a, b) => a.localeCompare(b));
  if (!titles.length) return '';
  const n = (x) => allLessons().filter((ev) => ev.title.trim() === x).length;
  return `<h2>📚 ${esc(t('sk.title'))}</h2>
    <div class="card"><p class="meta">${esc(t('sk.hideHelp'))}</p>
      <div class="kind-chips sk-hide">${titles.map((x) => { const off = S.skemaHidden.includes(x.toLowerCase());
        return `<button class="hchip ${off ? 'hidden-subj' : 'on'}" data-act="skemaHide" data-id="${esc(x)}" aria-pressed="${!off}">${off ? '🚫 ' : ''}${esc(x)} <small>${n(x)}</small></button>`; }).join('')}</div></div>`;
}

function viewSkema() {
  const kids = skemaKids();
  if (!S.skemaWho || !kids.includes(S.skemaWho)) S.skemaWho = kids[0] || null;
  const td = today();
  const ws = S.skemaWeek || weekStart(td);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i));
  const cols = days.map((d) => ({ d, list: lessonsOn(d, S.skemaWho) }))
    .filter((c, i) => i < 5 || c.list.length);
  const back = `<div class="toolbar"><button data-act="calView" data-id="list">‹ ${t('tabs.calendar')}</button></div>`;
  if (!kids.length) return `${back}<p class="empty">${esc(t('sk.none'))}</p>`;
  const sel = S.skemaDay;
  return `${back}
    <div class="kind-chips">${kids.map((k) => `<button class="hchip ${k === S.skemaWho ? 'on' : ''}" data-act="skemaWho" data-id="${esc(k)}">${esc(personLabel(k))}</button>`).join('')}</div>
    <div class="sk-nav"><button class="icon" data-act="skemaWeek" data-id="-7" aria-label="‹">‹</button>
      <b>${esc(t('sk.week', { n: isoWeek(ws) }))}</b> <span class="meta">${esc(fmtDay(ws, { day: 'numeric', month: 'short' }))} – ${esc(fmtDay(addDays(ws, 4), { day: 'numeric', month: 'short' }))}</span>
      <button class="icon" data-act="skemaWeek" data-id="7" aria-label="›">›</button>
      ${ws !== weekStart(td) ? `<button class="small" data-act="skemaWeek" data-id="0">${esc(t('td.today'))}</button>` : ''}</div>
    <div class="sk-grid" style="grid-template-columns:repeat(${cols.length},1fr)">${cols.map(({ d, list }) => `
      <div class="sk-col ${d === td ? 'today' : ''} ${d === sel ? 'sel' : ''}">
        <div class="sk-day">${esc(fmtDay(d, { weekday: 'short' }))}<small>${esc(fmtDay(d, { day: 'numeric' }))}</small></div>
        ${list.length ? list.map((ev) => `<div class="sk-l"><small>${esc(ev.start_time || '')}</small><b>${esc(ev.title)}</b></div>`).join('')
          : `<div class="sk-free">–</div>`}
      </div>`).join('')}</div>
    <p class="hint">${esc(t('sk.help'))}</p>`;
}

// ------------------------------------------------------------ family day (Familiedag)
// One outing a week, on a day picked each week. Family members take turns
// choosing what to do. Rotation moves on after a week that actually had a
// family day, so a skipped or cancelled week doesn't use up anyone's turn.

const FD_TIME = '11:00';
const fdOrder = () => S.fdOrder || [];
const fdWeek = (ws) => S.fdWeeks.find((w) => w.week_start === ws) || null;

// Whose turn it is in the week starting ws
function fdChooser(ws) {
  const row = fdWeek(ws);
  if (row) return row.chooser;
  const order = fdOrder();
  if (!order.length) return null;
  const prev = S.fdWeeks.filter((w) => w.week_start < ws && w.title && !w.cancelled)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))[0];
  if (!prev) return order[0];
  const i = order.indexOf(prev.chooser);
  return order[i < 0 ? 0 : (i + 1) % order.length];
}
const fdNext = (name) => { const o = fdOrder(); const i = o.indexOf(name); return o.length ? o[(i + 1) % o.length] : name; };

// The week the card is about: this week, or next week once this week's day is over
function fdTarget() {
  const td = today();
  const ws = weekStart(td);
  const row = fdWeek(ws);
  if (row && !row.cancelled && row.title && row.on_date && row.on_date < td) return addDays(ws, 7);
  return ws;
}

const fdWhen = (w) => `${cap(fmtDay(w.on_date, { weekday: 'long', day: 'numeric', month: 'short' }))}${w.at_time ? ` ${t('td.at')} ${w.at_time}` : ''}`;

// The card on Home, Today and Moments. nudgeOnly: show "choose" only from Thursday, or when planned
function famdayCard(nudgeOnly = false) {
  if (!S.fdReady) return '';
  const td = today();
  const ws = fdTarget();
  const row = fdWeek(ws);
  const who = fdChooser(ws);
  if (!who) return nudgeOnly ? '' : `<div class="card famday"><h3>🎲 ${esc(t('fd.title'))}</h3>
    <p class="meta">${esc(t('fd.noOrder'))}</p>${isParent() ? `<div class="acts"><button class="small primary" data-act="fdSetup">⚙️ ${t('fd.setup')}</button></div>` : ''}</div>`;
  const nextWeek = ws > weekStart(td);
  if (row?.cancelled) {
    if (nudgeOnly) return '';
    return `<div class="card famday"><h3>🎲 ${esc(t('fd.title'))}</h3><p class="meta">${esc(t('fd.cancelledWeek'))}</p>
      <div class="acts"><button class="small" data-act="fdUncancel" data-id="${ws}">${t('fd.undoCancel')}</button></div></div>`;
  }
  if (row?.title) {
    const soon = row.on_date ? daysBetween(td, row.on_date) : null;
    if (nudgeOnly && (soon == null || soon > 7)) return '';
    return `<div class="card famday planned">
      <div class="fd-head"><h3>🎉 ${esc(t('fd.title'))}</h3>${soon === 0 ? `<span class="chip yes">${esc(t('isToday'))}</span>` : soon > 0 ? `<span class="chip">${esc(t('inDays', soon))}</span>` : ''}</div>
      <p class="fd-what">${esc(row.emoji || '✨')} ${esc(row.title)}</p>
      <p class="meta">${row.on_date ? esc(fdWhen(row)) + ' · ' : ''}${esc(t('fd.chosenBy', { name: personLabel(row.chooser) }))}</p>
      ${row.note ? `<p class="notes">${esc(row.note)}</p>` : ''}
      <div class="acts"><button class="small" data-act="fdPick" data-id="${ws}">✎ ${t('edit')}</button></div></div>`;
  }
  if (nudgeOnly && !nextWeek && isoDow(td) < 4) return '';
  if (nudgeOnly && nextWeek) return '';
  return `<div class="card famday">
    <div class="fd-head"><h3>🎲 ${esc(t('fd.title'))}${nextWeek ? ` · ${esc(t('fd.nextWeek'))}` : ''}</h3>
      ${isParent() && !nudgeOnly ? `<button class="icon" data-act="fdSetup" aria-label="${esc(t('fd.setup'))}">⚙️</button>` : ''}</div>
    <p class="fd-turn">${t('fd.turn', { name: `<b>${esc(personLabel(who))}</b>` })}</p>
    <div class="acts"><button class="small primary" data-act="fdPick" data-id="${ws}">🎯 ${t('fd.choose')}</button>
      <button class="small" data-act="fdPass" data-id="${ws}">⏭ ${t('fd.pass', { name: personLabel(fdNext(who)) })}</button>
      ${nudgeOnly ? '' : `<button class="small" data-act="fdCancel" data-id="${ws}">${t('fd.cancel')}</button>`}</div></div>`;
}

// When was an idea last done (from earlier weeks)
function fdLast(idea) {
  const td = today();
  const w = S.fdWeeks.filter((x) => x.idea_id === idea.id && x.on_date && x.on_date < td && !x.cancelled)
    .sort((a, b) => b.on_date.localeCompare(a.on_date))[0];
  if (!w) return t('fd.never');
  const n = Math.round(daysBetween(w.on_date, td) / 7);
  return n < 1 ? t('fd.lastDays', daysBetween(w.on_date, td)) : t('fd.lastWeeks', n);
}

async function fdSave(ws, fields) {
  const row = fdWeek(ws);
  const base = { week_start: ws, chooser: row?.chooser || fdChooser(ws), updated_at: new Date().toISOString() };
  await run(sb.from('famday_weeks').upsert({ ...base, ...fields }, { onConflict: 'family_id,week_start' }));
}

// Choose (or change) the activity, day and time for the week starting ws
function fdPickForm(ws) {
  const row = fdWeek(ws) || {};
  const who = fdChooser(ws);
  const td = today();
  const sunday = addDays(ws, 6);
  // default: Saturday of that week, else Sunday, else today
  const day0 = row.on_date || [addDays(ws, 5), sunday].find((x) => x >= td) || td;
  const ideas = S.fdIdeas.slice().sort((a, b) => a.title.localeCompare(b.title));
  const order = [...new Set([...fdOrder(), who])];
  openDialog(`
    <form id="fdForm" class="form">
      <h2>🎯 ${esc(t('fd.title'))}</h2>
      <label>${t('fd.chooser')}<select name="chooser">${order.map((p) =>
        `<option value="${esc(p)}" ${p === who ? 'selected' : ''}>${esc(personLabel(p))}</option>`).join('')}</select></label>
      <div class="seg fd-filter">${['all', 'out', 'in', 'short'].map((f, i) =>
        `<button type="button" data-f="${f}" class="${i ? '' : 'on'}">${esc(t('fd.f_' + f))}</button>`).join('')}</div>
      <div class="fd-ideas">${ideas.map((x) => `
        <label class="fd-idea" data-w="${x.weather}" data-long="${x.long ? 1 : 0}">
          <input type="radio" name="idea" value="${x.id}" ${row.idea_id === x.id ? 'checked' : ''}>
          <span class="em">${esc(x.emoji)}</span><span class="tx"><b>${esc(x.title)}</b>
          <small>${esc([x.weather === 'out' ? t('fd.outdoor') : x.weather === 'in' ? t('fd.indoor') : t('fd.anyWeather'), x.long ? t('fd.long') : t('fd.short'), fdLast(x)].join(' · '))}</small></span></label>`).join('')}
        <label class="fd-idea" data-w="any" data-long="0"><input type="radio" name="idea" value="" ${row.title && !row.idea_id ? 'checked' : ''}>
          <span class="em">✏️</span><span class="tx"><b>${esc(t('fd.other'))}</b></span></label>
      </div>
      <div class="fd-own" hidden>
        <label>${t('fd.what')}<input name="own" maxlength="80" value="${esc(!row.idea_id && row.title ? row.title : '')}"></label>
        <label class="check"><input type="checkbox" name="keep" checked><span>${esc(t('fd.keepIdea'))}</span></label>
      </div>
      <div class="two"><label>${t('td.date')}<input name="on_date" type="date" value="${esc(day0)}" min="${ws > td ? ws : td}" max="${sunday}" required></label>
        <label>${t('td.time')}<input name="at_time" type="time" value="${esc(row.at_time || FD_TIME)}"></label></div>
      <label>${t('notes')}<input name="note" maxlength="300" value="${esc(row.note || '')}" placeholder="${esc(t('fd.notePh'))}"></label>
      <div class="btns">
        ${row.title ? `<button type="button" class="danger" data-act="fdClear" data-id="${ws}">${t('fd.unchoose')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  const form = document.getElementById('fdForm');
  const own = form.querySelector('.fd-own');
  const sync = () => { own.hidden = form.elements.idea.value !== '' || !form.querySelector('input[name=idea]:checked'); };
  form.querySelectorAll('input[name=idea]').forEach((r) => { r.onchange = sync; }); sync();
  form.querySelectorAll('.fd-filter button').forEach((b) => { b.onclick = () => {
    form.querySelectorAll('.fd-filter button').forEach((x) => x.classList.toggle('on', x === b));
    const f = b.dataset.f;
    form.querySelectorAll('.fd-idea').forEach((el) => {
      el.hidden = !(f === 'all' || (f === 'short' ? el.dataset.long === '0' : el.dataset.w === f || el.dataset.w === 'any'));
    });
  }; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    if (!form.querySelector('input[name=idea]:checked')) return toast(t('fd.pickOne'), true);
    let idea = byId(S.fdIdeas, f.get('idea'));
    if (!idea) {
      const title = String(f.get('own') || '').trim();
      if (!title) return toast(t('needTitle'), true);
      if (f.get('keep') === 'on') [idea] = await run(sb.from('famday_ideas').insert({ title, emoji: '✨' }).select());
      else idea = { id: null, title, emoji: '✨' };
    }
    await fdSave(ws, { chooser: f.get('chooser'), idea_id: idea.id, title: idea.title, emoji: idea.emoji,
      on_date: f.get('on_date'), at_time: f.get('at_time') || null, note: String(f.get('note') || '').trim() || null, cancelled: false });
    closeDialog(); toast('🎉'); await refresh();
  };
}

// Parents: turn order, ideas and the last weeks
function fdSetupForm() {
  const order = fdOrder().slice();
  const ideas = S.fdIdeas.slice().sort((a, b) => a.title.localeCompare(b.title));
  const hist = S.fdWeeks.filter((w) => w.title && !w.cancelled && w.on_date && w.on_date < today())
    .sort((a, b) => b.on_date.localeCompare(a.on_date)).slice(0, 10);
  const candidates = [...new Set([...knownPeople(), WIFE, S.me.display_name])].filter((p) => !order.includes(p));
  openDialog(`
    <form id="fdSetup" class="form">
      <h2>⚙️ ${esc(t('fd.title'))}</h2>
      <fieldset><legend>${t('fd.order')}</legend>
        <ol class="fd-order">${order.map((p, i) => `<li data-p="${esc(p)}"><span>${esc(personLabel(p))}</span>
          <button type="button" class="icon" data-mv="-1" aria-label="↑">↑</button><button type="button" class="icon" data-mv="1" aria-label="↓">↓</button>
          <button type="button" class="icon" data-rm aria-label="${esc(t('delete'))}">✕</button></li>`).join('')}</ol>
        <div class="copyrow"><input id="fdAdd" list="fdCand" placeholder="${esc(t('td.otherName'))}" maxlength="40">
          <datalist id="fdCand">${candidates.map((p) => `<option value="${esc(personLabel(p))}">`).join('')}</datalist>
          <button type="button" class="small" id="fdAddBtn">＋</button></div>
        <p class="hint">${esc(t('fd.orderHelp'))}</p>
      </fieldset>
      <fieldset><legend>${t('fd.ideas')} (${ideas.length})</legend>
        <div class="fd-idea-list">${ideas.map((x) => `<div class="fd-irow"><span>${esc(x.emoji)} ${esc(x.title)}</span>
          <button type="button" class="icon" data-act="fdDelIdea" data-id="${x.id}" aria-label="${esc(t('delete'))}">✕</button></div>`).join('')}</div>
        <div class="fd-newidea"><input id="fdIdeaEmoji" maxlength="4" placeholder="✨" class="em">
          <input id="fdIdeaTitle" maxlength="80" placeholder="${esc(t('fd.newIdea'))}">
          <select id="fdIdeaW"><option value="any">${esc(t('fd.anyWeather'))}</option><option value="out">${esc(t('fd.outdoor'))}</option><option value="in">${esc(t('fd.indoor'))}</option></select>
          <label class="check"><input type="checkbox" id="fdIdeaLong"><span>${esc(t('fd.long'))}</span></label>
          <button type="button" class="small" data-act="fdAddIdea">＋ ${t('fd.addIdea')}</button></div>
      </fieldset>
      ${hist.length ? `<details><summary>${esc(t('fd.history'))}</summary><ul class="hist">${hist.map((w) =>
        `<li>${esc(fmtDate(w.on_date, getLang()))}: ${esc(w.emoji || '')} ${esc(w.title)} – ${esc(personLabel(w.chooser))}</li>`).join('')}</ul></details>` : ''}
      <div class="btns"><span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button></div>
    </form>`);
  const form = document.getElementById('fdSetup');
  const list = form.querySelector('.fd-order');
  // names typed as "Min kone" map back to the wife tag
  const fromLabel = (v) => (v === personLabel(WIFE) ? WIFE : v);
  list.onclick = (e) => {
    const li = e.target.closest('li'); if (!li) return;
    if (e.target.dataset.rm !== undefined) li.remove();
    const mv = Number(e.target.dataset.mv || 0);
    if (mv < 0 && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
    if (mv > 0 && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
  };
  form.querySelector('#fdAddBtn').onclick = () => {
    const inp = form.querySelector('#fdAdd'); const v = fromLabel(inp.value.trim());
    if (!v || [...list.children].some((li) => li.dataset.p === v)) return;
    const li = document.createElement('li'); li.dataset.p = v;
    li.innerHTML = `<span>${esc(personLabel(v))}</span><button type="button" class="icon" data-mv="-1">↑</button><button type="button" class="icon" data-mv="1">↓</button><button type="button" class="icon" data-rm>✕</button>`;
    list.appendChild(li); inp.value = '';
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const turn = [...list.children].map((li) => li.dataset.p);
    await run(sb.from('famday').upsert({ family_id: S.family.id, turn_order: turn }));
    closeDialog(); await refresh();
  };
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

// ------------------------------------------------------------ pick, do, plan
// Opgaver = the picker: every task that is up now; the circle PICKS it.
// I dag = what I picked or was given; the circle there marks it DONE.
// Planlæg = parents set up tasks, plans, rooms and chore types.

const taskIcon = (task) => (isHouse(task) ? choreIcon(byId(S.chores, task.chore_id)?.name || task.title) : '✅');
const whereOf = (task) => { const p = byId(S.places, task.place_id); return p && !p.daily ? p.name : ''; };
const lastLine = (task) => { const ld = lastDone(task); return ld ? `${lastAgo(ld)} (${memberName(ld.done_by)})` : t('house.never'); };

// A task in the picker: tap the circle to pick it (again to let it go)
function pickTile(task, st) {
  const others = st.takers.filter((u) => u !== uid());
  const meta = [];
  if (whereOf(task)) meta.push(whereOf(task));
  if (task.recurrence !== 'daily') meta.push(recLabel(task));
  if (isHouse(task)) meta.push(lastLine(task));
  if (task.points) meta.push(`⭐ ${task.points}`);
  let btn;
  if (st.took) btn = `<button class="pick on" data-act="untake" data-id="${task.id}" aria-label="${esc(t('pk.unpick'))}">✓</button>`;
  else if (st.full) btn = `<span class="chip">${esc(t('full'))}</span>`;
  else btn = `<button class="pick" data-act="take" data-id="${task.id}" aria-label="${esc(t('pk.pick'))}"></button>`;
  return `<div class="row ptile ${st.took ? 'is-mine' : ''}">
    <span class="cicon big" aria-hidden="true">${taskIcon(task)}</span>
    <div class="body"><div class="ttl one">${esc(isHouse(task) ? byId(S.chores, task.chore_id)?.name || task.title : task.title)}</div>
      <div class="meta one">${others.length ? others.map((u) => `<span class="chip">${esc(memberName(u))}</span>`).join('') : ''}${meta.map(esc).join(' · ')}</div></div>
    ${btn}</div>`;
}

// A task on I dag: tick it off; picked ones can be let go
function myTaskRow(task, st) {
  const meta = [];
  if (whereOf(task)) meta.push(whereOf(task));
  if (st.kind === 'open') meta.push(t('pk.picked'));
  else meta.push(t('pk.given'));
  if (task.points) meta.push(`⭐ ${task.points}`);
  if (task.remind_time && !st.done) meta.push(remindLabel(task));
  const doneMe = st.doneByMe || (st.done && st.kind !== 'assigned');
  return `<div class="row mytask ${st.done ? 'is-done' : ''}">
    <button class="tick ${doneMe ? 'on' : ''}" data-act="${doneMe ? 'undo' : 'done'}" data-id="${task.id}" aria-label="${esc(doneMe ? t('undo') : t('markDone'))}">${doneMe ? '✓' : ''}</button>
    <span class="cicon big" aria-hidden="true">${taskIcon(task)}</span>
    <div class="body"><div class="ttl one">${esc(taskTitle(task))}</div>
      <div class="meta one">${meta.map(esc).join(' · ')}</div></div>
    ${st.kind === 'open' && st.took && !st.done ? `<button class="icon" data-act="untake" data-id="${task.id}" aria-label="${esc(t('pk.unpick'))}">✕</button>` : ''}
  </div>`;
}

// Mine today: picked by me, or given to me / my role (done ones stay, ticked)
function myTasksToday() {
  return S.tasks.map((task) => ({ task, st: taskState(task) }))
    .filter(({ st }) => st.active && (st.kind === 'open' ? st.took || st.doneByMe : st.forMe))
    .sort((a, b) => a.st.done - b.st.done);
}

function viewTasks() {
  const items = S.tasks.map((task) => ({ task, st: taskState(task) }))
    .filter(({ st }) => st.active && st.kind === 'open' && !st.done);
  const picked = items.filter((x) => x.st.took).length;
  // groups: daily chores, family tasks, then each zone's rooms
  const groups = [];
  const daily = items.filter(({ task }) => isHouse(task) && zoneOf(byId(S.places, task.place_id) || {}) === 'daily');
  const fam = items.filter(({ task }) => !isHouse(task));
  if (daily.length) groups.push([`${ZONE_ICON.daily} ${zoneLabel('daily')}`, daily]);
  if (fam.length) groups.push([`👨‍👩‍👧‍👦 ${t('familyTasks')}`, fam]);
  ['in', 'out'].forEach((z) => {
    const zi = items.filter(({ task }) => isHouse(task) && zoneOf(byId(S.places, task.place_id) || {}) === z)
      .sort((a, b) => sortOf(S.places, a.task.place_id) - sortOf(S.places, b.task.place_id)
        || sortOf(S.chores, a.task.chore_id) - sortOf(S.chores, b.task.chore_id));
    if (zi.length) groups.push([`${ZONE_ICON[z]} ${zoneLabel(z)}`, zi]);
  });
  const doneToday = S.tasks.map((task) => ({ task, st: taskState(task) }))
    .filter(({ st }) => st.active && st.kind === 'open' && st.done);
  return `
    <p class="hint">${esc(t('pk.help'))}</p>
    <div class="toolbar">
      ${picked ? `<button class="primary" data-act="tab" data-id="today">☀️ ${esc(t('pk.goToday', picked))}</button>` : ''}
      ${!isParent() ? `<button data-act="newTask">＋ ${t('newTask')}</button>` : ''}
    </div>
    ${groups.length ? groups.map(([h, list]) => `<h2>${esc(h)} <small class="count">${list.length}</small></h2>
      <div class="list cols">${list.map(({ task, st }) => pickTile(task, st)).join('')}</div>`).join('')
      : `<p class="allgood">${esc(t('pk.none'))}</p>`}
    ${doneToday.length ? `<details><summary>${esc(t('house.doneNow'))} (${doneToday.length})</summary>
      <div class="list cols">${doneToday.map(({ task, st }) => `<div class="row ptile is-done"><span class="cicon big" aria-hidden="true">${taskIcon(task)}</span>
        <div class="body"><div class="ttl one">${esc(taskTitle(task))}</div><div class="meta one">✓ ${esc(st.doneRows.map((d) => memberName(d.done_by)).join(', '))}</div></div></div>`).join('')}</div></details>` : ''}`;
}

// Hjem: who does what today (family tasks that are taken, given or done)
function familyTodaySection() {
  const rows = S.tasks.map((task) => ({ task, st: taskState(task) }))
    .filter(({ st }) => st.active && (st.takers.length || st.doneRows.length || st.kind === 'assigned'));
  const free = S.tasks.map((task) => taskState(task)).filter((st) => st.active && st.kind === 'open' && !st.done && !st.full).length;
  if (!rows.length && !free) return '';
  const people = (task, st) => {
    const ids = st.kind === 'assigned' ? task.assignees : [...new Set([...st.takers, ...st.doneRows.map((d) => d.done_by)])];
    return ids.map((u) => { const ok = st.doneRows.some((d) => d.done_by === u);
      return `<span class="chip ${ok ? 'yes' : ''}">${ok ? '✓' : '○'} ${esc(memberName(u))}</span>`; }).join('');
  };
  return `${rows.length ? `<div class="list cols">${rows.map(({ task, st }) => `<div class="row ptile ${st.done ? 'is-done' : ''}">
      <span class="cicon big" aria-hidden="true">${taskIcon(task)}</span>
      <div class="body"><div class="ttl one">${esc(taskTitle(task))}</div><div class="meta one">${people(task, st)}</div></div></div>`).join('')}</div>` : ''}
    ${free ? `<button class="small" data-act="tab" data-id="tasks">🎯 ${esc(t('pk.freeN', free))}</button>` : ''}`;
}

// Planlæg (parents): tasks & plans, the house, and what was done
function manageRow(task) {
  const st = taskState(task);
  const who = st.kind === 'open' ? t('pk.anyone')
    : st.kind === 'assigned' ? task.assignees.map(memberName).join(', ')
    : task.roles.map((r) => t('roles.' + r)).join(', ');
  const meta = [recLabel(task), who];
  if (task.points) meta.push(`⭐ ${task.points}`);
  return `<button type="button" class="row mrow" data-act="editTask" data-id="${task.id}">
    <span class="cicon big" aria-hidden="true">${taskIcon(task)}</span>
    <span class="body"><span class="ttl one">${esc(task.title)}</span><span class="meta one">${esc(meta.join(' · '))}</span></span>
    <span class="icon" aria-hidden="true">✎</span></button>`;
}

function viewPlan() {
  const mode = ['tasks', 'house', 'log'].includes(S.planMode) ? S.planMode : 'tasks';
  const seg = `<div class="seg house-seg">${['tasks', 'house', 'log'].map((m) =>
    `<button data-act="planMode" data-id="${m}" class="${mode === m ? 'on' : ''}">${esc(t('pl.' + m))}</button>`).join('')}</div>`;
  if (mode === 'house') {
    if (!S.places.length && !S.chores.length) return `${seg}<div class="card"><p>${esc(t('house.empty'))}</p>
      <button class="primary" data-act="seedHouse">${t('house.loadDefaults')}</button></div>`;
    return seg + houseSetup();
  }
  if (mode === 'log') return seg + houseLog();
  const all = S.tasks.filter((task) => !isHouse(task)).map((task) => ({ task, st: taskState(task) }));
  const loose = all.filter(({ task }) => !task.plan_id);
  const plans = S.plans.map((p) => {
    const items = all.filter(({ task }) => task.plan_id === p.id);
    return `<div class="card plan">
      <div class="plan-head"><div><h3>${esc(p.title)}</h3>${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ''}</div>
        <button class="icon" data-act="editPlan" data-id="${p.id}" aria-label="${t('edit')}">✎</button></div>
      <div class="list cols">${items.map(({ task }) => manageRow(task)).join('') || `<p class="empty">${esc(t('noTasks'))}</p>`}</div>
      <button class="small" data-act="newTask" data-id="${p.id}">＋ ${t('addTask')}</button></div>`;
  }).join('');
  return `${seg}
    <div class="toolbar">
      <button class="primary" data-act="newTask">＋ ${t('newTask')}</button>
      <button data-act="newPlan">＋ ${t('newPlan')}</button>
      <button data-act="templatePlan">📋 ${t('fromTemplate')}</button>
      <button data-act="planMode" data-id="house">🏠 ${t('house.addPlace')}</button>
    </div>
    <h2>${esc(t('pl.loose'))}</h2>
    ${loose.length ? `<div class="list cols">${loose.map(({ task }) => manageRow(task)).join('')}</div>` : `<p class="empty">${esc(t('noTasks'))}</p>`}
    <h2>${esc(t('plans'))}</h2>${plans || `<p class="empty">${esc(t('noPlans'))}</p>`}
    ${upcomingEventTasks(all)}`;
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
  // A task for the children gets 10 points unless the parent typed something else
  const pts = form.elements.points;
  if (pts) {
    let touched = Number(pts.value) > 0;
    pts.addEventListener('input', () => { touched = true; });
    const kidIds = children().map((c) => c.user_id);
    const forKids = () => {
      const k = form.elements.kind.value;
      if (k === 'assigned') return [...form.querySelectorAll('input[name=assignees]:checked')].some((x) => kidIds.includes(x.value));
      return [...form.querySelectorAll('input[name=roles]:checked')].some((x) => x.value === 'child');
    };
    const kidPoints = () => { if (!touched) pts.value = forKids() ? 10 : 0; };
    form.addEventListener('change', (e) => { if (e.target !== pts) kidPoints(); });
    kidPoints();
  }
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

function houseRow(task, st, withPlace = false) {
  const chore = byId(S.chores, task.chore_id);
  const meta = [];
  if (st.end && !st.done && task.recurrence !== 'daily') meta.push(t('dueBy', { date: fmtDate(st.end, getLang()) }));
  if (!st.done) { const ld = lastDone(task); meta.push(ld ? `${lastAgo(ld)} (${memberName(ld.done_by)})` : t('house.never')); }
  if (task.points) meta.push(`⭐ ${task.points}`);
  // the quick action on the right: a tick (or who did it)
  let quick;
  let more = '';
  if (st.done) {
    quick = `<span class="chip yes">✓ ${st.doneRows.map((d) => esc(memberName(d.done_by))).join(', ')}</span>`;
    if (st.doneByMe) more = `<button class="small" data-act="undo" data-id="${task.id}">${t('undo')}</button>`;
  } else if (st.full && !st.took) {
    quick = `<span class="chip">${t('full')}</span>`;
  } else {
    quick = `<button class="tick" data-act="${st.took ? 'done' : 'houseDone'}" data-id="${task.id}" aria-label="${esc(t('house.didIt'))}"></button>`;
    more = st.took ? `<button class="small" data-act="untake" data-id="${task.id}">${t('untake')}</button>`
      : `<button class="small" data-act="take" data-id="${task.id}">${t('house.illDoIt')}</button>`;
  }
  const takers = !st.done && st.takers.length
    ? `<div class="takers">${esc(t('takenBy'))}: ${st.takers.map((u) => `<span class="chip">${esc(memberName(u))}</span>`).join('')}
       ${task.need > 1 ? `<span class="need">${st.takers.length}/${task.need}</span>` : ''}</div>` : '';
  const pl = byId(S.places, task.place_id);
  const where = withPlace && pl && !pl.daily ? `<span class="where">${esc(pl.name)}</span> ` : '';
  return `
    <details class="row hrow compact ${st.done ? 'is-done' : ''} ${st.took && !st.done ? 'is-mine' : ''}">
      <summary>
        <div class="body">
          <div class="ttl"><span class="cicon" aria-hidden="true">${choreIcon(chore?.name || task.title)}</span>${where}${esc(chore?.name || task.title)}</div>
          <div class="meta one">${meta.map(esc).join(' · ')}</div>
        </div>
        ${quick}
      </summary>
      <div class="more">
        <div class="meta">${esc(recLabel(task))}</div>
        ${task.notes ? `<div class="notes">${esc(task.notes)}</div>` : ''}
        ${takers}
        ${more ? `<div class="acts">${more}</div>` : ''}
      </div>
    </details>`;
}

// An icon for a chore type, guessed from its name (Danish, English, French)
const CHORE_ICONS = [
  [/støvsug|vacuum|aspir/i, '🧹'], [/gulv|floor|sol\b|serpill/i, '🪣'], [/støv|dust|poussi/i, '🪶'],
  [/plante|blomst|plant|fleur/i, '🪴'], [/ryd|tidy|rang/i, '🧺'], [/vask(?!e)|tøj|laundry|linge|lessive/i, '👕'],
  [/seng|bed|lit\b/i, '🛏️'], [/vindue|window|fenêtre|vitre/i, '🪟'], [/toilet|bad|bath|wc|salle de bain/i, '🚿'],
  [/skrald|affald|trash|bin|poubelle/i, '🗑️'], [/opvask|dishwasher|vaisselle/i, '🍽️'], [/kattebakke|litter|litière/i, '🐈'],
  [/kat|cat|chat|hund|dog|chien/i, '🐾'], [/vand\b|water|eau/i, '💧'], [/bord|table/i, '🍴'], [/mad|cook|dinner|repas|cuisin/i, '🍳'],
  [/græs|lawn|gazon|pelouse/i, '🌱'], [/blade|leaves|feuilles/i, '🍂'], [/ukrudt|weed|mauvaise/i, '🌿'],
  [/olie|oil|huile/i, '🛢️'], [/rens|clean|nettoy/i, '🧽'], [/sne|snow|neige/i, '❄️'], [/bil|car\b|voiture/i, '🚗'],
];
const choreIcon = (name) => (CHORE_ICONS.find(([re]) => re.test(name || '')) || [null, '✨'])[1];
// "1d", "7d" … for the small cells of the house overview
const recShort = (task) => (task.recurrence === 'custom' ? `${task.interval_days}d` : t('recShort.' + task.recurrence));

// House zones: daily chores (no room), indoor rooms, outdoor areas
const ZONES = ['daily', 'in', 'out'];
const ZONE_ICON = { daily: '☀️', in: '🏠', out: '🌳' };
const zoneOf = (x) => (x.daily ? 'daily' : x.outdoor ? 'out' : 'in');
const zoneLabel = (z) => t('house.' + { daily: 'daily', in: 'indoor', out: 'outdoor' }[z]);

function houseTodo() {
  const items = S.tasks.filter(isHouse).map((task) => ({ task, st: taskState(task) })).filter((x) => x.st.active);
  if (!items.length) return `<p class="empty">${esc(t(isParent() ? 'house.noneSetUp' : 'house.nothing'))}</p>`;
  const byChore = (a, b) => sortOf(S.chores, a.task.chore_id) - sortOf(S.chores, b.task.chore_id);
  const mineNow = items.filter((x) => x.st.took && !x.st.done);
  const open = items.filter((x) => !x.st.took && !x.st.done);
  const doneNow = items.filter((x) => x.st.done);

  // Daily chores have no room, so they are one card without a room heading
  const placeCards = (zone) => S.places.filter((p) => zoneOf(p) === zone).map((p) => {
    const rows = open.filter((x) => x.task.place_id === p.id).sort(byChore);
    if (!rows.length) return '';
    return `<div class="card place">${zone === 'daily' ? '' : `<h3>${esc(p.name)}</h3>`}
      <div class="list cols">${rows.map(({ task, st }) => houseRow(task, st)).join('')}</div></div>`;
  }).join('');
  const sections = ZONES.map((z) => [z, placeCards(z)]).filter(([, html]) => html);
  const withPlace = (list) => list.map(({ task, st }) => houseRow(task, st, true)).join('');

  return `
    ${mineNow.length ? `<h2>${esc(t('house.mineNow'))}</h2><div class="list cols">${withPlace(mineNow)}</div>` : ''}
    ${!sections.length ? `<p class="allgood">${esc(t('house.nothing'))}</p>` : ''}
    ${sections.map(([z, html]) => `<h2>${ZONE_ICON[z]} ${esc(zoneLabel(z))}</h2>${html}`).join('')}
    ${doneNow.length ? `<details><summary>${esc(t('house.doneNow'))} (${doneNow.length})</summary>
      <div class="list cols">${withPlace(doneNow)}</div></details>` : ''}`;
}

function houseSetup() {
  const chip = (p, c) => {
    const tk = houseTask(p.id, c.id);
    return `<button class="hchip ${tk ? 'on' : ''}" data-act="setChore" data-id="${p.id}|${c.id}">
      ${esc(c.name)}${tk ? ` · ${esc(recLabel(tk))}${tk.need > 1 ? ` · ${tk.need}👤` : ''}${tk.points ? ` · ⭐${tk.points}` : ''}
      <small class="last">${esc(lastAgo(lastDone(tk)))}</small>` : ''}</button>`;
  };
  const section = (zone) => {
    const places = S.places.filter((p) => zoneOf(p) === zone);
    const chores = S.chores.filter((c) => zoneOf(c) === zone);
    const head = `<h2>${ZONE_ICON[zone]} ${esc(zoneLabel(zone))}</h2>`;
    const types = `<div class="hchips">${chores.map((c) =>
      `<button class="hchip type" data-act="editChoreType" data-id="${c.id}">${esc(c.name)} ✎</button>`).join('')}
      <button class="hchip add" data-act="addChoreType" data-id="${zone}">＋ ${t('house.addChore')}</button></div>`;
    if (zone === 'daily') {
      // One card: the chores themselves (tap to set how often), then the list to rename/add
      return `${head}<div class="card place">
        ${places.length && chores.length ? `<div class="hchips">${places.flatMap((p) => chores.map((c) => chip(p, c))).join('')}</div>` : ''}
        <h3 class="sub">${esc(t('house.choreTypes'))}</h3>${types}</div>`;
    }
    // One grid: a row per room, a column per chore type (with its icon); tap a
    // cell to set how often, an empty cell means not in that room
    const cell = (p, c) => {
      const tk = houseTask(p.id, c.id);
      return `<td><button class="hcell ${tk ? 'on' : ''}" data-act="setChore" data-id="${p.id}|${c.id}"
        aria-label="${esc(`${p.name}: ${c.name}${tk ? ` – ${recLabel(tk)}` : ''}`)}">${tk ? `<b>${esc(recShort(tk))}</b>${tk.need > 1 ? `<small>${tk.need}👤</small>` : ''}` : '<span>＋</span>'}</button></td>`;
    };
    const grid = chores.length && places.length ? `<div class="hgrid-wrap"><table class="hgrid">
        <thead><tr><th></th>${chores.map((c) => `<th><button class="hhead" data-act="editChoreType" data-id="${c.id}">
          <span class="cicon big" aria-hidden="true">${choreIcon(c.name)}</span><small>${esc(c.name)}</small></button></th>`).join('')}</tr></thead>
        <tbody>${places.map((p) => `<tr><th scope="row"><button class="hroom" data-act="editPlace" data-id="${p.id}">${esc(p.name)}</button></th>
          ${chores.map((c) => cell(p, c)).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    return `${head}
      ${grid ? `<div class="card hgrid-card">${grid}<p class="hint">${esc(t('house.gridHelp'))}</p></div>` : ''}
      <div class="card"><h3>${esc(t('house.choreTypes'))}</h3>${types}</div>
      ${!chores.length ? `<p class="hint">${esc(t('house.noTypes'))}</p>` : ''}
      <button class="add-place" data-act="addPlace" data-id="${zone}">＋ ${t('house.addPlace')}</button>`;
  };
  // One section at a time, picked at the top, so the list stays short
  const zone = ZONES.includes(S.setupZone) ? S.setupZone : 'daily';
  const pick = `<div class="seg zone-seg">${ZONES.map((z) =>
    `<button data-act="setupZone" data-id="${z}" class="${z === zone ? 'on' : ''}">${ZONE_ICON[z]} ${esc(zoneLabel(z))}</button>`).join('')}</div>`;
  return `${pick}<p class="hint">${esc(t('house.setupHelp'))}</p>${section(zone)}`;
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
  // the other rooms in the same zone, to copy this chore and frequency to
  const others = p.daily ? [] : S.places.filter((o) => o.id !== p.id && !o.daily && zoneOf(o) === zoneOf(p))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  openDialog(`
    <form id="choreForm" class="form">
      <h2>${esc(p.daily ? c.name : `${c.name} – ${p.name}`)}</h2>
      <label>${t('recurrence')}<select name="recurrence">${recs.map((r) =>
        `<option value="${r}" ${r === cur ? 'selected' : ''}>${esc(r === 'none' ? t('house.off') : t('rec.' + r))}</option>`).join('')}</select></label>
      <label data-rec="custom">${t('intervalN')}<input name="interval_days" type="number" min="1" value="${tk?.interval_days || 14}"></label>
      <label data-rec="${on}">${t('need')}<input name="need" type="number" min="1" max="20" value="${tk?.need || 1}"></label>
      <label data-rec="${on}">⭐ ${t('points')}<input name="points" type="number" min="0" max="1000" value="${tk?.points || 0}"></label>
      <label data-rec="${on}">${t('note')}<input name="notes" value="${esc(tk?.notes || '')}"></label>
      ${others.length ? `<fieldset class="also"><legend>${esc(t('house.alsoIn'))}</legend>
        <div class="checks">${others.map((o) => { const ot = houseTask(o.id, choreId);
          return `<label class="check"><input type="checkbox" name="also" value="${o.id}"><span>${esc(o.name)}${ot ? ` <small>(${esc(recShort(ot))})</small>` : ''}</span></label>`; }).join('')}</div>
        <button type="button" class="small" id="alsoAll">${esc(t('house.alsoAll'))}</button>
        <p class="hint">${esc(t('house.alsoHelp'))}</p></fieldset>` : ''}
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
  const allBtn = form.querySelector('#alsoAll');
  if (allBtn) allBtn.onclick = () => {
    const boxes = [...form.querySelectorAll('input[name=also]')];
    const to = boxes.some((b) => !b.checked);
    boxes.forEach((b) => { b.checked = to; });
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const rec = f.get('recurrence');
    // this room plus any rooms ticked under "also in"
    const targets = [p, ...f.getAll('also').map((id) => byId(S.places, id)).filter(Boolean)];
    for (const pl of targets) {
      const cur = houseTask(pl.id, choreId);
      if (rec === 'none') {
        if (cur) await run(sb.from('tasks').delete().eq('id', cur.id));
        continue;
      }
      const row = {
        title: pl.daily ? c.name : `${c.name} – ${pl.name}`, notes: f.get('notes').trim() || null,
        recurrence: rec, interval_days: rec === 'custom' ? Math.max(1, Number(f.get('interval_days')) || 1) : null,
        need: Math.min(20, Math.max(1, Number(f.get('need')) || 1)),
        points: Math.min(1000, Math.max(0, Math.round(Number(f.get('points')) || 0))),
        open: true, roles: HOUSE_ROLES, assignees: [], place_id: pl.id, chore_id: choreId,
      };
      // keep the start date when only the details change, so periods don't shift
      if (!cur || cur.recurrence !== rec || cur.interval_days !== row.interval_days) row.start_date = today();
      if (cur) await run(sb.from('tasks').update(row).eq('id', cur.id));
      else await run(sb.from('tasks').insert(row));
    }
    closeDialog(); await refresh();
  };
}

// Add/rename/move/delete a room (house_places) or a chore type (house_chores)
function houseItemForm(table, item, zone) {
  const isPlace = table === 'house_places';
  const cur = item ? zoneOf(item) : zone;
  const zones = isPlace ? ['in', 'out'] : ZONES; // daily chores need no room
  openDialog(`
    <form id="houseItemForm" class="form">
      <h2>${item ? t('edit') : t(isPlace ? 'house.addPlace' : 'house.addChore')}</h2>
      <label>${t('house.name')}<input name="name" value="${esc(item?.name || '')}" required></label>
      <label>${t('house.where')}<select name="zone">${zones.map((z) =>
        `<option value="${z}" ${z === cur ? 'selected' : ''}>${esc(zoneLabel(z))}</option>`).join('')}</select></label>
      ${item && isPlace ? `<p class="hint">${esc(t('house.moveHint'))}</p>` : ''}
      ${!isPlace && cur !== 'daily' ? `<p class="hint">${esc(t('house.dailyHint'))}</p>` : ''}
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
    const z = f.get('zone');
    const row = { name: f.get('name').trim(), outdoor: z === 'out', daily: z === 'daily' };
    if (!row.name) return;
    // Names are unique per family (ignoring upper/lower case)
    const same = (isPlace ? S.places : S.chores).find((x) => x.id !== item?.id && x.name.trim().toLowerCase() === row.name.toLowerCase());
    if (same) return toast(t(isPlace ? 'house.dupPlace' : 'house.dupChore', { name: same.name }), true);
    let choreId = item?.id;
    if (item) {
      await run(sb.from(table).update(row).eq('id', item.id));
      // a chore moved to another section: its old room settings no longer apply
      if (!isPlace && zoneOf(item) !== z) await run(sb.from('tasks').delete().eq('chore_id', item.id));
    } else {
      const list = isPlace ? S.places : S.chores;
      row.sort = list.reduce((m, x) => Math.max(m, x.sort), 0) + 1;
      const [created] = await run(sb.from(table).insert(row).select());
      choreId = created.id;
    }
    // A daily chore is switched on straight away, every day
    if (!isPlace && z === 'daily' && (!item || zoneOf(item) !== 'daily')) {
      let place = S.places.find((p) => p.daily);
      if (!place) [place] = await run(sb.from('house_places').insert({ name: t('house.daily'), daily: true, outdoor: false, sort: 0 }).select());
      await run(sb.from('tasks').insert({ title: row.name, recurrence: 'daily', need: 1, points: 0, open: true,
        roles: HOUSE_ROLES, assignees: [], place_id: place.id, chore_id: choreId, start_date: today() }));
    }
    closeDialog(); await refresh();
  };
}

// ------------------------------------------------------------ moments

const entriesOf = (id) => S.entries.filter((e) => e.tracker_id === id);
const FAMILY_KINDS = ['vacation', 'takeaway', 'restaurant', 'movie', 'weekend', 'themepark'];
const COUPLE_KINDS = ['flowers', 'surprise', 'date', 'trip'];
const KIND_ICON = { vacation: '🏖️', takeaway: '🥡', restaurant: '🍽️', movie: '🎬', weekend: '🧳', themepark: '🎢', custom: '⭐',
  flowers: '💐', surprise: '🎁', date: '🥂', trip: '✈️' };
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
        ${editable ? `<button data-act="planMoment" data-id="${tr.id}">📅 ${t(tr.planned_on ? 'changePlan' : 'plan')}</button>` : ''}
        <button data-act="openFind" data-id="${tr.id}">🔎 ${t('find')}</button>
      </div>
      ${!compact && hist.length ? `<details><summary>${t('history')}</summary><ul class="hist">${hist.map((e) => `
        <li>${fmtDate(e.done_on, getLang())} ${t('by')} ${esc(memberName(e.done_by))}${e.note ? ` – ${esc(e.note)}` : ''}
        ${e.done_by === uid() ? `<button class="link" data-act="delEntry" data-id="${e.id}">${t('delete')}</button>` : ''}</li>`).join('')}
      </ul></details>` : ''}
    </div>`;
}

function viewMoments() {
  if (S.find) return viewMomentFind();
  const td = today();
  const order = (x) => (plannedAhead(x.tr) ? 100000 + daysBetween(td, x.tr.planned_on) : x.st.dueIn);
  const items = S.trackers
    .map((tr) => ({ tr, st: trackerStatus(tr.interval_days, entriesOf(tr.id).map((e) => e.done_on), td) }))
    .sort((a, b) => order(a) - order(b));
  const fam = items.filter((x) => isFamilyMoment(x.tr)).map(({ tr, st }) => momentCard(tr, st)).join('');
  const own = items.filter((x) => !isFamilyMoment(x.tr)).map(({ tr, st }) => momentCard(tr, st)).join('');
  // Pick "Hele familien" or "Os to" at the top when there are both
  const both = fam && own;
  const tab = !both ? (fam ? 'family' : 'own') : S.momentTab === 'own' ? 'own' : 'family';
  const pick = both ? `<div class="seg zone-seg">
      <button data-act="momentTab" data-id="family" class="${tab === 'family' ? 'on' : ''}">👨‍👩‍👧‍👦 ${esc(t('momentsFamily'))}</button>
      <button data-act="momentTab" data-id="own" class="${tab === 'own' ? 'on' : ''}">💛 ${esc(t('momentsOwn'))}</button></div>` : '';
  const newBtn = tab === 'family' && isParent()
    ? `<button class="primary" data-act="newFamilyMoment">＋ ${t('newFamilyMoment')}</button>`
    : `<button class="primary" data-act="newMoment">＋ ${t('newMoment')}</button>`;
  return `${pick}<div class="toolbar">${newBtn}<button data-act="openFind" data-id="">🔎 ${t('findIdeas')}</button></div>
    ${tab === 'family' ? famdayCard() + fam : own}
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
function momentPlanForm(tr, pre = {}) {
  const h = t('planNoteHint.' + tr.kind);
  const hint = h.startsWith('planNoteHint') ? '' : h;
  openDialog(`
    <form id="momentPlanForm" class="form">
      <h2>📅 ${esc(tr.title)}</h2>
      <label>${t('date')}<input name="planned_on" type="date" min="${today()}" value="${pre.date || tr.planned_on || ''}" required></label>
      <label>${t('planNote')}<input name="plan_note" value="${esc(pre.note ?? tr.plan_note ?? '')}" placeholder="${esc(hint)}"></label>
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

// ------------------------------------------------------------ find (moments)
// A page to search and pick from: places near home (takeaway grouped by food
// type, restaurants, cinemas, florists), hand-picked lists (theme parks,
// destinations) and ideas. Picking fills in the plan of the moment.

const FIND_KINDS = () => [...FAMILY_KINDS, ...COUPLE_KINDS, 'custom'];

async function loadNearby() {
  const out = [];
  for (let from = 0; ; from += 1000) {   // the API returns at most 1000 rows at a time
    const part = await run(sb.from('nearby_places').select('*').order('minutes').order('name').range(from, from + 999));
    out.push(...part);
    if (part.length < 1000) break;
  }
  S.nearby = out;
}

function findGroups(kind) {
  const L = getLang();
  const groups = [];
  let state = null;
  const cats = NEARBY[kind] || [];
  const placeItem = (p) => ({
    name: p.name, extra: p.cuisine || '',
    sub: [t(p.estimated ? 'minutesEst' : 'minutesN', { n: p.minutes }), p.address].filter(Boolean).join(' · '),
    note: p.name, map: `https://maps.apple.com/?q=${encodeURIComponent(p.name)}&ll=${p.lat},${p.lon}`,
    web: p.website && /^https?:\/\//i.test(p.website) ? p.website : null, phone: p.phone,
  });
  if (cats.length) {
    if (S.family?.home_lat == null) state = 'nohome';
    else if (S.nearby === null) state = 'loading';
    else if (!S.nearby.length) state = 'empty';
    else {
      for (const cat of cats) {
        const list = S.nearby.filter((p) => p.cats.includes(cat));
        if (cat === 'takeaway' || cat === 'restaurant') {
          // grouped by food type / country, biggest groups first, "Andet" last
          CUISINES.map((c) => ({ c, items: list.filter((p) => (p.grp || 'other') === c.key) }))
            .filter((x) => x.items.length)
            .sort((a, b) => (a.c.key === 'other') - (b.c.key === 'other') || b.items.length - a.items.length)
            .forEach(({ c, items }) => groups.push({ icon: c.icon, label: c[L] || c.en, items: items.map(placeItem) }));
        } else if (list.length) {
          groups.push({ icon: '', label: t('placeCats.' + cat), items: list.map(placeItem) });
        }
      }
      if (!groups.length) state = 'none';
    }
  }
  for (const g of CATALOG[kind] || []) {
    groups.push({ icon: g.icon, label: g.label[L] || g.label.en,
      items: g.items.map(([name, sub, url]) => ({ name, sub, note: sub ? `${name} (${sub})` : name, web: url || null })) });
  }
  const ideas = IDEAS[L][kind] || IDEAS[L].custom || [];
  if (ideas.length) groups.push({ icon: '💡', label: t('ideasGroup'), items: ideas.map((x) => ({ name: x, note: x })) });
  return { groups, state };
}

function viewMomentFind() {
  const f = S.find;
  const tr = f.trId ? byId(S.trackers, f.trId) : null;
  const target = tr || S.trackers.find((x) => x.kind === f.kind && canEditMoment(x));
  const pickable = !!target && canEditMoment(target);
  const { groups, state } = findGroups(f.kind);
  S.findItems = [];
  const stateMsg = {
    nohome: `<div class="card"><p>${esc(t('nearbyNeedHome'))}</p>
      ${isParent() ? `<button class="primary small" data-act="tab" data-id="family">${t('goFamily')}</button>` : ''}</div>`,
    loading: `<p class="empty">⏳ ${esc(t('loading'))}</p>`,
    empty: `<div class="card"><p>${esc(t('nearbyNone'))}</p>
      ${isParent() ? `<button class="primary small" data-act="refreshNearby">${t('nearbyFind')}</button>` : `<p class="hint">${esc(t('nearbyOnlyParents'))}</p>`}</div>`,
    none: `<p class="empty">${esc(t('nearbyNoKind', { min: S.family?.nearby_minutes || 20 }))}</p>`,
  }[state] || '';
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const item = (it, g) => {
    const idx = S.findItems.push(it) - 1;
    const text = `${it.name} ${it.sub || ''} ${it.extra || ''} ${g.label}`.toLowerCase();
    return `
      <div class="row find-item" data-text="${esc(text)}">
        <div class="body"><div class="ttl">${esc(it.name)}</div>${it.sub ? `<div class="meta">${esc(it.sub)}</div>` : ''}</div>
        <div class="find-acts">
          ${it.map ? `<a class="ext" href="${esc(it.map)}" target="_blank" rel="noopener" aria-label="${t('mapLink')}">🗺️</a>` : ''}
          ${it.web ? `<a class="ext" href="${esc(it.web)}" target="_blank" rel="noopener" aria-label="${t('website')}">🌐</a>` : ''}
          ${it.phone ? `<a class="ext" href="tel:${esc(it.phone.replace(/[^\d+]/g, ''))}" aria-label="☎">☎️</a>` : ''}
          ${pickable ? `<button class="small primary" data-act="findPick" data-id="${idx}">${t('pick')}</button>` : ''}
        </div>
      </div>`;
  };
  return `
    <div class="find-head">
      <button class="link" data-act="findBack">← ${t('back')}</button>
      <h2>🔎 ${esc(t('find'))}${target ? ` · ${esc(target.title)}` : ''}</h2>
    </div>
    <div class="kind-chips">${FIND_KINDS().map((k) => `<button class="hchip ${k === f.kind ? 'on' : ''}" data-act="findKind" data-id="${k}">${KIND_ICON[k] || ''} ${esc(t('kinds.' + k))}</button>`).join('')}</div>
    <input id="momentQ" class="find-q" type="search" placeholder="${esc(t('momentSearch'))}" autocomplete="off" enterkeyhint="search">
    ${!target ? `<p class="hint">${esc(t('noMomentKind', { kind: t('kinds.' + f.kind) }))}</p>` : !pickable ? `<p class="hint">${esc(t('findBrowseOnly'))}</p>` : ''}
    ${bookOnline(f.kind)}
    ${stateMsg}
    ${groups.map((g) => {
      const open = g.items.length <= 6 || groups.length === 1 || total <= 12;
      return `<details class="find-group" data-open="${open ? 1 : 0}" ${open ? 'open' : ''}>
        <summary>${g.icon} ${esc(g.label)} <span class="count">(${g.items.length})</span></summary>
        <div class="list">${g.items.map((it) => item(it, g)).join('')}</div></details>`;
    }).join('')}
    ${NEARBY[f.kind] && S.nearbyMeta?.n ? `<p class="hint src">${esc(t('nearbySource', { min: S.family?.nearby_minutes || 20 }))}</p>` : ''}`;
}

// Links to book or order online for this moment type, and a map search around home
function bookOnline(kind) {
  const L = getLang();
  const links = isParent() ? onlineLinks(kind) : []; // ordering and booking is for parents
  const q = MAP_QUERY[kind];
  const f = S.family || {};
  const map = q ? `https://maps.apple.com/?q=${encodeURIComponent(q)}${f.home_lat != null ? `&sll=${f.home_lat},${f.home_lon}&z=13` : ''}` : null;
  if (!links.length && !map) return '';
  return `
    <div class="book-online">
      <h3 class="subhead">🔗 ${esc(t('bookOnline'))}</h3>
      <div class="book-links">
        ${links.map((x) => `<a class="book-link" href="${esc(x.url)}" target="_blank" rel="noopener">
          <strong>${esc(x.name)}</strong><span>${esc(x.about[L] || x.about.en)}</span></a>`).join('')}
        ${map ? `<a class="book-link map" href="${esc(map)}" target="_blank" rel="noopener">
          <strong>🗺️ ${esc(t('mapNearHome'))}</strong><span>${esc(t(f.home_lat != null ? 'mapNearHomeHint' : 'mapSearchHint', { q }))}</span></a>` : ''}
      </div>
    </div>`;
}

// Parents: the home address that "near home" is measured from
function homeSection() {
  if (!isParent()) return '';
  const f = S.family || {};
  const m = S.nearbyMeta;
  return `
    <h2>🏠 ${esc(t('homeTitle'))}</h2>
    <div class="card">
      <form id="homeForm" class="form">
        <label>${t('homeAddress')}<input name="address" value="${esc(f.home_address || '')}" placeholder="${esc(t('homePlaceholder'))}" autocomplete="street-address" required></label>
        <label>${t('homeMinutes')}<input name="minutes" type="number" min="5" max="60" value="${f.nearby_minutes || 20}"></label>
        <button class="primary" type="submit">${t('save')}</button>
      </form>
      ${f.home_lat != null ? `
        <p class="meta">${m?.n ? esc(t('nearbyFound', m.n)) + (m.at ? ' · ' + esc(t('nearbyUpdated', { date: fmtDate(m.at.slice(0, 10), getLang()) })) : '') : esc(t('nearbyNone'))}</p>
        <button class="small" data-act="refreshNearby">${t(m?.n ? 'nearbyRefresh' : 'nearbyFind')}</button>` : ''}
      <p class="hint">${esc(t('homeHint'))}</p>
    </div>`;
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

// Names of my phone calendars an event comes from (other parents' calendars are private)
const CAL_DOTS = ['#2F6FB3', '#E58A2E', '#8B5CF6', '#0E9F6E', '#D9536A', '#B7791F', '#0891B2', '#6B7280'];
const evCalIds = (ev) => [...new Set((S.evSources || []).filter((x) => x.event_id === ev.id).map((x) => x.calendar_id))];
const calDot = (id) => {
  const i = S.calendars.findIndex((c) => c.id === id);
  return `<span class="caldot" style="background:${CAL_DOTS[(i < 0 ? 0 : i) % CAL_DOTS.length]}"></span>`;
};
function calFilter() { const f = store('hl-calf'); return f || 'all'; }

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
        <div class="meta">${esc(range)}${when ? ` · <strong>${esc(when)}</strong>` : ''}${ev.imported ? ` · ${evCalIds(ev).map((c) => calDot(c)).join('')}` : ''}${nTasks ? ` · ✅ ${esc(t('nTasks', nTasks))}` : ''}</div></div>
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
  if (S.calView === 'find' && isParent()) return viewFind();
  if (S.calView === 'skema') return viewSkema();
  const td = today();
  // Filter by calendar: all, made in the app, or one of my phone calendars
  const cals = isParent() ? S.calendars.filter((c) => S.events.some((ev) => evCalIds(ev).includes(c.id))) : [];
  let cf = calFilter();
  if (cf !== 'all' && cf !== 'own' && !cals.some((c) => c.id === cf)) cf = 'all';
  const inFilter = (ev) => cf === 'all' || (cf === 'own' ? !ev.imported : evCalIds(ev).includes(cf));
  const count = (fn) => S.events.filter(fn).length;
  const chips = cals.length ? `<div class="kind-chips cal-chips">
      <button class="hchip ${cf === 'all' ? 'on' : ''}" data-act="calFilter" data-id="all">${esc(t('calFilterAll'))} (${S.events.length})</button>
      ${count((ev) => !ev.imported) ? `<button class="hchip ${cf === 'own' ? 'on' : ''}" data-act="calFilter" data-id="own">✏️ ${esc(t('calFilterOwn'))} (${count((ev) => !ev.imported)})</button>` : ''}
      ${cals.map((c) => `<button class="hchip ${cf === c.id ? 'on' : ''}" data-act="calFilter" data-id="${c.id}">${calDot(c.id)}${esc(c.name)} (${count((ev) => evCalIds(ev).includes(c.id))})</button>`).join('')}
    </div>` : '';
  const all = S.events.filter((ev) => !ev.lesson && inFilter(ev)).map((ev) => ({ ev, st: eventStatus(ev, td) }));
  // weekly series (lessons etc.) get their own folded section, so they don't crowd the list
  const weekly = all.filter(({ ev, st }) => ev.every_weeks && st.days >= 0).sort((a, b) => a.st.days - b.st.days);
  const list = all.filter((x) => !weekly.includes(x));
  const future = list.filter(({ ev, st }) => st.ongoing || st.days >= 0 || (ev.end_date && ev.end_date >= td))
    .sort((a, b) => a.st.days - b.st.days);
  const past = list.filter((x) => !future.includes(x)).sort((a, b) => b.st.date.localeCompare(a.st.date));
  const syncHint = isParent() && !S.sync?.last_sync_at
    ? `<p class="hint">📱 ${esc(t('calSyncHint'))} <button class="link" data-act="tab" data-id="family">${t('tabs.family')} →</button></p>` : '';
  const nNew = findNewCount();
  const findBtn = isParent() && (S.inbox.length || S.calendars.some((c) => c.pick))
    ? `<button data-act="calView" data-id="find">🔍 ${t('findEvents')}${nNew ? ` <span class="badge">${nNew}</span>` : ''}</button>` : '';
  const skemaBtn = lessons().length ? `<button data-act="openSkema" data-id="">📚 ${t('sk.title')}</button>` : '';
  return `<div class="toolbar"><button class="primary" data-act="newEvent">＋ ${t('newEvent')}</button>${skemaBtn}${findBtn}</div>
    ${chips}
    ${isParent() && S.events.length ? `<p class="hint">${esc(t('tapEventForTasks'))}</p>` : ''}
    ${future.length ? `<div class="list">${future.map(({ ev, st }) => eventRow(ev, st)).join('')}</div>` : `<p class="empty">${esc(t('noEvents'))}</p>`}
    ${weekly.length ? `<details class="weekly"><summary>🔁 ${esc(t('weeklyEvents'))} (${weekly.length})</summary><div class="list">${weekly.map(({ ev, st }) => eventRow(ev, st)).join('')}</div></details>` : ''}
    ${syncHint}
    ${past.length ? `<details><summary>${t('history')}</summary><div class="list">${past.map(({ ev, st }) => eventRow(ev, st)).join('')}</div></details>` : ''}`;
}

// ------------------------------------------------------------ find events
// Events from calendars set to "Pick myself" (e.g. Aula, ForældreIntra). Like
// the HØBK calendar: one Filter button opens a sheet with every option, the
// active choices show as removable chips, and the filter is kept on the phone.

const FIND_DEFAULT = { off: [], days: 31, show: ['new', 'followed'], series: true };
const FIND_DAYS = [14, 31, 92, 0];   // 0 = everything
const CAL_COLORS = ['#2F6FB3', '#E58A2E', '#8B5CF6', '#0E9F6E', '#D9536A', '#B7791F', '#0891B2', '#6B7280'];

const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

function findFilter() {
  try { return { ...FIND_DEFAULT, ...JSON.parse(store('hl-findf') || '{}') }; } catch { return { ...FIND_DEFAULT }; }
}
function saveFindFilter(f) { store('hl-findf', JSON.stringify(f)); }

const pickCals = () => S.calendars.filter((c) => c.pick || S.inbox.some((x) => x.calendar_id === c.id));
const calColor = (id) => { const i = pickCals().findIndex((c) => c.id === id); return CAL_COLORS[(i < 0 ? 0 : i) % CAL_COLORS.length]; };
const calName = (id) => byId(S.calendars, id)?.name || '';

// The date an inbox row is next on (series: the next lesson), or null when it is over
function findDate(x, td) {
  if (x.every_weeks) return nextWeekly(x, td);
  if (x.start_date >= td) return x.start_date;
  return x.end_date && x.end_date >= td ? td : null;
}

function findNewCount() {
  const td = today(), until = addDays(td, 31);
  return S.inbox.filter((x) => x.status === 'new' && !x.every_weeks && (findDate(x, td) || '9') <= until).length;
}

// Choices that differ from the default, as removable chips
function findChips(f) {
  const chips = [];
  for (const id of f.off) if (byId(S.calendars, id)) chips.push([`cal|${id}`, `${t('fNot')} ${calName(id)}`]);
  if (f.days !== FIND_DEFAULT.days) chips.push(['days', f.days ? t('fNext', { p: t('fP' + f.days) }) : t('fPall')]);
  for (const k of ['new', 'followed', 'hidden']) {
    if (f.show.includes(k) !== FIND_DEFAULT.show.includes(k))
      chips.push([`show|${k}`, `${f.show.includes(k) ? '' : t('fNot') + ' '}${t('fShow_' + k)}`]);
  }
  if (!f.series) chips.push(['series', t('fNoSeries')]);
  return chips;
}

function findMatches(f, q) {
  const td = today(), until = f.days ? addDays(td, f.days) : '9999-12-31';
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return S.inbox.map((x) => ({ x, d: findDate(x, td) })).filter(({ x, d }) => d && d <= until
    && !f.off.includes(x.calendar_id) && f.show.includes(x.status)
    && (f.series || !x.every_weeks)
    && words.every((w) => `${x.title} ${calName(x.calendar_id)}`.toLowerCase().includes(w)));
}

function findRow({ x, d }) {
  const lang = getLang();
  const ev = x.event_id && byId(S.events, x.event_id);
  const nTasks = ev ? S.tasks.filter((k) => k.event_id === ev.id).length : 0;
  const when = x.every_weeks ? weeklyLabel(x, { date: d, days: 0 })
    : x.end_date ? `${fmtDate(x.start_date, lang)} – ${fmtDate(x.end_date, lang)}` : '';
  const meta = [calName(x.calendar_id), when].filter(Boolean).map(esc).join(' · ');
  let acts;
  if (x.status === 'followed' && ev) {
    acts = `<button class="small" data-act="editEvent" data-id="${ev.id}">✅ ${nTasks ? esc(t('nTasks', nTasks)) : t('addTasks')}</button>`;
  } else if (x.status === 'hidden') {
    acts = `<button class="small" data-act="inbox" data-id="${x.id}|new">${t('unhide')}</button>`;
  } else {
    acts = `<button class="small primary" data-act="inbox" data-id="${x.id}|followed">${t('follow')}</button>
      <button class="icon" data-act="inbox" data-id="${x.id}|hidden" aria-label="${esc(t('hide'))}" title="${esc(t('hide'))}">✕</button>`;
  }
  return `
    <div class="row find st-${x.status}" style="--cal:${calColor(x.calendar_id)}">
      <span class="dot" aria-hidden="true"></span>
      <div class="time">${esc(x.start_time || t('allDayShort'))}</div>
      <div class="body"><div class="ttl">${x.status === 'followed' ? '✓ ' : ''}${esc(x.title)}</div>
        <div class="meta">${meta}</div></div>
      <div class="find-acts">${acts}</div>
    </div>`;
}

function dayHeading(iso, td) {
  const n = daysBetween(td, iso);
  const lang = getLang();
  const label = new Date(`${iso}T12:00:00Z`).toLocaleDateString({ da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[lang] || 'da-DK',
    { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return n === 0 ? `${t('todayWord')} · ${label}` : n === 1 ? `${t('tomorrow')} · ${label}` : label;
}

function findListHtml() {
  const f = findFilter(), td = today();
  const all = findMatches(f, S.findQ);
  const singles = all.filter(({ x }) => !x.every_weeks);
  const series = all.filter(({ x }) => x.every_weeks);
  if (!all.length) return `<p class="empty">${esc(t('findEmpty'))}</p>`;
  const days = [];
  for (const it of singles) {
    const last = days[days.length - 1];
    if (last && last.d === it.d) last.items.push(it); else days.push({ d: it.d, items: [it] });
  }
  return `
    ${days.map(({ d, items }) => `<h3 class="day">${esc(dayHeading(d, td))}</h3>
      <div class="list">${items.map(findRow).join('')}</div>`).join('')}
    ${series.length ? `<details class="weekly"${singles.length ? '' : ' open'}><summary>🔁 ${esc(t('weeklyEvents'))} (${series.length})</summary>
      <div class="list">${series.map(findRow).join('')}</div></details>` : ''}`;
}

function viewFind() {
  const f = findFilter();
  const chips = findChips(f);
  const cals = pickCals();
  const top = `<div class="toolbar find-bar">
      <button data-act="calView" data-id="list">‹ ${t('tabs.calendar')}</button>
      <input type="search" id="findQ" placeholder="${esc(t('findSearch'))}" value="${esc(S.findQ)}" aria-label="${esc(t('findSearch'))}">
      <button class="${chips.length ? 'on' : ''}" data-act="findFilter">⚙︎ ${chips.length ? esc(t('filterN', { n: chips.length })) : t('filter')}</button>
    </div>`;
  if (!cals.length) {
    return `${top}<div class="card"><p>${esc(t('findNone'))}</p>
      <button class="primary" data-act="tab" data-id="family">${t('tabs.family')} →</button></div>`;
  }
  return `${top}
    ${chips.length ? `<div class="fchips">${chips.map(([k, label]) =>
      `<button class="fchip" data-act="findChip" data-id="${esc(k)}">${esc(label)} <span aria-hidden="true">✕</span></button>`).join('')}
      <button class="link" data-act="findReset">${t('fReset')}</button></div>` : ''}
    <div class="ckey">${cals.filter((c) => !f.off.includes(c.id)).map((c) =>
      `<span style="--cal:${calColor(c.id)}"><i class="dot"></i>${esc(c.name)}</span>`).join('')}</div>
    <p class="hint">${esc(t('findHelp'))}</p>
    <div id="findList">${findListHtml()}</div>`;
}

// The filter sheet: every option in one place; changes apply at once
function findFilterSheet() {
  const f = findFilter();
  const cals = pickCals();
  openDialog(`
    <form id="findForm" class="form sheet">
      <h2>⚙︎ ${t('filter')}</h2>
      <fieldset><legend>${t('fCals')}</legend><div class="checks">${cals.map((c) => `
        <label class="check" style="--cal:${calColor(c.id)}"><input type="checkbox" name="cal" value="${c.id}" ${f.off.includes(c.id) ? '' : 'checked'}>
          <span><i class="dot"></i>${esc(c.name)}</span></label>`).join('')}</div></fieldset>
      <fieldset><legend>${t('fPeriod')}</legend><div class="checks">${FIND_DAYS.map((d) => `
        <label class="check"><input type="radio" name="days" value="${d}" ${f.days === d ? 'checked' : ''}>
          <span>${esc(t('fP' + (d || 'all')))}</span></label>`).join('')}</div></fieldset>
      <fieldset><legend>${t('fShow')}</legend><div class="checks">${['new', 'followed', 'hidden'].map((k) => `
        <label class="check"><input type="checkbox" name="show" value="${k}" ${f.show.includes(k) ? 'checked' : ''}>
          <span>${esc(cap(t('fShow_' + k)))}</span></label>`).join('')}</div></fieldset>
      <label class="check"><input type="checkbox" name="series" ${f.series ? 'checked' : ''}><span>${esc(t('fSeries'))}</span></label>
      <div class="btns">
        <button type="button" data-act="findReset">${t('fReset')}</button>
        <span class="grow"></span>
        <button class="primary" type="button" data-act="close">${t('fDone')}</button>
      </div>
    </form>`);
  const form = document.getElementById('findForm');
  form.onchange = () => {
    const fd = new FormData(form);
    const on = fd.getAll('cal');
    saveFindFilter({
      off: cals.map((c) => c.id).filter((id) => !on.includes(id)),
      days: Number(fd.get('days')) || 0,
      show: fd.getAll('show'),
      series: fd.get('series') === 'on',
    });
    render();
  };
}

// Search: only the list is redrawn, so the keyboard stays up
document.addEventListener('input', (e) => {
  if (e.target.id !== 'findQ') return;
  S.findQ = e.target.value;
  const el = document.getElementById('findList');
  if (el) el.innerHTML = findListHtml();
});

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
  const followed = ev && S.inbox.find((x) => x.event_id === ev.id && x.status === 'followed');
  openDialog(`
    <form id="eventForm" class="form">
      <h2>${ev ? `${eventIcon(ev.type)} ${esc(ev.title)}` : t('newEvent')}</h2>
      ${eventTasksSection(ev)}
      ${eventPackSection(ev)}
      ${eventMomentSection(ev)}
      ${followed ? `<p class="hint">🔍 ${esc(t('followedFrom', { cal: calName(followed.calendar_id) }))}</p>`
        : fixed ? `<p class="hint">📱 ${esc(t('fromPhone'))}</p>` : ''}
      <label>${t('kind')}<select name="type">${EVENT_TYPES.map((k) =>
        `<option value="${k}" ${k === e0.type ? 'selected' : ''}>${esc(t('types.' + k))}</option>`).join('')}</select></label>
      <label>${t('title')}<input name="title" value="${esc(e0.title)}" required ${fixed ? 'disabled' : ''}></label>
      <div class="two"><label>${t('start')}<input name="start_date" type="date" value="${e0.start_date}" required ${fixed ? 'disabled' : ''}></label>
        <label>${t('end')}<input name="end_date" type="date" value="${e0.end_date || ''}" ${fixed ? 'disabled' : ''}></label></div>
      <label>${t('td.time')}<input name="start_time" type="time" value="${esc(e0.start_time || '')}" ${fixed ? 'disabled' : ''}></label>
      <label class="check"><input type="checkbox" name="yearly" ${e0.yearly ? 'checked' : ''} ${fixed ? 'disabled' : ''}><span>${t('yearly')}</span></label>
      <fieldset><legend>${t('td.who')}</legend>${peoplePicker('people', e0.people || [])}</fieldset>
      <label>${t('remindBefore')}<input name="remind_days" type="number" min="0" value="${e0.remind_days}"></label>
      <fieldset><legend>${t('visibleTo')}</legend>${roleCheckboxes('roles', ITEM_ROLES, e0.roles)}</fieldset>
      <div class="btns">
        ${ev && !fixed ? `<button type="button" class="danger" data-act="delEvent" data-id="${ev.id}">${t('delete')}</button>` : ''}
        ${followed ? `<button type="button" class="danger" data-act="unfollow" data-id="${followed.id}">${t('unfollow')}</button>` : ''}
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
    const row = { type: f.get('type'), remind_days: Number(f.get('remind_days')) || 0, roles: f.getAll('roles'),
      people: pickedPeople(form, 'people') };
    if (!fixed) Object.assign(row, { title: f.get('title').trim(), start_date: f.get('start_date'),
      end_date: f.get('end_date') || null, yearly: f.get('yearly') === 'on', start_time: f.get('start_time') || null });
    if (row.end_date && row.end_date < row.start_date) row.end_date = row.start_date;
    if (!row.roles.length) return toast(t('needRole'), true);
    if (ev) { await run(sb.from('events').update(row).eq('id', ev.id)); closeDialog(); await refresh(); return; }
    const [created] = await run(sb.from('events').insert(row).select());
    closeDialog(); await refresh();
    if (isParent() && created) eventForm(S.events.find((x) => x.id === created.id)); // straight on to tasks
  };
}

// Parents: plan one of the moments on this event's date (e.g. a vacation)
function eventMomentSection(ev) {
  if (!ev || !isParent()) return '';
  const list = S.trackers.filter(canEditMoment);
  if (!list.length) return '';
  const guess = { vacation: 'vacation', anniversary: 'date', birthday: 'restaurant' }[ev.type];
  const sel = list.find((x) => x.kind === guess) || list[0];
  return `
    <div class="card ev-moment">
      <label>💛 ${t('eventToMoment')}<select id="evMoment">${list.map((x) =>
        `<option value="${x.id}" ${x.id === sel.id ? 'selected' : ''}>${KIND_ICON[x.kind] || '💛'} ${esc(x.title)}</option>`).join('')}</select></label>
      <button type="button" class="small" data-act="eventMoment" data-id="${ev.id}">📅 ${t('plan')}</button>
    </div>`;
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
      <div class="invite-actions">
        <button class="primary small" data-act="shareInvite">📤 ${t('shareInvite')}</button>
        ${admin ? `<button class="small" data-act="newCode">${t('newInviteCode')}</button>` : ''}
      </div>
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
    ${homeSection()}
    ${calendarSection()}
    ${schoolSection()}
    ${peopleSetupSection()}
    ${skemaSetupSection()}
    <h2>${esc(t('language'))}</h2>
    ${langPicker()}
    <button class="link out" data-act="signOut">${t('signOut')}</button>
    <p class="version">Happy Life · ${esc(t('version'))} ${APP_VERSION}
      <button class="link" data-act="hardRefresh">↻ ${t('updateApp')}</button></p>`;
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
        ${S.calendars.length ? `<div class="cal-list">
          ${S.calendars.map((c) => { const mode = c.included ? 'on' : c.pick ? 'pick' : 'off'; return `<div class="cal-row">
            <span class="cal-name"><span>${esc(c.name)}</span>
              <button type="button" class="cal-who" data-act="calPeople" data-id="${c.id}">👤 ${c.people?.length ? esc(c.people.map(personLabel).join(', ')) : esc(t('td.calWhoNone'))}</button></span>
            <div class="seg cal-mode" role="radiogroup" aria-label="${esc(c.name)}">${['off', 'pick', 'on'].map((m) => `
              <button type="button" class="${mode === m ? 'on' : ''}" data-act="calMode" data-id="${c.id}|${m}"
                role="radio" aria-checked="${mode === m}">${esc(t('mode_' + m))}</button>`).join('')}</div>
            <label class="yearly ${mode === 'on' ? '' : 'off'}"><span>${esc(t('calYearly'))}</span>
              <button type="button" class="switch ${c.yearly ? 'on' : ''}" data-act="calToggle" data-id="${c.id}|yearly"
                role="switch" aria-checked="${c.yearly}" aria-label="${esc(t('calYearly'))} ${esc(c.name)}" ${mode === 'on' ? '' : 'disabled'}></button></label>
            <label class="yearly ${mode === 'off' ? 'off' : ''}"><span>📚 ${esc(t('sk.title'))}</span>
              <button type="button" class="switch ${c.schedule ? 'on' : ''}" data-act="calSchedule" data-id="${c.id}"
                role="switch" aria-checked="${!!c.schedule}" aria-label="${esc(t('sk.title'))} ${esc(c.name)}" ${mode === 'off' ? 'disabled' : ''}></button></label>
          </div>`; }).join('')}</div>
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


// ------------------------------------------------------------ school direct (Aula + iCal)
// school/school_sync.py (a GitHub Action) does the work; the app saves the
// MitID username and feed links, starts a MitID login and shows its QR code /
// code, and shows the messages and posts.

const SCHOOL_COLS = 'user_id, mitid_username, feeds, status, login_qr1, login_qr2, login_otp, login_note, login_updated, sync_requested, last_sync_at, last_result';
const SCHOOL_WORKFLOW = 'https://github.com/christoffergroenfeldt-cyber/happylife/actions/workflows/school-sync.yml';
const schoolBusy = (l) => ['login_requested', 'login_running'].includes(l?.status);
const fmtWhen = (iso) => new Date(iso).toLocaleString(
  { da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[getLang()], { dateStyle: 'medium', timeStyle: 'short' });
const svgSrc = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

function feedRow(f = {}) {
  return `<div class="feed-row">
    <input name="fname" placeholder="${esc(t('sc.feedName'))}" value="${esc(f.name || '')}" maxlength="60">
    <input name="furl" type="url" inputmode="url" placeholder="${esc(t('sc.feedUrl'))}" value="${esc(f.url || '')}">
    <button type="button" class="icon" data-act="scDelFeed" aria-label="${esc(t('remove'))}">✕</button></div>`;
}

function schoolLoginBox() {
  const l = S.school;
  if (!l) return '';
  const st = `<p class="meta"><span class="chip ${l.status === 'ok' ? 'yes' : ''}">${esc(t('sc.st_' + l.status))}</span>
    ${l.login_note && l.status !== 'ok' ? ` ${esc(l.login_note)}` : ''}</p>`;
  if (l.status === 'login_requested') {
    return `${st}<p class="hint">${esc(t('sc.waitHelp'))}</p>
      <a class="btnlink" href="${SCHOOL_WORKFLOW}" target="_blank" rel="noopener">▶︎ ${esc(t('sc.startNow'))}</a>`;
  }
  if (l.status === 'login_running') {
    return `${st}
      ${l.login_otp ? `<p class="meta">${esc(t('sc.otp'))}</p><div class="code login-code">${esc(l.login_otp)}</div><p class="hint">${esc(t('sc.approve'))}</p>` : ''}
      ${l.login_qr1 ? `<p class="meta">${esc(t('sc.scan'))}</p><div class="mitid-qr"><img id="mitidQr" alt="MitID QR" src="${svgSrc(l.login_qr1)}"></div>` : ''}`;
  }
  return `${st}${l.mitid_username ? phoneLoginGuide(l) : ''}`;
}

// STIL blocks MitID logins from servers, so the login runs once on the phone in
// a-Shell (school/aulalogin.py) and the server keeps the session alive after that.
const ASHELL_URL = 'https://apps.apple.com/app/id1473805438';
const LOGIN_SCRIPT = 'https://raw.githubusercontent.com/christoffergroenfeldt-cyber/happylife/main/school/aulalogin.py';
// one command (a-Shell has no &&); the script installs what it needs itself
const phoneLoginLine = (token, user) =>
  `python3 -c "import urllib.request as u;exec(u.urlopen('${LOGIN_SCRIPT}').read())" ${token} ${user}`;

function phoneLoginGuide(l) {
  const open = l.status !== 'ok';
  return `<details class="phone-login" ${open ? 'open' : ''}><summary>📱 ${esc(t(l.status === 'ok' ? 'sc.loginAgain' : 'sc.login'))}</summary>
    <p class="hint">${esc(t('sc.phoneWhy'))}</p>
    <ol class="steps">
      <li>${esc(t('sc.phone1'))} <a href="${ASHELL_URL}" target="_blank" rel="noopener">a-Shell</a></li>
      <li>${esc(t('sc.phone2'))}<br><button type="button" class="small" data-act="scCopyLine">📋 ${esc(t('sc.copyLine'))}</button></li>
      <li>${esc(t('sc.phone3'))}</li>
    </ol></details>`;
}

function schoolSection() {
  if (!isParent() || S.school === undefined) return '';
  const l = S.school;
  const feeds = S.schoolFeeds || l?.feeds || [];
  return `
    <h2>🏫 ${esc(t('sc.title'))}</h2>
    <div class="card school">
      <p class="meta">${esc(t('sc.help'))}</p>
      <div id="schoolBox">${schoolLoginBox()}</div>
      <form id="schoolForm" class="form">
        <label>${esc(t('sc.user'))}<input name="user" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(l?.mitid_username || '')}"></label>
        <fieldset><legend>${esc(t('sc.feeds'))}</legend>
          <div id="feedRows">${feeds.map(feedRow).join('')}</div>
          <button type="button" class="small" data-act="scAddFeed">${esc(t('sc.addFeed'))}</button>
          <p class="hint">${esc(t('sc.feedsHelp'))}</p></fieldset>
        <div class="btns"><button class="primary" type="submit">${esc(t('sc.save'))}</button></div>
      </form>
      ${l ? `<p class="meta">${l.last_sync_at ? esc(t('sc.last', { when: fmtWhen(l.last_sync_at) })) : esc(t('sc.never'))}
          ${l.last_result ? `<br>${esc(l.last_result)}` : ''}</p>
        <div class="acts"><button type="button" class="small" data-act="scSync" ${l.sync_requested ? 'disabled' : ''}>↻ ${esc(t(l.sync_requested ? 'sc.queued' : 'sc.syncNow'))}</button>
          <button type="button" class="link" data-act="scRemove">${esc(t('sc.remove'))}</button></div>` : ''}
    </div>`;
}

// While a MitID login runs: fetch the row every 2 s and swap the two QR codes every second
let schoolTimer = null; let qrFlip = 0;
function schoolPoll() {
  const want = S.tab === 'family' && schoolBusy(S.school);
  if (!want) { clearInterval(schoolTimer); schoolTimer = null; return; }
  if (schoolTimer) return;
  let tick = 0;
  schoolTimer = setInterval(async () => {
    tick += 1;
    const img = document.getElementById('mitidQr');
    if (img && S.school?.login_qr2) img.src = svgSrc((qrFlip ^= 1) ? S.school.login_qr2 : S.school.login_qr1);
    if (tick % 2) return;
    const { data } = await sb.from('school_links').select(SCHOOL_COLS).maybeSingle();
    if (!data) return;
    const before = JSON.stringify([S.school?.status, S.school?.login_qr1, S.school?.login_otp, S.school?.login_note]);
    S.school = data;
    if (!schoolBusy(data)) { clearInterval(schoolTimer); schoolTimer = null; return refresh(); }
    if (JSON.stringify([data.status, data.login_qr1, data.login_otp, data.login_note]) !== before) {
      const box = document.getElementById('schoolBox');
      if (box) box.innerHTML = schoolLoginBox();
    }
  }, 1000);
}

// Read / unread is per Happy Life user (school_reads), not Aula's own flag
const schoolUnread = (m) => !S.schoolRead.has(m.id);

function schoolMsgRow(m) {
  const unread = schoolUnread(m);
  return `<div class="row school-msg ${unread ? 'unread' : ''}" data-act="scOpen" data-id="${m.id}">
    <div class="lead big">${m.kind === 'post' ? '📰' : '✉️'}</div>
    <div class="body"><div class="ttl">${m.important ? '❗ ' : ''}${esc(m.title || t('sc.' + m.kind))}</div>
      <div class="meta">${esc(m.sender || '')}${m.sent_at ? ` · ${esc(fmtDate(m.sent_at.slice(0, 10)))}` : ''}${unread ? ` · <b>${esc(t('sc.unread'))}</b>` : ''}</div></div></div>`;
}

// Today: the newest from the last 14 days (unread and important first)
function schoolInbox() {
  if (!S.school || !S.schoolMsgs.length) return '';
  const since = isoMinus(14);
  const recent = S.schoolMsgs.filter((m) => (m.sent_at || '') >= since)
    .sort((a, b) => (schoolUnread(b) - schoolUnread(a)) || (b.important - a.important) || (b.sent_at || '').localeCompare(a.sent_at || ''));
  const body = recent.length ? `<div class="list">${recent.slice(0, 5).map(schoolMsgRow).join('')}</div>`
    : `<p class="empty">${esc(t('sc.none'))}</p>`;
  return fold('school', esc(t('sc.inbox')), `${body}
    <button class="small" data-act="scAll">${esc(t('sc.all', { n: S.schoolMsgs.length }))}</button>`, recent.filter(schoolUnread).length || '');
}

// MinUddannelse (via Aula): the day's plan per child + the week's ugenoter
function isoWeekOf(iso) {
  const dt = new Date(iso + 'T12:00:00Z');
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);               // Thursday of this week
  const y = dt.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((dt - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}
const weekdayName = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(
  { da: 'da-DK', en: 'en-GB', fr: 'fr-FR' }[getLang()], { weekday: 'long' });

function schoolItemRow(x) {
  const body = `<div class="body"><div class="ttl">${esc(x.title)}</div>
    <div class="meta">${esc(x.subject || x.grp || '')}${x.done ? ' · ✓' : ''}</div></div>`;
  return x.url ? `<a class="row school-item" href="${esc(x.url)}" target="_blank" rel="noopener">${body}<span class="go">↗</span></a>`
    : `<div class="row school-item">${body}</div>`;
}

function schoolByChild(items) {
  const kids = [...new Set(items.map((x) => x.child || ''))].sort();
  return kids.map((k) => `<h3 class="subhead">${esc(k)}</h3>
    <div class="list">${items.filter((x) => (x.child || '') === k).map(schoolItemRow).join('')}</div>`).join('');
}

function schoolDay(d) {
  const tasks = S.schoolItems.filter((x) => x.kind === 'opgave');
  const notes = S.schoolItems.filter((x) => x.kind === 'ugenote');
  if (!tasks.length && !notes.length) return '';
  // on a weekend (or a day without anything) show the next school day within 3 days
  let day = d;
  for (let i = 0; i < 3 && !tasks.some((x) => x.due_date === day); i++) day = addDays(day, 1);
  if (!tasks.some((x) => x.due_date === day)) day = d;
  const items = tasks.filter((x) => x.due_date === day);
  const week = isoWeekOf(day);
  const wnotes = notes.filter((x) => x.week === week);
  const label = day === today() ? t('td.today') : day === addDays(today(), 1) ? t('td.tomorrow') : weekdayName(day);
  const body = `${items.length ? schoolByChild(items) : `<p class="empty">${esc(t('sc.noItems'))}</p>`}
    <div class="acts">${wnotes.map((n) => `<button class="small" data-act="scNote" data-id="${n.id}">📝 ${esc(t('sc.ugenote'))} ${esc(n.grp || '')} · ${esc(n.child || '')}</button>`).join('')}
      <button class="small" data-act="scWeek" data-id="${week}">${esc(t('sc.wholeWeek'))}</button></div>`;
  return fold('mu', `📚 ${esc(t('sc.atSchool', { day: label }))}`, body, items.length || '');
}

function schoolWeekDialog(week) {
  const items = S.schoolItems.filter((x) => x.kind === 'opgave' && x.week === week);
  const days = [...new Set(items.map((x) => x.due_date))].sort();
  const weeks = [...new Set(S.schoolItems.map((x) => x.week))].sort();
  openDialog(`<div class="form school-read">
    <h2>📚 ${esc(t('sc.week', { n: Number(week.slice(6)) }))}</h2>
    <div class="seg">${weeks.map((w) => `<button type="button" data-act="scWeek" data-id="${w}" class="${w === week ? 'on' : ''}">${esc(t('sc.week', { n: Number(w.slice(6)) }))}</button>`).join('')}</div>
    ${days.map((dd) => `<h2 class="dayhead">${esc(weekdayName(dd))} ${esc(fmtDate(dd, getLang()))}</h2>${schoolByChild(items.filter((x) => x.due_date === dd))}`).join('')
      || `<p class="empty">${esc(t('sc.noItems'))}</p>`}
    ${S.schoolItems.filter((x) => x.kind === 'ugenote' && x.week === week).map((n) => `<button class="small" data-act="scNote" data-id="${n.id}">📝 ${esc(t('sc.ugenote'))} ${esc(n.grp || '')} · ${esc(n.child || '')}</button>`).join('')}
    <div class="btns"><span class="grow"></span><button type="button" data-act="close">${esc(t('sc.close'))}</button></div></div>`);
}

function schoolNoteDialog(n) {
  openDialog(`<div class="form school-read">
    <h2>📝 ${esc(t('sc.ugenote'))} ${esc(n.grp || '')}</h2>
    <p class="meta">${esc(n.child || '')} · ${esc(t('sc.week', { n: Number(n.week.slice(6)) }))}</p>
    <div class="msg-body">${esc(n.body || '').replace(/\n/g, '<br>')}</div>
    <div class="btns"><span class="grow"></span><button type="button" data-act="close">${esc(t('sc.close'))}</button></div></div>`);
}

function schoolMsgDialog(m) {
  openDialog(`<div class="form school-read">
    <h2>${m.important ? '❗ ' : ''}${esc(m.title || t('sc.' + m.kind))}</h2>
    <p class="meta">${esc(t('sc.' + m.kind))} · ${esc(m.sender || '')}${m.sent_at ? ` · ${esc(fmtWhen(m.sent_at))}` : ''}</p>
    <div class="msg-body">${esc(m.body || '').replace(/\n/g, '<br>')}</div>
    <div class="btns"><button type="button" class="link" data-act="scUnread" data-id="${m.id}">${esc(t('sc.markUnread'))}</button>
      <span class="grow"></span><button type="button" data-act="close">${esc(t('sc.close'))}</button></div></div>`);
}

function schoolAllDialog() {
  openDialog(`<div class="form"><h2>${esc(t('sc.inbox'))}</h2>
    <div class="list">${S.schoolMsgs.map(schoolMsgRow).join('')}</div>
    <div class="btns">${S.schoolMsgs.some(schoolUnread) ? `<button type="button" class="link" data-act="scAllRead">${esc(t('sc.markAllRead'))}</button>` : ''}<span class="grow"></span><button type="button" data-act="close">${esc(t('sc.close'))}</button></div></div>`);
}

// ------------------------------------------------------------ price watch
// Anyone registers a product; a daily check (scheduled Claude task) records the
// offers it finds and the best price. Followers get one push a day.

const kr = (v, dec) => (v == null ? '–' : new Intl.NumberFormat(LOCALE(), { style: 'currency', currency: 'DKK',
  maximumFractionDigits: dec ?? (Number(v) % 1 ? 2 : 0) }).format(Number(v)));
const watchPoints = (id) => S.wpoints.filter((p) => p.watch_id === id);
const canEditWatch = (w) => w.created_by === uid() || isParent();
const following = (w) => (w.followers || []).includes(uid());
const checkPending = (w) => !!w.check_requested_at;

// Best total price per day (in stock unless unknown; used only when allowed) – same rule as the server
function dailyBest(w) {
  const best = {};
  watchPoints(w.id).forEach((p) => {
    if (p.in_stock === false || (p.used && !w.allow_used)) return;
    const v = Number(p.price) + Number(p.shipping || 0);
    if (!(p.checked_on in best) || v < best[p.checked_on]) best[p.checked_on] = v;
  });
  return Object.entries(best).sort(([a], [b]) => a.localeCompare(b));
}

function watchStatus(w) {
  const days = dailyBest(w);
  const last = days[days.length - 1];
  const prev = days[days.length - 2];
  const low = days.length ? Math.min(...days.map(([, v]) => v)) : null;
  const best = w.best_price != null ? Number(w.best_price) : last ? last[1] : null;
  const target = w.target_price != null ? Number(w.target_price) : null;
  return { days, best, change: last && prev ? last[1] - prev[1] : null, low, lowDay: days.find(([, v]) => v === low)?.[0],
    atTarget: best != null && target != null && best <= target, isLow: best != null && days.length > 1 && best <= low };
}

function sparkline(days) {
  const pts = days.slice(-90);
  if (pts.length < 2) return '';
  const vals = pts.map(([, v]) => v);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const xy = pts.map(([, v], i) => `${(i / (pts.length - 1)) * 100},${(28 - ((v - lo) / span) * 24).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${xy.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function changeChip(st) {
  if (st.change == null || st.change === 0) return '';
  const down = st.change < 0;
  return `<span class="chip ${down ? 'yes' : 'up'}">${down ? '↓' : '↑'} ${esc(kr(Math.abs(st.change)))}</span>`;
}

function offerLink(url, label) {
  return url ? `<a class="offer" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : '';
}

function watchCard(w) {
  const st = watchStatus(w);
  const checked = w.last_checked ? fmtDate(todayISO(new Date(w.last_checked)), getLang()) : null;
  return `<div class="card watch ${w.active ? '' : 'paused'} ${st.atTarget ? 'target' : ''}">
    <div class="w-head" data-act="openWatch" data-id="${w.id}">
      <div class="body"><h3>${esc(w.title)}${w.visible_to === 'me' ? ' 🔒' : ''}</h3>
        <div class="meta">${w.details ? esc(w.details) + ' · ' : ''}${esc(memberName(w.created_by))}</div></div>
      <div class="w-price"><b>${esc(kr(st.best))}</b>${changeChip(st)}</div>
    </div>
    ${st.days.length > 1 ? `<div class="w-spark">${sparkline(st.days)}</div>` : ''}
    <div class="meta">${w.best_shop ? `${esc(t('pr.cheapestAt', { shop: w.best_shop }))}${w.best_used ? ` (${esc(t('pr.used'))})` : ''} · ` : ''}
      ${st.isLow ? `<strong>${esc(t('pr.lowest'))}</strong> · ` : st.low != null && st.best != null && st.low < st.best ? `${esc(t('pr.lowWas', { price: kr(st.low), date: fmtDate(st.lowDay, getLang()) }))} · ` : ''}
      ${st.atTarget ? `<strong>🎯 ${esc(t('pr.atTarget'))}</strong> · ` : w.target_price ? `🎯 ${esc(kr(w.target_price))} · ` : ''}
      ${checked ? esc(t('pr.checked', { date: checked })) : esc(t('pr.notYet'))}</div>
    ${w.notes ? `<div class="meta">💬 ${esc(w.notes)}</div>` : ''}
    ${checkPending(w) ? `<div class="meta pending">⏳ ${esc(t('pr.pending'))}</div>` : ''}
    ${w.check_note ? `<div class="meta">ℹ️ ${esc(w.check_note)}</div>` : ''}
    ${w.advice ? `<div class="idea">💡 ${esc(w.advice)}</div>` : ''}
    <div class="acts">
      ${offerLink(w.best_url, t('pr.toOffer'))}
      <button class="small" data-act="followWatch" data-id="${w.id}">${following(w) ? '🔔' : '🔕'} ${esc(t(following(w) ? 'pr.following' : 'pr.follow'))}</button>
      <button class="small" data-act="openWatch" data-id="${w.id}">📈 ${esc(t('pr.history'))}</button>
      ${w.active && !checkPending(w) ? `<button class="small" data-act="checkWatch" data-id="${w.id}">🔄 ${esc(t('pr.checkNow'))}</button>` : ''}
    </div>
  </div>`;
}

function viewPrices() {
  const back = `<div class="toolbar"><button data-act="tab" data-id="today">‹ ${esc(t('tabs.today'))}</button>
    <button class="primary" data-act="newWatch">＋ ${esc(t('pr.add'))}</button>
    ${S.watches.some((w) => w.active && !checkPending(w)) ? `<button data-act="checkWatch" data-id="all">🔄 ${esc(t('pr.checkAll'))}</button>` : ''}</div>`;
  pollPending();
  const list = [...S.watches].sort((a, b) => (b.active - a.active) || (following(b) - following(a)) || a.title.localeCompare(b.title));
  return `${back}
    <p class="hint">${esc(t('pr.intro'))}</p>
    ${list.length ? list.map(watchCard).join('') : `<p class="empty">${esc(t('pr.none'))}</p>`}
    <details class="more"><summary>${esc(t('pr.howTitle'))}</summary><ul class="hist">${t('pr.how').map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
}

// On Today: the products I follow, or a way in
function pricesTeaser() {
  if (!S.pricesReady) return '';
  const mine = S.watches.filter((w) => w.active && following(w));
  if (!mine.length) return `<button class="small" data-act="tab" data-id="prices">🏷️ ${esc(t('pr.title'))}${S.watches.length ? ` (${S.watches.length})` : ''} →</button>`;
  const rows = mine.slice(0, 4).map((w) => {
    const st = watchStatus(w);
    return `<div class="row compact" data-act="openPrices">
      <div class="body"><div class="ttl">${esc(w.title)}</div><div class="meta">${w.best_shop ? esc(w.best_shop) : esc(t('pr.notYet'))}</div></div>
      <div class="w-price small"><b>${esc(kr(st.best))}</b>${changeChip(st)}${st.atTarget ? ' 🎯' : ''}</div></div>`;
  }).join('');
  return fold('prices', `🏷️ ${esc(t('pr.title'))}`, `<div class="list">${rows}</div>
    <button class="small" data-act="tab" data-id="prices">${esc(t('pr.all'))} →</button>`, mine.length);
}

// "Check now": queued in the database; the price-check GitHub Action picks it up within minutes
async function requestCheck(id) {
  const n = await run(sb.rpc('price_check_now', { p_id: id === 'all' ? null : id }));
  toast(t('pr.queued', n || 0));
  await refresh();
}

// While a check is waiting, look again every 30 s (for up to 20 min) on the price page
let pollTimer = null, pollUntil = 0;
function pollPending() {
  if (!S.watches.some(checkPending)) { pollUntil = 0; return; }
  if (!pollUntil) pollUntil = Date.now() + 20 * 60 * 1000;
  if (pollTimer || Date.now() > pollUntil) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (S.tab !== 'prices' || document.visibilityState !== 'visible' || dialog.open) return pollPending();
    const before = S.watches.filter(checkPending).length;
    try { await loadAll(); } catch { /* shown */ }
    if (S.watches.filter(checkPending).length < before) toast(t('pr.checkedNow'));
    render();
  }, 30000);
}

function watchDetail(w) {
  const st = watchStatus(w);
  const pts = watchPoints(w.id);
  const lastDay = pts.length ? pts[pts.length - 1].checked_on : null;
  const offers = pts.filter((p) => p.checked_on === lastDay)
    .sort((a, b) => (Number(a.price) + Number(a.shipping || 0)) - (Number(b.price) + Number(b.shipping || 0)));
  const hist = [...st.days].reverse().slice(0, 60);
  const shopOn = (d, v) => pts.find((p) => p.checked_on === d && Number(p.price) + Number(p.shipping || 0) === v);
  openDialog(`<div class="form">
    <h2>🏷️ ${esc(w.title)}</h2>
    ${w.details ? `<p class="meta">${esc(w.details)}</p>` : ''}
    ${w.notes ? `<p class="meta">💬 ${esc(w.notes)}</p>` : ''}
    ${w.ref_url ? `<p>${offerLink(w.ref_url, t('pr.product'))}</p>` : ''}
    ${st.days.length > 1 ? `<div class="w-spark big">${sparkline(st.days)}</div>
      <p class="meta">${esc(t('pr.range', { lo: kr(st.low), hi: kr(Math.max(...st.days.map(([, v]) => v))), n: st.days.length }))}</p>` : ''}
    <h3>${esc(t('pr.offers'))}${lastDay ? ` · ${esc(fmtDate(lastDay, getLang()))}` : ''}</h3>
    ${offers.length ? `<div class="list">${offers.map((p) => `<div class="row compact ${p.in_stock === false ? 'muted' : ''}">
      <div class="body"><div class="ttl">${esc(p.shop)}${p.used ? ` · ${esc(t('pr.used'))}` : ''}</div>
        <div class="meta">${p.shipping != null ? esc(Number(p.shipping) ? t('pr.shipping', { price: kr(p.shipping) }) : t('pr.freeShipping')) : esc(t('pr.shippingUnknown'))}
          ${p.in_stock === false ? ` · ${esc(t('pr.outOfStock'))}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</div></div>
      <div class="w-price small"><b>${esc(kr(p.price))}</b> ${offerLink(p.url, t('pr.open'))}</div></div>`).join('')}</div>`
      : `<p class="empty">${esc(t('pr.notYet'))}</p>`}
    ${hist.length ? `<h3>${esc(t('pr.history'))}</h3><table class="phist"><tbody>${hist.map(([d, v]) => {
      const p = shopOn(d, v);
      return `<tr><td>${esc(fmtDate(d, getLang()))}</td><td><b>${esc(kr(v))}</b></td><td>${p ? offerLink(p.url, p.shop) : ''}</td></tr>`;
    }).join('')}</tbody></table>` : ''}
    <div class="btns">
      ${canEditWatch(w) ? `<button type="button" data-act="editWatch" data-id="${w.id}">✎ ${t('edit')}</button>` : ''}
      <span class="grow"></span>
      <button type="button" class="primary" data-act="close">${t('pr.close')}</button>
    </div></div>`);
}

function watchForm(w) {
  const x = w || { title: '', details: '', ref_url: '', target_price: null, allow_used: false, notify: 'daily', visible_to: 'family', active: true };
  const opt = (name, vals, cur) => `<select name="${name}">${vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(t(`pr.${name}_${v}`))}</option>`).join('')}</select>`;
  openDialog(`
    <form id="watchForm" class="form">
      <h2>🏷️ ${w ? esc(w.title) : esc(t('pr.add'))}</h2>
      <label>${t('pr.what')}<input name="title" value="${esc(x.title)}" maxlength="120" required placeholder="${esc(t('pr.whatPh'))}"></label>
      <label>${t('pr.details')}<input name="details" value="${esc(x.details || '')}" maxlength="500" placeholder="${esc(t('pr.detailsPh'))}"></label>
      <label>${t('pr.notes')}<textarea name="notes" maxlength="1000" rows="3" placeholder="${esc(t('pr.notesPh'))}">${esc(x.notes || '')}</textarea></label>
      <label>${t('pr.link')}<input name="ref_url" type="url" value="${esc(x.ref_url || '')}" maxlength="500" placeholder="https://…"></label>
      <label>${t('pr.target')}<input name="target_price" type="number" min="1" step="1" inputmode="numeric" value="${x.target_price != null ? Number(x.target_price) : ''}" placeholder="${esc(t('pr.targetPh'))}"></label>
      <label class="check"><input type="checkbox" name="allow_used" ${x.allow_used ? 'checked' : ''}><span>${t('pr.allowUsed')}</span></label>
      <label>${t('pr.notifyLbl')}${opt('notify', ['daily', 'drop', 'off'], x.notify)}</label>
      <label>${t('pr.visibleLbl')}${opt('visible', isParent() ? ['family', 'parents', 'me'] : ['family', 'me'], x.visible_to)}</label>
      ${w ? `<label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}><span>${t('pr.active')}</span></label>` : ''}
      <p class="hint">${esc(t('pr.formHint'))}</p>
      <div class="btns">
        ${w ? `<button type="button" class="danger" data-act="delWatch" data-id="${w.id}">${t('delete')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  const form = document.getElementById('watchForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const url = f.get('ref_url').trim();
    const row = { title: f.get('title').trim(), details: f.get('details').trim() || null, ref_url: url || null,
      target_price: Number(f.get('target_price')) > 0 ? Number(f.get('target_price')) : null,
      allow_used: f.get('allow_used') === 'on', notify: f.get('notify'), visible_to: f.get('visible'),
      notes: f.get('notes').trim() || null };
    if (!row.title) return toast(t('needTitle'), true);
    if (url && !/^https?:\/\//i.test(url)) return toast(t('pr.badLink'), true);
    let id = w?.id;
    if (w) await run(sb.from('price_watches').update({ ...row, active: f.get('active') === 'on' }).eq('id', w.id));
    else id = (await run(sb.from('price_watches').insert(row).select('id').single())).id;
    closeDialog();
    // A new product (or a changed description): check it now?
    const changed = w && ['title', 'details', 'notes', 'ref_url', 'allow_used'].some((k) => (w[k] ?? null) !== (row[k] ?? null));
    if ((!w || changed) && confirm(t(w ? 'pr.checkChangedQ' : 'pr.checkNowQ', { title: row.title }))) await requestCheck(id);
    else { if (!w) toast(t('pr.added')); await refresh(); }
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
  hardRefresh: () => hardRefresh(),
  houseMode: (id) => { S.houseMode = id; render(); window.scrollTo(0, 0); },
  planMode: (id) => { S.planMode = id; S.tab = 'plan'; render(); window.scrollTo(0, 0); },
  setupZone: (id) => { S.setupZone = id; render(); window.scrollTo(0, 0); },
  momentTab: (id) => { S.momentTab = id; render(); window.scrollTo(0, 0); },
  calFilter: (id) => { store('hl-calf', id); render(); },
  homeCalFilter: (id) => { store('hl-homecalf', id); render(); },
  snartFilter: (id) => { store('hl-snartf', id); render(); },
  seedHouse: async () => { await run(sb.rpc('seed_house')); await refresh(); },
  // "Done!" straight away: take it (if not already) and tick it in one go
  houseDone: async (id) => {
    const st = taskState(byId(S.tasks, id));
    if (!st.took) await run(sb.rpc('take_task', { p_task: id, p_period: st.period }));
    await run(sb.from('task_done').insert({ task_id: id, period: st.period, done_on: today() }));
    toast('✓ 💪'); await refresh();
  },
  setChore: (id) => { const [p, c] = id.split('|'); choreSetForm(p, c); },
  addPlace: (zone) => houseItemForm('house_places', null, zone),
  editPlace: (id) => houseItemForm('house_places', byId(S.places, id)),
  addChoreType: (zone) => houseItemForm('house_chores', null, zone),
  editChoreType: (id) => houseItemForm('house_chores', byId(S.chores, id)),
  delHouseItem: async (ref) => {
    const [table, id] = ref.split('|');
    if (!confirm(t('house.confirmDel'))) return;
    await run(sb.from(table).delete().eq('id', id)); closeDialog(); await refresh();
  },

  newMoment: () => momentForm(null),
  newFamilyMoment: () => momentForm(null, true),
  planMoment: (id) => momentPlanForm(byId(S.trackers, id)),
  openFind: async (id) => {
    const tr = id ? byId(S.trackers, id) : null;
    S.find = { trId: tr?.id || null, kind: tr?.kind || (isParent() ? 'takeaway' : 'movie') };
    S.tab = 'moments'; render(); window.scrollTo(0, 0);
    if (S.nearby === null && S.family?.home_lat != null) {
      try { await loadNearby(); } catch { S.nearby = []; }
      if (S.find) render();
    }
  },
  findKind: (k) => { S.find.kind = k; render(); },
  findBack: () => { S.find = null; render(); window.scrollTo(0, 0); },
  findPick: (idx) => {
    const it = S.findItems[Number(idx)];
    const tr = S.find.trId ? byId(S.trackers, S.find.trId) : S.trackers.find((x) => x.kind === S.find.kind && canEditMoment(x));
    if (!it || !tr) return;
    momentPlanForm(tr, { note: it.note });
  },
  refreshNearby: async () => {
    const f = S.family;
    if (f?.home_lat == null) return toast(t('nearbyNeedHome'), true);
    toast(t('nearbyLoading'));
    let rows;
    try { rows = await fetchNearby({ lat: f.home_lat, lon: f.home_lon }, f.nearby_minutes || 20); } catch (e) {
      console.error(e); return toast(t('nearbyFailed'), true);
    }
    await run(sb.from('nearby_places').delete().eq('family_id', f.id));
    for (let i = 0; i < rows.length; i += 500) await run(sb.from('nearby_places').insert(rows.slice(i, i + 500)));
    toast(t('nearbyFound', rows.length));
    await loadNearby(); await refresh();
  },
  eventMoment: (evId) => {
    const ev = byId(S.events, evId);
    const tr = byId(S.trackers, document.getElementById('evMoment')?.value);
    if (!ev || !tr) return;
    const date = ev.yearly ? eventStatus(ev, today()).date : ev.start_date;
    closeDialog();
    momentPlanForm(tr, { note: ev.title, date });
  },
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

  todayDay: (id) => { S.todayDay = id; render(); },
  newPack: () => packForm(null),
  editPack: (id) => packForm(byId(S.packs, id)),
  eventPack: (evId) => packForm(null, { event_id: evId }),
  delPack: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('pack_items').delete().eq('id', id)); closeDialog(); await refresh(); },
  packTick: async (id) => {
    const d = todayDate();
    if (packIsDone(id, d)) await run(sb.from('pack_done').delete().eq('item_id', id).eq('on_date', d));
    else await run(sb.from('pack_done').insert({ item_id: id, on_date: d }));
    await refresh();
  },
  calPeople: (id) => calPeopleForm(byId(S.calendars, id)),
  fdPick: (ws) => fdPickForm(ws),
  openSkema: (d) => {
    S.tab = 'calendar'; S.calView = 'skema'; S.skemaDay = d || null;
    S.skemaWeek = weekStart(d || today()); render(); window.scrollTo(0, 0);
  },
  skemaWho: (k) => { S.skemaWho = k; render(); },
  editPerson: (name) => personForm(name),
  delPerson: async (name) => {
    if (!confirm(t('td.delPersonConfirm', { name }))) return;
    await run(sb.rpc('rename_person', { p_old: name, p_new: null }));
    closeDialog(); await refresh();
  },
  skemaHide: async (title) => {
    const key = title.toLowerCase();
    if (S.skemaHidden.includes(key)) await run(sb.from('skema_hidden').delete().eq('family_id', S.family.id).eq('title', key));
    else await run(sb.from('skema_hidden').insert({ title: key }));
    await refresh();
  },
  skemaWeek: (n) => { S.skemaWeek = Number(n) ? addDays(S.skemaWeek || weekStart(today()), Number(n)) : weekStart(today()); S.skemaDay = null; render(); },
  calSchedule: async (id) => {
    const c = byId(S.calendars, id);
    await run(sb.rpc('set_calendar_schedule', { p_id: id, p_on: !c.schedule }));
    await refresh();
  },
  fdSetup: () => fdSetupForm(),
  fdPass: async (ws) => { await fdSave(ws, { chooser: fdNext(fdChooser(ws)) }); await refresh(); },
  fdCancel: async (ws) => { if (!confirm(t('fd.cancelConfirm'))) return; await fdSave(ws, { cancelled: true }); await refresh(); },
  fdUncancel: async (ws) => { await fdSave(ws, { cancelled: false }); await refresh(); },
  fdClear: async (ws) => { await fdSave(ws, { title: null, idea_id: null, emoji: null, on_date: null, at_time: null, note: null });
    closeDialog(); await refresh(); },
  fdAddIdea: async () => {
    const title = document.getElementById('fdIdeaTitle')?.value.trim();
    if (!title) return toast(t('needTitle'), true);
    await run(sb.from('famday_ideas').insert({ title, emoji: document.getElementById('fdIdeaEmoji').value.trim() || '✨',
      weather: document.getElementById('fdIdeaW').value, long: document.getElementById('fdIdeaLong').checked }));
    await refresh(); fdSetupForm();
  },
  fdDelIdea: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('famday_ideas').delete().eq('id', id)); await refresh(); fdSetupForm(); },
  addPerson: (name) => {
    const box = document.querySelector(`[data-people="${name}"]`);
    const inp = box?.querySelector('input.newperson');
    const v = inp?.value.trim();
    if (!v) return;
    const lbl = document.createElement('label');
    lbl.className = 'check';
    lbl.innerHTML = `<input type="checkbox" name="${name}" value="${esc(v)}" checked><span>${esc(v)}</span>`;
    box.querySelector('.checks').appendChild(lbl);
    inp.value = '';
  },

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
  calToggle: async (id) => {   // "every year" (only for calendars set to All)
    const calId = id.split('|')[0];
    const c = byId(S.calendars, calId);
    await run(sb.rpc('set_calendar_mode', { p_id: calId, p_mode: 'on', p_yearly: !c.yearly }));
    await refresh();
  },
  calMode: async (id) => {
    const [calId, mode] = id.split('|');
    const c = byId(S.calendars, calId);
    const was = c.included ? 'on' : c.pick ? 'pick' : 'off';
    if (mode === was) return;
    if (mode === 'off' && was !== 'off' && !confirm(t('calOffConfirm'))) return;
    if (mode === 'pick' && was === 'on' && !confirm(t('calToPickConfirm'))) return;
    await run(sb.rpc('set_calendar_mode', { p_id: calId, p_mode: mode }));
    if (mode === 'on') toast(t('calOnNote'));
    if (mode === 'pick' && was === 'off') toast(t('calPickNote'));
    await refresh();
  },
  scAddFeed: () => {
    document.getElementById('feedRows')?.insertAdjacentHTML('beforeend', feedRow({ name: 'ForældreIntra (direkte)' }));
  },
  scDelFeed: (id, el) => { el.closest('.feed-row')?.remove(); },
  scCopyLine: async () => {
    if (!S.sync?.token) { await run(sb.rpc('my_sync_token')); await refresh(); }
    const line = phoneLoginLine(S.sync.token, S.school.mitid_username);
    try { await navigator.clipboard.writeText(line); toast(t('copied')); }
    catch { prompt(t('sc.copyLine'), line); }
  },
  scLogin: async () => {
    await run(sb.rpc('school_link_login'));
    await refresh();
  },
  scSync: async () => { await run(sb.rpc('school_link_sync_now')); toast(t('sc.queued')); await refresh(); },
  scRemove: async () => {
    if (!confirm(t('sc.removeConfirm'))) return;
    await run(sb.rpc('school_link_remove')); S.schoolFeeds = null; await refresh();
  },
  scOpen: async (id) => {
    const m = byId(S.schoolMsgs, id);
    if (!m) return;
    schoolMsgDialog(m);
    if (schoolUnread(m)) {
      S.schoolRead.add(m.id); render();
      await sb.from('school_reads').upsert({ message_id: m.id }, { onConflict: 'user_id,message_id', ignoreDuplicates: true });
    }
  },
  scUnread: async (id) => {
    S.schoolRead.delete(id); closeDialog(); render();
    await run(sb.from('school_reads').delete().eq('message_id', id));
  },
  scAllRead: async () => {
    S.schoolMsgs.forEach((m) => S.schoolRead.add(m.id)); closeDialog(); render();
    await run(sb.rpc('school_mark_all_read'));
  },
  scAll: () => schoolAllDialog(),
  scWeek: (week) => schoolWeekDialog(week),
  scNote: (id) => { const n = byId(S.schoolItems, id); if (n) schoolNoteDialog(n); },
  openPrices: () => { S.tab = 'prices'; render(); window.scrollTo(0, 0); },
  newWatch: () => watchForm(null),
  openWatch: (id) => { const w = byId(S.watches, id); if (w) watchDetail(w); },
  checkWatch: (id) => requestCheck(id),
  editWatch: (id) => { const w = byId(S.watches, id); if (w) watchForm(w); },
  followWatch: async (id) => {
    const w = byId(S.watches, id);
    await run(sb.rpc('price_follow', { p_id: id, p_on: !following(w) }));
    await refresh();
  },
  delWatch: async (id) => {
    if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('price_watches').delete().eq('id', id)); closeDialog(); await refresh();
  },
  calView: (id) => { S.calView = id; render(); window.scrollTo(0, 0); },
  findFilter: () => findFilterSheet(),
  findChip: (key) => {
    const f = findFilter();
    const [k, v] = key.split('|');
    if (k === 'cal') f.off = f.off.filter((x) => x !== v);
    if (k === 'days') f.days = FIND_DEFAULT.days;
    if (k === 'series') f.series = true;
    if (k === 'show') f.show = FIND_DEFAULT.show.includes(v) ? [...new Set([...f.show, v])] : f.show.filter((x) => x !== v);
    saveFindFilter(f); render();
  },
  findReset: () => { saveFindFilter(FIND_DEFAULT); closeDialog(); render(); },
  inbox: async (id) => {
    const [rowId, status] = id.split('|');
    const evId = await run(sb.rpc('inbox_set', { p_id: rowId, p_status: status }));
    await refresh();
    if (status === 'followed' && evId) { toast(t('followedToast')); eventForm(byId(S.events, evId)); }
  },
  unfollow: async (rowId) => {
    if (!confirm(t('unfollowConfirm'))) return;
    await run(sb.rpc('inbox_set', { p_id: rowId, p_status: 'new' }));
    closeDialog(); await refresh();
  },
  delEvent: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('events').delete().eq('id', id)); closeDialog(); await refresh(); },

  shareInvite: async () => {
    const code = S.family.invite_code;
    const url = `${location.origin}${location.pathname}?invite=${encodeURIComponent(code)}`;
    const text = t('shareInviteText', { family: S.family.name, code });
    if (navigator.share) {
      try { await navigator.share({ title: t('shareInviteTitle', { family: S.family.name }), text, url }); }
      catch (err) { if (err?.name !== 'AbortError') toast(t('shareFailed'), true); }
      return;
    }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast(t('inviteCopied')); }
    catch { toast(t('shareFailed'), true); }
  },
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
  try { await fn(el.dataset.id, el); } catch { /* toast already shown */ } finally { el.disabled = false; }
});

// Moment Find page search: filter the list without re-rendering (keeps the keyboard open)
document.addEventListener('input', (e) => {
  if (e.target.id !== 'momentQ') return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.find-group').forEach((g) => {
    let n = 0;
    g.querySelectorAll('.find-item').forEach((it) => { const ok = !q || it.dataset.text.includes(q); it.hidden = !ok; if (ok) n += 1; });
    g.hidden = n === 0;
    g.open = q ? true : g.dataset.open === '1';
    const c = g.querySelector('.count'); if (c) c.textContent = `(${n})`;
  });
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'homeForm') {
    e.preventDefault();
    const fd = new FormData(e.target);
    const address = String(fd.get('address') || '').trim();
    const minutes = Math.min(60, Math.max(5, Number(fd.get('minutes')) || 20));
    if (!address) return;
    (async () => {
      let pos = null;
      try { pos = await geocode(address, getLang()); } catch { /* offline or service busy */ }
      if (!pos) return toast(t('homeNotFound'), true);
      await run(sb.rpc('set_home', { p_address: address, p_lat: pos.lat, p_lon: pos.lon, p_minutes: minutes }));
      toast(t('homeSaved'));
      await refresh();
      await ACTIONS.refreshNearby();
    })().catch(() => {});
    return;
  }
  if (e.target.id === 'schoolForm') {
    e.preventDefault();
    const fd = new FormData(e.target);
    const names = fd.getAll('fname'); const urls = fd.getAll('furl');
    const feeds = urls.map((u, i) => ({ name: String(names[i] || '').trim(), url: String(u || '').trim() }))
      .filter((f) => f.url);
    feeds.forEach((f) => { if (!f.name) f.name = 'ForældreIntra (direkte)'; });
    run(sb.rpc('school_link_save', { p_username: fd.get('user'), p_feeds: feeds }))
      .then(() => { S.schoolFeeds = null; toast(t('sc.saved')); return refresh(); }).catch(() => {});
    return;
  }
  if (e.target.id === 'nameForm') {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (name) run(sb.rpc('rename_me', { p_name: name })).then(refresh).catch(() => {});
  }
});

// Refresh when the app comes back to the foreground (dates may have changed)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.me) { S.todayDay = null; refresh().catch(() => {}); }
});

// ------------------------------------------------------------ start

// ?prices=<id|all> from a price notification opens the price page (and the product)
function openFromUrl(search) {
  const id = new URLSearchParams(search).get('prices');
  if (!id || !S.me || !S.pricesReady) return;
  S.tab = 'prices';
  history.replaceState(null, '', location.pathname);
  const w = byId(S.watches, id);
  if (w) setTimeout(() => watchDetail(w), 0);
}

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
  if (S.session) { try { await loadAll(); landing(); } catch { /* shown */ } }
  openFromUrl(location.search);
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
    if (session) { try { await loadAll(); landing(); } catch { /* shown */ } }
    render();
    ensurePush();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // A tapped notification while the app is already open
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.open && S.me) { openFromUrl(new URL(e.data.open).search); render(); }
    });
  }
})();
