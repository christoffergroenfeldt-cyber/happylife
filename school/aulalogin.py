"""Happy Life – log in to Aula with MitID from your own phone (a-Shell).

STIL's bot protection stops MitID logins from servers (GitHub), but not from a
normal Danish home or mobile connection. So the login happens here, once; the
server keeps the session alive afterwards (token refresh isn't blocked).

In a-Shell, one line (Happy Life → Setup → Skole direkte copies it; a-Shell has no &&):
  python3 -c "import urllib.request as u;exec(u.urlopen('<raw url of this file>').read())" <sync code> <MitID username>
The first run installs the packages it needs (in-process pip – a-Shell can't start subprocesses).

Run it on ANOTHER device than the phone with the MitID app (a laptop – Windows:
`py` instead of `python3` – an iPad, the other parent's phone): MitID asks to scan a QR code, which this script shows in
the terminal, and iOS pauses a-Shell while you are in the MitID app.
"""

import asyncio
import json
import os
import re
import sys
import time
import types
import urllib.request

APP = 'https://christoffergroenfeldt-cyber.github.io/happylife/config.js'

def ensure_packages():
    try:
        import aula, bs4, click, html2text, httpx, qrcode  # noqa: F401
        return
    except ImportError:
        pass
    print('Installerer det, der skal bruges (kun første gang, ca. et minut) …')
    import importlib
    import site
    from pip._internal.cli.main import main as pip
    if pip(['install', '--no-deps', 'aula==0.8.2']) or \
       pip(['install', 'beautifulsoup4', 'click', 'html2text', 'httpx', 'qrcode', 'tzdata']):
        sys.exit('✗ Installationen mislykkedes – send et skærmbillede til Claude')
    for d in [site.getusersitepackages()] + site.getsitepackages():
        if d not in sys.path:
            sys.path.append(d)
    importlib.invalidate_caches()


ensure_packages()

# a-Shell can't build the "cryptography" package; MitID only needs AES-GCM encrypt
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: F401
except ImportError:
    # --- pure-Python AES-GCM (only what MitID's SRP step uses: encrypt) ---
    def _xt(a): return ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1
    _SB = [0] * 256
    _p = _q = 1
    while True:
        _p = _p ^ ((_p << 1) & 0xFF) ^ (0x1B if _p & 0x80 else 0)
        _q ^= _q << 1; _q ^= _q << 2; _q ^= _q << 4; _q &= 0xFF
        if _q & 0x80: _q ^= 0x09
        _x = _q ^ ((_q << 1 | _q >> 7) & 0xFF) ^ ((_q << 2 | _q >> 6) & 0xFF) ^ ((_q << 3 | _q >> 5) & 0xFF) ^ ((_q << 4 | _q >> 4) & 0xFF)
        _SB[_p] = (_x ^ 0x63) & 0xFF
        if _p == 1: break
    _SB[0] = 0x63

    def _expand(key):
        nk = len(key) // 4; nr = nk + 6
        w = [list(key[4 * i:4 * i + 4]) for i in range(nk)]
        rc = 1
        for i in range(nk, 4 * (nr + 1)):
            t = list(w[i - 1])
            if i % nk == 0:
                t = [_SB[b] for b in t[1:] + t[:1]]; t[0] ^= rc; rc = _xt(rc)
            elif nk > 6 and i % nk == 4:
                t = [_SB[b] for b in t]
            w.append([a ^ b for a, b in zip(w[i - nk], t)])
        return [sum(w[4 * r:4 * r + 4], []) for r in range(nr + 1)]

    def _enc_block(rk, blk):
        s = [b ^ k for b, k in zip(blk, rk[0])]
        for r in range(1, len(rk)):
            s = [_SB[b] for b in s]
            s = [s[(i + 4 * (i % 4)) % 16] for i in range(16)]   # shift rows (column-major)
            if r != len(rk) - 1:
                n = []
                for c in range(4):
                    a = s[4 * c:4 * c + 4]; x = a[0] ^ a[1] ^ a[2] ^ a[3]
                    n += [a[i] ^ x ^ _xt(a[i] ^ a[(i + 1) % 4]) for i in range(4)]
                s = n
            s = [b ^ k for b, k in zip(s, rk[r])]
        return bytes(s)

    def _gmul(x, y):
        R = 0xE1 << 120; z = 0
        for i in range(127, -1, -1):
            if (y >> i) & 1: z ^= x
            x = (x >> 1) ^ R if x & 1 else x >> 1
        return z

    def _ghash(h, data):
        y = 0
        for i in range(0, len(data), 16):
            y = _gmul(y ^ int.from_bytes(data[i:i + 16].ljust(16, b'\0'), 'big'), h)
        return y

    class AESGCM:
        def __init__(self, key): self._rk = _expand(bytes(key))
        def encrypt(self, nonce, data, aad):
            aad = aad or b''; E = lambda b: _enc_block(self._rk, b)
            h = int.from_bytes(E(bytes(16)), 'big')
            if len(nonce) == 12: j0 = nonce + b'\0\0\0\1'
            else:
                pad = lambda b: b + bytes(-len(b) % 16)
                j0 = _ghash(h, pad(nonce) + (len(nonce) * 8).to_bytes(16, 'big')).to_bytes(16, 'big')
            ctr = int.from_bytes(j0[12:], 'big'); out = bytearray()
            for i in range(0, len(data), 16):
                ctr = (ctr + 1) & 0xFFFFFFFF
                ks = E(j0[:12] + ctr.to_bytes(4, 'big'))
                out += bytes(a ^ b for a, b in zip(data[i:i + 16], ks))
            pad = lambda b: b + bytes(-len(b) % 16)
            s = _ghash(h, pad(aad) + pad(bytes(out)) + (len(aad) * 8).to_bytes(8, 'big') + (len(out) * 8).to_bytes(8, 'big'))
            tag = (s ^ int.from_bytes(E(j0), 'big')).to_bytes(16, 'big')
            return bytes(out) + tag

    for _name in ('cryptography', 'cryptography.hazmat', 'cryptography.hazmat.primitives',
                  'cryptography.hazmat.primitives.ciphers', 'cryptography.hazmat.primitives.ciphers.aead'):
        sys.modules[_name] = types.ModuleType(_name)
    sys.modules['cryptography.hazmat.primitives.ciphers.aead'].AESGCM = AESGCM


def supabase():
    js = urllib.request.urlopen(APP, timeout=30).read().decode()
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", js).group(1)
    anon = re.search(r"SUPABASE_ANON_KEY\s*=\s*'([^']+)'", js).group(1)
    return url, anon


def rpc(url, anon, name, args):
    req = urllib.request.Request(
        f'{url}/rest/v1/rpc/{name}', data=json.dumps(args).encode(), method='POST',
        headers={'apikey': anon, 'Authorization': f'Bearer {anon}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get('message')
        except Exception:
            msg = str(e)
        sys.exit(f'\n✗ {msg}')
    return json.loads(body) if body else None


def qr_text(qr):
    """A QR code as half-block text: dark modules in the text colour (black in
    a-Shell), so it scans from the screen. Spaces around it are the quiet zone."""
    m = qr.get_matrix()
    m = [[False] * len(m[0])] * 2 + m + [[False] * len(m[0])] * 3
    rows = []
    for y in range(0, len(m) - 1, 2):
        top, bot = m[y], m[y + 1]
        rows.append(''.join('█' if t and b else '▀' if t else '▄' if b else ' '
                            for t, b in zip(top, bot)))
    # forced black on white, so it scans in dark terminals too (Windows, dark themes)
    return '\n'.join(f'  \033[30;107m  {r}  \033[0m' for r in rows)


def patch_poll():
    """MitID polling that survives short network drops (a-Shell paused in the
    background) instead of crashing; otherwise the library's own logic."""
    import httpx
    from aula.auth.browser_client import BrowserClient
    from aula.auth.exceptions import MitIDError

    async def poll(self, poll_url, ticket):
        drops = 0
        while True:
            try:
                r = await self._client.post(poll_url, json={'ticket': ticket})
            except httpx.TransportError:
                drops += 1
                if drops > 120:
                    raise
                await asyncio.sleep(1)
                continue
            data = r.json()
            if not r.is_success:
                raise MitIDError('Login request was not accepted')
            if data['status'] == 'OK' and data['confirmation'] is True:
                return data['payload']['response'], data['payload']['responseSignature']
            st = data['status']
            if st == 'channel_validation_otp':
                self.otp_code = data['channelBindingValue']
                self.status_message = f'otp:{self.otp_code}'
            elif st == 'channel_validation_tqr':
                self._handle_qr_code_poll(data)
            elif st == 'channel_verified':
                self.qr1 = self.qr2 = None
                self.status_message = 'verified'
            elif st != 'timeout':
                raise MitIDError(f'Unexpected poll status: {st}')
            await asyncio.sleep(0.5)

    BrowserClient._poll_for_app_confirmation = poll


async def login(username):
    import logging
    logging.getLogger('httpx').setLevel(logging.WARNING)
    from aula.auth.mitid_client import MitIDAuthClient
    from aula.auth_flow import _build_token_data
    patch_poll()

    if os.name == 'nt':
        os.system('')   # lets the Windows console understand colours / clear screen
    CLEAR = '\033[2J\033[H'
    async with MitIDAuthClient(mitid_username=username, timeout=60) as ac:
        task = asyncio.create_task(ac.authenticate())
        t0 = time.time()
        flip = 0
        last = None
        while not task.done():
            bc = getattr(ac, '_mitid_client', None)
            note = getattr(bc, 'status_message', None) if bc else None
            qr1, qr2 = (getattr(bc, 'qr1', None), getattr(bc, 'qr2', None)) if bc else (None, None)
            if qr1 and qr2:
                # MitID's two QR codes, shown in turn like on mitid.dk
                flip ^= 1
                print(CLEAR + 'Scan med MitID-appen på din telefon:\n')
                print(qr_text(qr1 if flip else qr2))
                print('\n(Knib for at gøre teksten mindre, hvis koden ikke er hel.)')
                last = 'qr'
            elif note != last:
                last = note
                if note == 'verified':
                    print(CLEAR + '✓ Koden er scannet – godkend nu i MitID-appen …')
                elif note and note.startswith('otp:'):
                    print(f'\n   Skriv denne kode i MitID-appen:   {note[4:]}\n')
                elif note:
                    print('… Åbn MitID-appen på din telefon og godkend. Vises en QR-kode her, så scan den.')
            if time.time() - t0 > 300:
                task.cancel()
                break
            await asyncio.sleep(0.8)
        try:
            await task
        except asyncio.CancelledError:
            sys.exit('\n✗ MitID blev ikke godkendt i tide – prøv igen')
        return _build_token_data(username, ac.tokens, dict(ac.cookies))


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


async def check(td):
    from aula.auth_flow import create_client
    patch_models()
    client = await create_client(td)
    async with client:
        profile = await client.get_profile()
    return len(profile.children)


def main():
    if len(sys.argv) < 3:
        sys.exit('Mangler synkroniseringskode og MitID-brugernavn – kopiér linjen igen i Happy Life')
    code, username = sys.argv[1].strip(), sys.argv[2].strip()
    url, anon = supabase()
    print('Starter MitID – godkend i MitID-appen …')
    td = asyncio.run(login(username))
    print('✓ Logget ind på Aula')
    rpc(url, anon, 'school_session_import', {'p_token': code, 'p_username': username, 'p_session': td})
    print('✓ Sendt til Happy Life. Serveren henter fra Aula inden for ca. 10 minutter.')
    try:
        print(f'  (Aula svarer: {asyncio.run(check(td))} børn)')
    except Exception as e:   # only a check – the login is already sent
        print(f'  (Kunne ikke tjekke profilen: {type(e).__name__} – det gør ikke noget)')


if __name__ == '__main__':
    main()
