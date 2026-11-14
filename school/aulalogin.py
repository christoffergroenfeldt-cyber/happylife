"""Happy Life – log in to Aula with MitID from your own phone (a-Shell).

STIL's bot protection stops MitID logins from servers (GitHub), but not from a
normal Danish home or mobile connection. So the login happens here, once; the
server keeps the session alive afterwards (token refresh isn't blocked).

In a-Shell, one line (Happy Life → Setup → Skole direkte copies it; a-Shell has no &&):
  python3 -c "import urllib.request as u;exec(u.urlopen('<raw url of this file>').read())" <sync code> <MitID username>
The first run installs the packages it needs (in-process pip – a-Shell can't start subprocesses).

Approve in the MitID app. If MitID asks for a QR code, it is printed here –
scan it from another device's screen, or choose "can't scan" in the MitID app
and type the code shown here instead.
"""

import asyncio
import json
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


async def login(username):
    from aula.auth.mitid_client import MitIDAuthClient
    from aula.auth_flow import _build_token_data

    async with MitIDAuthClient(mitid_username=username, timeout=60) as ac:
        task = asyncio.create_task(ac.authenticate())
        shown = None
        t0 = time.time()
        while not task.done():
            bc = getattr(ac, '_mitid_client', None)
            if bc is not None:
                qr1, otp, note = getattr(bc, 'qr1', None), getattr(bc, 'otp_code', None), getattr(bc, 'status_message', None)
                state = (id(qr1), otp, note)
                if state != shown:
                    shown = state
                    if note:
                        print(f'… {note}')
                    if otp:
                        print(f'\n   Kode til MitID-appen:   {otp}\n')
                    if qr1:
                        print('\nScan med MitID-appen fra en anden skærm, eller vælg "kan ikke scanne":')
                        qr1.print_ascii(invert=True)
            if time.time() - t0 > 300:
                task.cancel()
                break
            await asyncio.sleep(0.5)
        try:
            await task
        except asyncio.CancelledError:
            sys.exit('\n✗ MitID blev ikke godkendt i tide – prøv igen')
        return _build_token_data(username, ac.tokens, dict(ac.cookies))


async def check(td):
    from aula.auth_flow import create_client
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
    kids = asyncio.run(check(td))
    print(f'✓ Logget ind på Aula ({kids} børn)')
    rpc(url, anon, 'school_session_import', {'p_token': code, 'p_username': username, 'p_session': td})
    print('✓ Sendt til Happy Life. Serveren henter fra Aula inden for ca. 10 minutter.')


if __name__ == '__main__':
    main()
