// Happy Life – main app
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { t, setLang, getLang, LANGS, IDEAS } from './i18n.js';
import { todayISO, daysBetween, trackerStatus, eventStatus, periodKey, periodEnd, fmtDate } from './dates.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ROLES = ['child', 'mother', 'father', 'husband', 'wife'];
const ITEM_ROLES = ['all', ...ROLES];
const PARENT = ['mother', 'father'];

const S = {
  session: null, me: null, family: null, members: [],
  plans: [], tasks: [], done: [], takes: [], trackers: [], entries: [], events: [],
  tab: 'home', authStep: 'email', authEmail: '', setupMode: 'create', ideaShift: {},
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
  const [family, members, plans, tasks, done, takes, trackers, entries, events] = await Promise.all([
    run(sb.from('families').select('*').eq('id', me.family_id).single()),
    run(sb.from('members').select('*').order('created_at')),
    run(sb.from('plans').select('*').order('created_at')),
    run(sb.from('tasks').select('*').order('created_at')),
    run(sb.from('task_done').select('*').gte('done_on', isoMinus(400))),
    run(sb.from('task_takes').select('*').gte('created_at', isoMinus(400))),
    run(sb.from('trackers').select('*').order('created_at')),
    run(sb.from('tracker_entries').select('*').order('done_on', { ascending: false })),
    run(sb.from('events').select('*')),
  ]);
  Object.assign(S, { family, members, plans, tasks, done, takes, trackers, entries, events });
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
  if (task.recurrence === 'custom') return t('everyN', task.interval_days);
  return t('rec.' + task.recurrence);
}

// ------------------------------------------------------------ render root

function render() {
  setLang(store('hl-lang') || getLang());
  if (!S.session) return renderAuth();
  if (!S.me) return renderSetup();
  const tabs = ['home', 'tasks', 'moments', 'calendar', 'family'];
  const icons = { home: '🏠', tasks: '✅', moments: '💛', calendar: '📅', family: '👪' };
  const views = { home: viewHome, tasks: viewTasks, moments: viewMoments, calendar: viewCalendar, family: viewFamily };
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
      ${codeStep ? `
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
      ${langPicker()}
    </div>`;

  const busy = (e, on) => { if (e.submitter) e.submitter.disabled = on; };
  if (codeStep) {
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
    .filter((x) => x.st.dueIn <= 0)
    .sort((a, b) => a.st.dueIn - b.st.dueIn);

  // Events within their reminder window
  const upcoming = S.events
    .map((ev) => ({ ev, st: eventStatus(ev, td) }))
    .filter(({ ev, st }) => st.ongoing || (st.days >= 0 && st.days <= ev.remind_days))
    .sort((a, b) => a.st.days - b.st.days);

  // Tasks for me in the current period
  const mine = S.tasks.map((task) => ({ task, st: taskState(task) }))
    .filter(({ st }) => st.active && !st.done && (st.kind === 'open' ? (st.took || !st.full) : st.forMe));

  return `
    <p class="hello">${esc(t('hello', { name: S.me.display_name }))}</p>
    ${due.length ? `<h2>${esc(t('timeFor'))}</h2>${due.map(({ tr, st }) => momentCard(tr, st, true)).join('')}` : ''}
    <h2>${esc(t('upcoming'))}</h2>
    ${upcoming.length ? upcoming.map(({ ev, st }) => eventRow(ev, st)).join('') : `<p class="empty">${esc(t('noUpcoming'))}</p>`}
    <h2>${esc(t('today'))}</h2>
    ${mine.length ? `<div class="list">${mine.map(({ task, st }) => taskRow(task, st)).join('')}</div>`
                  : `<p class="empty">${esc(t('nothingToday'))}</p>`}
    ${!due.length && !mine.length ? `<p class="allgood">${esc(t('allGood'))}</p>` : ''}`;
}

// ------------------------------------------------------------ tasks + plans

function taskRow(task, st, opts = {}) {
  const plan = task.plan_id && !opts.inPlan ? S.plans.find((p) => p.id === task.plan_id) : null;
  const meta = [recLabel(task)];
  if (st.end && !st.done) meta.push(t('dueBy', { date: fmtDate(st.end, getLang()) }));
  if (plan) meta.push(plan.title);
  if (st.kind === 'role') meta.push(task.roles.map((r) => t('roles.' + r)).join(', '));

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
  const canEdit = task.created_by === uid() || isParent();
  return `
    <div class="row ${st.done ? 'is-done' : ''}">
      ${st.kind === 'open' ? '' : `<div class="lead">${actions}</div>`}
      <div class="body">
        <div class="ttl">${esc(task.title)}</div>
        ${task.notes ? `<div class="notes">${esc(task.notes)}</div>` : ''}
        <div class="meta">${meta.map(esc).join(' · ')}</div>
        ${extra}
        ${st.kind === 'open' ? `<div class="acts">${actions}</div>` : ''}
      </div>
      ${canEdit && opts.manage ? `<button class="icon" data-act="editTask" data-id="${task.id}" aria-label="${t('edit')}">✎</button>` : ''}
    </div>`;
}

function viewTasks() {
  const all = S.tasks.map((task) => ({ task, st: taskState(task) }));
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
    <div class="toolbar">
      <button class="primary" data-act="newTask">＋ ${t('newTask')}</button>
      ${isParent() ? `<button data-act="newPlan">＋ ${t('newPlan')}</button>` : ''}
    </div>
    <h2>${esc(t('myTasks'))}</h2>
    ${mine.length ? `<div class="list">${mine.map(({ task, st }) => taskRow(task, st, { manage: true })).join('')}</div>`
                  : `<p class="empty">${esc(t('noTasks'))}</p>`}
    <h2>${esc(t('familyTasks'))}</h2>
    ${fam.length ? `<div class="list">${fam.map(({ task, st }) => taskRow(task, st, { manage: true })).join('')}</div>`
                 : `<p class="empty">${esc(t('noTasks'))}</p>`}
    ${isParent() ? `<h2>${esc(t('plans'))}</h2>${plans || `<p class="empty">${esc(t('noPlans'))}</p>`}` : ''}
    ${others.length ? `<h2>${esc(t('forOthers'))}</h2><div class="list">${others.map(({ task, st }) => taskRow(task, st, { manage: true })).join('')}</div>` : ''}`;
}

function taskForm(task, planId) {
  const editing = !!task;
  const tk = task || {
    title: '', notes: '', recurrence: planId ? 'daily' : 'once', interval_days: 3,
    start_date: today(), due_date: '', need: 1, open: false,
    assignees: planId ? children().map((c) => c.user_id) : [],
    roles: planId ? [] : ['all'], plan_id: planId || null,
  };
  const kind = editing ? taskKind(tk) : (planId ? 'assigned' : 'open');
  const kinds = isParent() ? ['assigned', 'open', 'role'] : ['open', 'role'];
  const assignable = isParent() ? S.members : S.members.filter((m) => m.user_id === uid());
  const recs = ['once', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];
  openDialog(`
    <form id="taskForm" class="form">
      <h2>${editing ? t('edit') : t('newTask')}</h2>
      <label>${t('title')}<input name="title" value="${esc(tk.title)}" required></label>
      <label>${t('note')}<input name="notes" value="${esc(tk.notes || '')}"></label>
      <label>${t('taskType')}<select name="kind">${kinds.map((k) =>
        `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(t('tt.' + k))}</option>`).join('')}</select></label>
      <fieldset data-show="assigned"><legend>${t('assignTo')}</legend>${memberCheckboxes('assignees', assignable, tk.assignees)}</fieldset>
      <fieldset data-show="open role"><legend>${t('visibleTo')}</legend>${roleCheckboxes('roles', ITEM_ROLES, tk.roles.length ? tk.roles : ['all'])}</fieldset>
      <label data-show="open">${t('need')}<input name="need" type="number" min="1" max="20" value="${tk.need}"></label>
      <label>${t('recurrence')}<select name="recurrence">${recs.map((r) =>
        `<option value="${r}" ${r === tk.recurrence ? 'selected' : ''}>${esc(t('rec.' + r))}</option>`).join('')}</select></label>
      <label data-rec="custom">${t('intervalN')}<input name="interval_days" type="number" min="1" value="${tk.interval_days || 3}"></label>
      <label data-rec="daily weekly monthly yearly custom">${t('startDate')}<input name="start_date" type="date" value="${tk.start_date}"></label>
      <label data-rec="once">${t('due')}<input name="due_date" type="date" value="${tk.due_date || ''}"></label>
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
    };
    if (!row.title) return toast(t('needTitle'), true);
    if (k === 'assigned' && !row.assignees.length) return toast(t('assignTo') + '?', true);
    if (k !== 'assigned' && !row.roles.length) return toast(t('needRole'), true);
    if (editing) await run(sb.from('tasks').update(row).eq('id', task.id));
    else await run(sb.from('tasks').insert(row));
    closeDialog(); await refresh();
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

// ------------------------------------------------------------ moments

const entriesOf = (id) => S.entries.filter((e) => e.tracker_id === id);

function ideaFor(tr) {
  const list = IDEAS[getLang()][tr.kind] || IDEAS[getLang()].custom;
  const base = daysBetween('2026-01-01', today()) + tr.id.charCodeAt(0);
  return list[(base + (S.ideaShift[tr.id] || 0)) % list.length];
}

function momentCard(tr, st, compact = false) {
  const lastTxt = st.last ? `${t('lastDone')}: ${fmtDate(st.last, getLang())} (${t('daysAgo', st.since)})` : t('never');
  const dueTxt = st.dueIn < 0 ? t('overdueBy', -st.dueIn) : st.dueIn === 0 ? t('dueToday') : t('dueIn', st.dueIn);
  const pct = st.last ? Math.min(100, Math.round((st.since / tr.interval_days) * 100)) : 100;
  const hist = entriesOf(tr.id).slice(0, 5);
  return `
    <div class="card moment kind-${tr.kind} ${st.dueIn <= 0 ? 'due' : ''}">
      <div class="m-head">
        <div><h3>${esc(tr.title)}</h3><div class="meta">${roleChips(tr.roles)} · ${esc(t('every', tr.interval_days))}</div></div>
        ${compact ? '' : `<button class="icon" data-act="editMoment" data-id="${tr.id}" aria-label="${t('edit')}">✎</button>`}
      </div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="meta">${esc(lastTxt)} · <strong>${esc(dueTxt)}</strong></div>
      ${st.dueIn <= 0 ? `<div class="idea">💡 ${esc(ideaFor(tr))}
        <button class="link" data-act="idea" data-id="${tr.id}">${t('anotherIdea')}</button></div>` : ''}
      <div class="acts">
        <button class="primary" data-act="logMoment" data-id="${tr.id}">${t('logIt')}</button>
        <button data-act="logOther" data-id="${tr.id}">${t('logOther')}</button>
      </div>
      ${!compact && hist.length ? `<details><summary>${t('history')}</summary><ul class="hist">${hist.map((e) => `
        <li>${fmtDate(e.done_on, getLang())} ${t('by')} ${esc(memberName(e.done_by))}${e.note ? ` – ${esc(e.note)}` : ''}
        ${e.done_by === uid() ? `<button class="link" data-act="delEntry" data-id="${e.id}">${t('delete')}</button>` : ''}</li>`).join('')}
      </ul></details>` : ''}
    </div>`;
}

function viewMoments() {
  const td = today();
  const cards = S.trackers
    .map((tr) => ({ tr, st: trackerStatus(tr.interval_days, entriesOf(tr.id).map((e) => e.done_on), td) }))
    .sort((a, b) => a.st.dueIn - b.st.dueIn)
    .map(({ tr, st }) => momentCard(tr, st)).join('');
  return `<div class="toolbar"><button class="primary" data-act="newMoment">＋ ${t('newMoment')}</button></div>
    ${cards || `<p class="empty">${esc(t('noMoments'))}</p>`}`;
}

function momentForm(tr) {
  const m = tr || { title: '', kind: 'custom', roles: myRoles().length ? [...myRoles()] : ['all'], interval_days: 30 };
  openDialog(`
    <form id="momentForm" class="form">
      <h2>${tr ? t('edit') : t('newMoment')}</h2>
      <label>${t('title')}<input name="title" value="${esc(m.title)}" required></label>
      <label>${t('kind')}<select name="kind">${Object.keys(IDEAS.en).map((k) =>
        `<option value="${k}" ${k === m.kind ? 'selected' : ''}>${esc(t('kinds.' + k))}</option>`).join('')}</select></label>
      <label>${t('intervalDays')}<input name="interval_days" type="number" min="1" value="${m.interval_days}" required></label>
      <fieldset><legend>${t('visibleTo')}</legend>${roleCheckboxes('roles', ITEM_ROLES, m.roles)}</fieldset>
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
  const icon = { vacation: '🏖️', anniversary: '💍', birthday: '🎂', other: '📌' }[ev.type];
  const when = st.ongoing ? t('ongoing') : st.days === 0 ? t('isToday') : st.days > 0 ? t('inDays', st.days) : '';
  const range = ev.end_date ? `${fmtDate(ev.start_date, getLang())} – ${fmtDate(ev.end_date, getLang())}` : fmtDate(st.date, getLang());
  return `
    <div class="row event" data-act="editEvent" data-id="${ev.id}">
      <div class="lead big">${icon}</div>
      <div class="body"><div class="ttl">${esc(ev.title)}${ev.yearly && st.years > 0 ? ` · ${esc(t('years', st.years))}` : ''}</div>
        <div class="meta">${esc(range)}${when ? ` · <strong>${esc(when)}</strong>` : ''}</div></div>
    </div>`;
}

function viewCalendar() {
  const td = today();
  const list = S.events.map((ev) => ({ ev, st: eventStatus(ev, td) }));
  const future = list.filter(({ ev, st }) => st.ongoing || st.days >= 0 || (ev.end_date && ev.end_date >= td))
    .sort((a, b) => a.st.days - b.st.days);
  const past = list.filter((x) => !future.includes(x)).sort((a, b) => b.ev.start_date.localeCompare(a.ev.start_date));
  return `<div class="toolbar"><button class="primary" data-act="newEvent">＋ ${t('newEvent')}</button></div>
    ${future.length ? `<div class="list">${future.map(({ ev, st }) => eventRow(ev, st)).join('')}</div>` : `<p class="empty">${esc(t('noEvents'))}</p>`}
    ${past.length ? `<details><summary>${t('history')}</summary><div class="list">${past.map(({ ev, st }) => eventRow(ev, st)).join('')}</div></details>` : ''}`;
}

function eventForm(ev) {
  const e0 = ev || { type: 'vacation', title: '', start_date: today(), end_date: '', yearly: false, remind_days: 14, roles: ['all'] };
  openDialog(`
    <form id="eventForm" class="form">
      <h2>${ev ? t('edit') : t('newEvent')}</h2>
      <label>${t('kind')}<select name="type">${['vacation', 'anniversary', 'birthday', 'other'].map((k) =>
        `<option value="${k}" ${k === e0.type ? 'selected' : ''}>${esc(t('types.' + k))}</option>`).join('')}</select></label>
      <label>${t('title')}<input name="title" value="${esc(e0.title)}" required></label>
      <div class="two"><label>${t('start')}<input name="start_date" type="date" value="${e0.start_date}" required></label>
        <label>${t('end')}<input name="end_date" type="date" value="${e0.end_date || ''}"></label></div>
      <label class="check"><input type="checkbox" name="yearly" ${e0.yearly ? 'checked' : ''}><span>${t('yearly')}</span></label>
      <label>${t('remindBefore')}<input name="remind_days" type="number" min="0" value="${e0.remind_days}"></label>
      <fieldset><legend>${t('visibleTo')}</legend>${roleCheckboxes('roles', ITEM_ROLES, e0.roles)}</fieldset>
      <div class="btns">
        ${ev ? `<button type="button" class="danger" data-act="delEvent" data-id="${ev.id}">${t('delete')}</button>` : ''}
        <span class="grow"></span>
        <button type="button" data-act="close">${t('cancel')}</button>
        <button class="primary" type="submit">${t('save')}</button>
      </div>
    </form>`);
  const form = document.getElementById('eventForm');
  form.elements.type.onchange = () => { form.elements.yearly.checked = ['anniversary', 'birthday'].includes(form.elements.type.value); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const row = { type: f.get('type'), title: f.get('title').trim(), start_date: f.get('start_date'),
      end_date: f.get('end_date') || null, yearly: f.get('yearly') === 'on',
      remind_days: Number(f.get('remind_days')) || 0, roles: f.getAll('roles') };
    if (row.end_date && row.end_date < row.start_date) row.end_date = row.start_date;
    if (!row.roles.length) return toast(t('needRole'), true);
    if (ev) await run(sb.from('events').update(row).eq('id', ev.id));
    else await run(sb.from('events').insert(row));
    closeDialog(); await refresh();
  };
}

// ------------------------------------------------------------ family

function viewFamily() {
  const admin = S.me.is_admin;
  return `
    <div class="card">
      <h3>${esc(S.family.name)}</h3>
      <p class="meta">${esc(t('inviteHelp'))}</p>
      <div class="code">${esc(S.family.invite_code)}</div>
      ${admin ? `<button class="small" data-act="newCode">${t('newCode')}</button>` : ''}
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
    <h2>${esc(t('language'))}</h2>
    ${langPicker()}
    <button class="link out" data-act="signOut">${t('signOut')}</button>`;
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
  lang: (id) => { store('hl-lang', id); setLang(id); render(); },
  otherEmail: () => { S.authStep = 'email'; render(); },
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
    toast('✓'); await refresh();
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
  editPlan: (id) => planForm(byId(S.plans, id)),
  delPlan: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('plans').delete().eq('id', id)); closeDialog(); await refresh(); },

  newMoment: () => momentForm(null),
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
  delEvent: async (id) => { if (!confirm(t('confirmDelete'))) return;
    await run(sb.from('events').delete().eq('id', id)); closeDialog(); await refresh(); },

  newCode: async () => { await run(sb.rpc('new_invite_code')); await refresh(); },
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
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'TOKEN_REFRESHED') { S.session = session; return; }
    if (event === 'INITIAL_SESSION') return;
    S.session = session;
    S.me = null;
    S.authStep = 'email';
    if (session) { try { await loadAll(); } catch { /* shown */ } }
    render();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
