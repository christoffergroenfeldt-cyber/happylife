"""Happy Life – school sync (Aula + iCal feeds such as ForældreIntra).

Runs in GitHub Actions (.github/workflows/school-sync.yml) every few minutes:

  python school/school_sync.py check   -> prints work=yes|no (stdlib only, fast)
  python school/school_sync.py run     -> does the work (needs requirements.txt)

For each parent who linked school under Setup → Skole direkte:
  * a MitID login asked for in the app: runs it, showing the QR code / code
    from MitID in the app until it's approved in the MitID app
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
LOGIN_TIMEOUT = 300  # seconds to wait for the MitID app


def config():
    js = (ROOT / 'config.js').read_text()
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", js).group(1)
    anon = re.search(r"SUPABASE_ANON_KEY\s*=\s*'([^']+)'", js).group(1)
    key = os.environ.get('HL_SCHOOL_KEY', '').strip()
    if not key:
        sys.exit('HL_SCHOOL_KEY secret is missing')
    return url, anon, key


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
    jobs = rpc_sync('school_jobs', {'p_key': KEY})
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


def local_iso(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=CPH)
    return dt.astimezone(CPH).replace(microsecond=0).isoformat()


def clean_title(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()[:200]


# ---------------- Aula

async def aula_login(db, job):
    """Run the MitID flow; show QR / code in the app while it waits."""
    from aula.auth.mitid_client import MitIDAuthClient
    from aula.auth_flow import _build_token_data
    import qrcode.image.svg

    user = job['user_id']
    await db.update(user, status='login_running', login_note='Starter MitID…',
                    login_qr1=None, login_qr2=None, login_otp=None)

    def svg(qr):
        return qr.make_image(image_factory=qrcode.image.svg.SvgPathImage).to_string(encoding='unicode')

    async with MitIDAuthClient(mitid_username=job['mitid_username'], timeout=60) as ac:
        task = asyncio.create_task(ac.authenticate())
        shown = None
        t0 = time.time()
        while not task.done():
            bc = getattr(ac, '_mitid_client', None)
            if bc is not None:
                qr1, qr2 = getattr(bc, 'qr1', None), getattr(bc, 'qr2', None)
                otp = getattr(bc, 'otp_code', None)
                note = getattr(bc, 'status_message', None)
                state = (id(qr1), id(qr2), otp, note)
                if state != shown:
                    shown = state
                    await db.update(user,
                                    login_qr1=svg(qr1) if qr1 else None,
                                    login_qr2=svg(qr2) if qr2 else None,
                                    login_otp=otp, login_note=note)
            if time.time() - t0 > LOGIN_TIMEOUT:
                task.cancel()
                break
            await asyncio.sleep(0.7)
        try:
            await task
        except asyncio.CancelledError:
            raise RuntimeError('MitID blev ikke godkendt i tide – prøv igen')
        return _build_token_data(job['mitid_username'], ac.tokens, dict(ac.cookies))


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


async def aula_fetch(client):
    """Calendar rows [(title, start, end, allday, calendar)] and message rows."""
    profile = await client.get_profile()
    kids = {c.id: first_name(c.name) for c in profile.children}
    ids = list(kids)
    rows = []
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
        if job['status'] == 'login_requested':
            try:
                td = await aula_login(db, job)
                await db.update(user, status='ok', login_qr1=None, login_qr2=None, login_otp=None,
                                login_note='Logget ind ✓',
                                aula_session=fernet().encrypt(json.dumps(td).encode()).decode())
            except Exception as e:
                await db.update(user, status='login_needed', login_qr1=None, login_qr2=None, login_otp=None,
                                login_note=f'Login mislykkedes: {e}'[:300])
                print(f'login failed: {type(e).__name__}', file=sys.stderr)
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
        # logins first, so nobody waits with the MitID app open
        for job in sorted((j for j in jobs if j['due']), key=lambda j: j['status'] != 'login_requested'):
            try:
                await do_job(db, http, job)
            except Exception as e:
                print(f'job failed: {type(e).__name__}', file=sys.stderr)
                try:
                    await db.update(job['user_id'], synced=True, last_result=f'Fejl: {e}'[:300])
                except Exception:
                    pass
        # a login asked for while we were busy: go again instead of waiting for the next run
        again = [j for j in await db.rpc('school_jobs', {'p_key': KEY}) if j['status'] == 'login_requested']
        for job in again:
            await do_job(db, http, job)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'check':
        check()
    else:
        asyncio.run(run())
