"""Happy Life – school sync (Aula + iCal feeds such as ForældreIntra).

Runs in GitHub Actions (.github/workflows/school-sync.yml) every few minutes:

  python school/school_sync.py check   -> prints work=yes|no (stdlib only, fast)
  python school/school_sync.py run     -> does the work (needs requirements.txt)

For each parent who linked school under Setup → Skole direkte:
  * a MitID login from the parent's phone (school/aulalogin.py in a-Shell –
    STIL blocks MitID logins from servers) arrives in session_import and is
    stored encrypted; after that, token refresh keeps it alive
  * Aula's calendar (+ the iCal feeds) go into the app through sync_calendar()
    – the same path as the iPhone Shortcut – as calendars "Aula – <child>"
  * Aula messages (latest per thread) and posts go to school_messages

The repository is public, so the log never shows names, titles, links or
codes – only counts. Details go to the parent's own row in the database.

Secret: HL_SCHOOL_KEY (its sha256 is in server_keys). The Aula session is kept
encrypted with it in school_links.aula_session.
"""

import asyncio
import base64
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAYS_AHEAD = 365


def config():
    js = (ROOT / 'config.js').read_text()
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", js).group(1)
    anon = re.search(r"SUPABASE_ANON_KEY\s*=\s*'([^']+)'", js).group(1)
    return url, anon, os.environ.get('HL_SCHOOL_KEY', '').strip()


URL, ANON, KEY = config()


def rpc_sync(name, args):
    """Call a Supabase RPC with the stdlib (used by `check`)."""
    req = urllib.request.Request(
        f'{URL}/rest/v1/rpc/{name}', data=json.dumps(args).encode(), method='POST',
        headers={'apikey': ANON, 'Authorization': f'Bearer {ANON}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
    return json.loads(body) if body else None


def check():
    # Not set up yet (no secret, or the database without the school tables): a quiet "no"
    # instead of a failed run every 5 minutes
    if not KEY:
        print('work=no')
        print('HL_SCHOOL_KEY secret is not set – see README, School direct', file=sys.stderr)
        return
    try:
        jobs = rpc_sync('school_jobs', {'p_key': KEY})
    except Exception as e:
        print('work=no')
        print(f'check failed: {type(e).__name__}', file=sys.stderr)
        return
    due = [j for j in jobs if j['due']]
    print(f'work={"yes" if due else "no"}')
    print(f'links: {len(jobs)}, due: {len(due)}', file=sys.stderr)


# ---------------------------------------------------------------- run

def fernet():
    from cryptography.fernet import Fernet
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(('happylife-aula|' + KEY).encode()).digest()))


class Db:
    def __init__(self, http):
        self.http = http

    async def rpc(self, name, args):
        r = await self.http.post(f'{URL}/rest/v1/rpc/{name}', json=args,
                                 headers={'apikey': ANON, 'Authorization': f'Bearer {ANON}'})
        if r.status_code >= 400:
            try:
                msg = r.json().get('message') or r.text
            except ValueError:
                msg = r.text
            raise RuntimeError(msg)
        return r.json() if r.content else None

    async def update(self, user, **fields):
        await self.rpc('school_job_update', {'p_key': KEY, 'p_user': user, 'p': fields})


def first_name(name):
    return (name or '').split(' ')[0] or 'Aula'


CPH = None
AULA_EXTRA = {}


def local_iso(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=CPH)
    return dt.astimezone(CPH).replace(microsecond=0).isoformat()


def clean_title(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()[:200]


# ---------------- Aula

async def aula_refresh(td):
    from aula.auth.mitid_client import MitIDAuthClient
    old = td.get('tokens') or {}
    if not old.get('refresh_token'):
        raise PermissionError('no refresh token')
    async with MitIDAuthClient(mitid_username=td.get('username') or '') as ac:
        new = await ac.refresh_access_token(old['refresh_token'])
    new.setdefault('refresh_token', old['refresh_token'])
    return {**td, 'tokens': new, 'timestamp': time.time()}


async def aula_client(db, job, td):
    """A ready Aula client from the stored session, refreshing tokens as needed.
    Raises PermissionError when a new MitID login is needed."""
    from aula.auth_flow import create_client
    from aula.http import AulaAuthenticationError
    from aula.auth.exceptions import OAuthError

    async def save(d):
        await db.update(job['user_id'], aula_session=fernet().encrypt(json.dumps(d).encode()).decode())

    tokens = td.get('tokens') or {}
    if not tokens.get('access_token') or (tokens.get('expires_at') or 0) < time.time() + 120:
        try:
            td = await aula_refresh(td)
        except (OAuthError, RuntimeError) as e:
            raise PermissionError(str(e))
        await save(td)
    try:
        return await create_client(td)
    except AulaAuthenticationError:
        pass
    try:   # the session cookies may be stale: new tokens, fresh session
        td = await aula_refresh({**td, 'cookies': {}})
    except (OAuthError, RuntimeError) as e:
        raise PermissionError(str(e))
    await save(td)
    try:
        return await create_client(td)
    except AulaAuthenticationError as e:
        raise PermissionError(str(e))


def patch_models():
    """aula 0.8.2 crashes when Aula sends null for some nested objects (e.g. a child
    without a profile picture): give those keys an empty object instead."""
    from aula.models.child import Child
    from aula.models.post import Post
    from aula.models.profile_reference import ProfileReference
    keys = ('profilePicture', 'institutionProfile', 'institution', 'content')
    for cls in (Child, Post, ProfileReference):
        if getattr(cls, '_hl_patched', False):
            continue
        orig = cls.from_dict

        def from_dict(c, data, *a, _orig=orig, **k):
            if isinstance(data, dict) and any(data.get(x, 0) is None for x in keys):
                data = {**data, **{x: {} for x in keys if x in data and data[x] is None}}
            return _orig(data, *a, **k)
        cls.from_dict = classmethod(from_dict)
        cls._hl_patched = True


async def aula_probe(client, profile):
    """Which add-ons (widgets) Aula offers this family, and whether the ones we
    may use answer (counts only, this week) – stored in school_links.aula_widgets."""
    out = {'widgets': [], 'probe': {}}
    try:
        for w in await client.get_widgets():
            out['widgets'].append({'id': w.widget_id, 'name': w.name, 'supplier': w.widget_supplier})
    except Exception as e:
        out['error'] = type(e).__name__
        return out
    ids = {w['id'] for w in out['widgets']}
    kids = [str(c._raw['userId']) for c in profile.children if c._raw and 'userId' in c._raw]
    insts = sorted({str((c._raw or {}).get('institutionProfile', {}).get('institutionCode', ''))
                    for c in profile.children} - {''})
    try:
        session_uuid = (await client.get_profile_context())['data']['userId']
    except Exception as e:
        out['probe']['context'] = type(e).__name__
        return out
    y, wk, _ = date.today().isocalendar()
    week = f'{y}-W{wk}'
    W = client.widgets
    tries = {
        '0029 MU ugebrev': lambda: W.get_ugeplan('0029', kids, insts, week, session_uuid),
        '0030 MU opgaver': lambda: W.get_mu_tasks('0030', kids, insts, week, session_uuid),
        '0062 Momo huskeliste': lambda: W.get_momo_reminders(kids, insts, session_uuid, date.today().isoformat(),
                                                             (date.today() + timedelta(days=14)).isoformat()),
        '0004 Meebook ugeplan': lambda: W.get_meebook_weekplan(kids, insts, week, session_uuid),
        '0001 EasyIQ ugeplan': lambda: W.get_easyiq_weekplan(week, session_uuid, insts, kids[0]),
        '0142 EasyIQ lektier': lambda: W.get_easyiq_homework(week, session_uuid, insts, kids[0]),
    }
    for name, fn in tries.items():
        if name[:4] not in ids or not kids:
            continue
        try:
            res = await fn()
            out['probe'][name] = len(res) if isinstance(res, list) else 'ok'
        except Exception as e:
            out['probe'][name] = f'{type(e).__name__}: {str(e)[:80]}'
    return out


async def aula_fetch(client):
    """Calendar rows [(title, start, end, allday, calendar)] and message rows."""
    patch_models()
    profile = await client.get_profile()
    kids = {c.id: first_name(c.name) for c in profile.children}
    ids = list(kids)
    rows = []
    probe = await aula_probe(client, profile)
    start = datetime.now(CPH).replace(hour=0, minute=0, second=0, microsecond=0)
    end_all = start + timedelta(days=DAYS_AHEAD)
    while start < end_all and ids:
        end = min(start + timedelta(days=30), end_all)
        for ev in await client.get_calendar_events(ids, start, end - timedelta(days=1)):
            title = clean_title(ev.title)
            if not title or not ev.start_datetime or not ev.end_datetime:
                continue
            raw = ev._raw or {}
            who = kids.get(ev.belongs_to)
            cal = f'Aula – {who}' if who else 'Aula'
            rows.append((title, ev.start_datetime, ev.end_datetime, bool(raw.get('allDay')), cal))
        start = end

    items = []
    try:
        posts = await client.get_posts(profile.institution_profile_ids, limit=20)
    except Exception as e:  # keep going without posts
        print(f'posts: {type(e).__name__}', file=sys.stderr)
        posts = []
    for p in posts:
        items.append({'kind': 'post', 'ext_id': str(p.id), 'title': clean_title(p.title),
                      'sender': p.owner.full_name if p.owner else None, 'body': p.content[:20000],
                      'sent_at': (p.publish_at or p.timestamp).isoformat() if (p.publish_at or p.timestamp) else None,
                      'important': bool(p.is_important)})

    try:
        threads = await client.get_message_threads()
    except Exception as e:
        print(f'messages: {type(e).__name__}', file=sys.stderr)
        threads = []
    AULA_EXTRA['widgets'] = probe
    cutoff = datetime.now(timezone.utc) - timedelta(days=60)
    for th in threads[:25]:
        raw = th._raw or {}
        latest = raw.get('latestMessage') or {}
        when = latest.get('sendDateTime') or raw.get('lastUpdatedDate')
        try:
            when_dt = datetime.fromisoformat(str(when).replace('Z', '+00:00')) if when else None
        except ValueError:
            when_dt = None
        if when_dt and when_dt.tzinfo and when_dt < cutoff:
            continue
        unread = raw.get('read') is False
        sender = (latest.get('sender') or {}).get('fullName')
        body = None
        txt = latest.get('text')
        if isinstance(txt, dict):
            txt = txt.get('html') or txt.get('text')
        if txt:
            from aula.utils.html import html_to_plain
            body = html_to_plain(str(txt))
        elif not unread:
            # Only read threads are opened, so nothing is marked as read in Aula by us
            try:
                msgs = await client.get_messages_for_thread(th.thread_id, limit=1)
                if msgs:
                    body = msgs[0].content
                    sender = sender or ((msgs[0]._raw or {}).get('sender') or {}).get('fullName')
            except Exception:
                pass
        items.append({'kind': 'message', 'ext_id': str(th.thread_id), 'title': clean_title(th.subject),
                      'sender': sender, 'body': body[:20000] if body else None,
                      'sent_at': when_dt.isoformat() if when_dt else None, 'unread': unread})
    return rows, items


# ---------------- iCal feeds

async def feed_rows(http, feed):
    import icalendar
    import recurring_ical_events
    url = re.sub(r'^webcal://', 'https://', feed['url'].strip(), flags=re.I)
    r = await http.get(url, follow_redirects=True, timeout=60)
    r.raise_for_status()
    cal = icalendar.Calendar.from_ical(r.content)
    today = date.today()
    rows = []
    for ev in recurring_ical_events.of(cal).between(today, today + timedelta(days=DAYS_AHEAD)):
        title = clean_title(ev.get('SUMMARY'))
        if not title or str(ev.get('STATUS', '')).upper() == 'CANCELLED':
            continue
        s = ev.get('DTSTART').dt
        e = ev.get('DTEND').dt if ev.get('DTEND') else None
        if isinstance(s, datetime):
            e = e if isinstance(e, datetime) else s
            rows.append((title, s, e, False, feed['name'].strip()[:100]))
        else:   # all day: DTEND is the day after
            e = e if isinstance(e, date) and not isinstance(e, datetime) else s + timedelta(days=1)
            rows.append((title, datetime(s.year, s.month, s.day, tzinfo=CPH),
                         datetime(e.year, e.month, e.day, tzinfo=CPH), True, feed['name'].strip()[:100]))
    return rows


async def push_calendar(db, job, rows):
    if not rows:
        return None
    return await db.rpc('sync_calendar', {
        'p_token': job['sync_token'],
        'p_titles': '\n'.join(r[0] for r in rows),
        'p_starts': '\n'.join(local_iso(r[1]) for r in rows),
        'p_ends': '\n'.join(local_iso(r[2]) for r in rows),
        'p_allday': '\n'.join('Yes' if r[3] else 'No' for r in rows),
        'p_calendars': '\n'.join(r[4] for r in rows),
    })


# ---------------- one parent

async def do_job(db, http, job):
    user = job['user_id']
    notes, rows, items = [], [], None
    aula_ok = None

    if job['mitid_username']:
        td = None
        if job.get('session_import'):
            # a fresh login from the parent's phone (school/aulalogin.py): keep it encrypted
            td = job['session_import']
            await db.update(user, status='ok',
                            aula_session=fernet().encrypt(json.dumps(td).encode()).decode())
        elif job['status'] == 'login_requested':
            # STIL's bot protection blocks MitID logins from servers – the login is done on the phone
            await db.update(user, status='login_needed', login_note='Log ind fra telefonen – se vejledningen')
        elif job['aula_session'] and job['status'] in ('ok', 'error'):
            try:
                td = json.loads(fernet().decrypt(job['aula_session'].encode()))
            except Exception:
                await db.update(user, status='login_needed', login_note='Log ind med MitID igen')
        if td:
            try:
                client = await aula_client(db, job, td)
                async with client:
                    rows_a, items = await aula_fetch(client)
                await db.update(user, aula_widgets=AULA_EXTRA.pop('widgets', None))
                rows += rows_a
                aula_ok = True
                notes.append(f'Aula: {len(rows_a)} i kalenderen, {len(items)} beskeder/opslag')
                await db.update(user, status='ok')
            except PermissionError:
                aula_ok = False
                await db.update(user, status='login_needed', login_note='Aula-login udløbet – log ind med MitID igen')
                notes.append('Aula: log ind igen')
            except Exception as e:
                aula_ok = False
                await db.update(user, status='error')
                notes.append(f'Aula-fejl: {type(e).__name__}: {e}'[:200])
                print(f'aula: {type(e).__name__}', file=sys.stderr)

    for feed in job['feeds'] or []:
        try:
            fr = await feed_rows(http, feed)
            rows += fr
            notes.append(f'{feed["name"]}: {len(fr)}')
        except Exception as e:
            notes.append(f'{feed["name"]}: fejl ({type(e).__name__})')
            print(f'feed: {type(e).__name__}', file=sys.stderr)

    if items is not None:
        await db.rpc('school_messages_put', {'p_key': KEY, 'p_user': user, 'p_items': items})
    try:
        res = await push_calendar(db, job, rows)
        if res:
            notes.append(res)
    except Exception as e:
        notes.append(f'Kalender: {e}'[:300])
    await db.update(user, synced=True, last_result=' · '.join(notes) or 'Intet at hente')
    print(f'done: {len(rows)} calendar rows, {len(items or [])} items, aula={aula_ok}', file=sys.stderr)


async def run():
    global CPH
    import httpx
    from zoneinfo import ZoneInfo
    CPH = ZoneInfo('Europe/Copenhagen')
    import logging
    logging.basicConfig(level=logging.ERROR)   # public log: no library chatter
    async with httpx.AsyncClient(timeout=60) as http:
        db = Db(http)
        jobs = await db.rpc('school_jobs', {'p_key': KEY})
        for job in (j for j in jobs if j['due']):
            try:
                await do_job(db, http, job)
            except Exception as e:
                print(f'job failed: {type(e).__name__}', file=sys.stderr)
                try:
                    await db.update(job['user_id'], synced=True, last_result=f'Fejl: {e}'[:300])
                except Exception:
                    pass


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'check':
        check()
    else:
        asyncio.run(run())
