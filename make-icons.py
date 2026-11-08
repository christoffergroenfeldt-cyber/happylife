# Regenerates icon-192.png, icon-512.png and apple-touch-icon.png (needs Pillow)
from PIL import Image, ImageDraw
import math


def icon(size, path, pad=0.0):
    S = size * 4
    im = Image.new('RGB', (S, S), '#d9534f')
    d = ImageDraw.Draw(im)
    s = S * (1 - pad)
    o = (S - s) / 2
    cx = S / 2
    r = s * 0.2
    k = math.sqrt(2) / 2
    y = o + s * 0.5 - (3 * k - 1) / 2 * r
    lc = (cx - r * k, y)
    rc = (cx + r * k, y)
    for c in (lc, rc):
        d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill='#fffaf4')
    tl = (lc[0] - r * k, y + r * k)
    tr = (rc[0] + r * k, y + r * k)
    tip = (cx, tl[1] + (cx - tl[0]))
    d.polygon([tl, (cx, y), tr, tip], fill='#fffaf4')
    im.resize((size, size), Image.LANCZOS).save(path)


icon(192, 'icon-192.png')
icon(512, 'icon-512.png', pad=0.15)
icon(180, 'apple-touch-icon.png')
