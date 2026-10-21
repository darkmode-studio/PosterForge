#!/usr/bin/env python3
"""PosterForge 2.2 assets, all drawn procedurally here (no third-party images): paper textures, leaf/branch stickers,
washi tape, and the hot-air-balloon demo photos with exactly aligned subject cutouts. Output: small WebP files."""
import math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
A = os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'main', 'assets')
OUT = os.path.join(A, 'img', 'v22'); os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(22); random.seed(22)

def wrap_noise(n, sigma):
    f = np.fft.fft2(rng.standard_normal((n, n)))
    ky = np.fft.fftfreq(n)[:, None]; kx = np.fft.fftfreq(n)[None, :]
    g = np.exp(-(kx ** 2 + ky ** 2) * (2 * math.pi * sigma) ** 2 / 2)
    r = np.real(np.fft.ifft2(f * g)); return (r - r.mean()) / (r.std() + 1e-9)

def paper(name, base, n=512, amp=(7, 4, 3), fibers=True):
    a = wrap_noise(n, 24) * amp[0] + wrap_noise(n, 3) * amp[1] + rng.standard_normal((n, n)) * amp[2]
    img = np.clip(np.array(base, float)[None, None, :] + a[..., None] * np.array([1, 0.97, 0.9]), 0, 255).astype(np.uint8)
    im = Image.fromarray(img, 'RGB')
    if fibers:
        d = ImageDraw.Draw(im, 'RGBA')
        for _ in range(140):
            x, y = rng.uniform(0, n, 2); ang = rng.uniform(0, math.pi); L = rng.uniform(6, 22)
            c = tuple(int(v) for v in np.array(base) - rng.uniform(10, 25)) + (60,)
            for dx in (-n, 0, n):
                for dy in (-n, 0, n):
                    d.line([(x + dx, y + dy), (x + dx + L * math.cos(ang), y + dy + L * math.sin(ang))], fill=c, width=1)
    im.save(os.path.join(OUT, name), 'WEBP', quality=72, method=6)

paper('paper-ivory.webp', (243, 237, 223))
paper('paper-green.webp', (22, 56, 40), amp=(6, 3, 3))
paper('paper-maroon.webp', (88, 20, 28), amp=(6, 3, 3))
paper('paper-navy.webp', (18, 30, 58), amp=(6, 3, 3))
paper('texture-cream.webp', (240, 226, 190), n=256, amp=(10, 8, 6), fibers=False)
paper('texture-gold.webp', (212, 168, 72), n=256, amp=(20, 12, 8), fibers=False)

def save_rgba(im, name, q=80):
    bb = im.getbbox(); im = im.crop(bb) if bb else im
    im.save(os.path.join(OUT, name), 'WEBP', quality=q, method=6)

S = 2  # supersample
def leaf_poly(cx, cy, L, W, ang, n=40, tip=1.0):
    pts = []
    for i in range(n + 1):
        t = i / n; w = W * math.sin(math.pi * t) ** 0.9 * (1 - 0.15 * t)
        pts.append((t * L, w))
    pts += [(t * L, -w) for (t, w) in [(p[0] / L, p[1]) for p in reversed(pts)]]
    ca, sa = math.cos(ang), math.sin(ang)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]

def draw_leaf(d, cx, cy, L, W, ang, col, vein):
    d.polygon(leaf_poly(cx, cy, L, W, ang), fill=col)
    # light half for depth
    d.polygon(leaf_poly(cx, cy, L, W * 0.55, ang), fill=tuple(min(255, int(c * 1.12)) for c in col[:3]) + (255,))
    ca, sa = math.cos(ang), math.sin(ang)
    d.line([(cx, cy), (cx + L * 0.95 * ca, cy + L * 0.95 * sa)], fill=vein, width=max(1, int(W * 0.035)))
    for k in range(1, 7):
        t = k / 7.5; bx, by = cx + L * t * ca, cy + L * t * sa
        for s in (-1, 1):
            ex = bx + (L * 0.12) * ca - s * (W * 0.7 * math.sin(math.pi * t)) * sa
            ey = by + (L * 0.12) * sa + s * (W * 0.7 * math.sin(math.pi * t)) * ca
            d.line([(bx, by), (ex, ey)], fill=vein[:3] + (110,), width=max(1, int(W * 0.03)))

def sticker(name, fn, size=(640, 640)):
    im = Image.new('RGBA', (size[0] * S, size[1] * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im); fn(d, size[0] * S, size[1] * S)
    im = im.resize(size, Image.LANCZOS)
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0)); a = im.split()[3].filter(ImageFilter.GaussianBlur(6)).point(lambda v: v * 0.28)
    sh.putalpha(a); base = Image.new('RGBA', im.size, (0, 0, 0, 0)); base.alpha_composite(sh, (4, 8)); base.alpha_composite(im)
    save_rgba(base, name)

def monstera(d, w, h):
    draw_leaf(d, w * 0.1, h * 0.9, w * 0.85, w * 0.26, -0.8, (46, 112, 62, 255), (205, 230, 190, 255))
def branch(d, w, h, col=(64, 120, 70, 255), n=9, L=0.2, W=0.06):
    pts = [(w * (0.08 + 0.84 * t), h * (0.85 - 0.7 * t + 0.12 * math.sin(t * 3.2))) for t in np.linspace(0, 1, 30)]
    d.line(pts, fill=(96, 72, 48, 255), width=int(w * 0.012), joint='curve')
    for i in range(n):
        t = (i + 0.6) / (n + 0.4); x, y = pts[int(t * 29)]
        for s in (-1, 1):
            ang = -0.65 + s * 0.95 + (0.25 if s > 0 else -0.1)
            draw_leaf(d, x, y, w * L * (1 - 0.35 * t), w * W * (1 - 0.3 * t), ang, tuple(int(c * (0.9 + 0.2 * random.random())) for c in col[:3]) + (255,), (190, 220, 170, 255))
    draw_leaf(d, *pts[-1], w * L * 0.6, w * W * 0.6, -0.6, col, (190, 220, 170, 255))
def eucalyptus(d, w, h):
    pts = [(w * (0.5 + 0.12 * math.sin(t * 5)), h * (0.95 - 0.9 * t)) for t in np.linspace(0, 1, 30)]
    d.line(pts, fill=(120, 96, 80, 255), width=int(w * 0.01), joint='curve')
    for i in range(12):
        x, y = pts[int((i + 1) / 13 * 29)]; r = w * (0.09 - 0.004 * i); s = 1 if i % 2 else -1
        cx = x + s * r * 0.95; c = (122 + random.randint(-8, 8), 156 + random.randint(-8, 8), 140, 255)
        d.ellipse([cx - r, y - r * 0.85, cx + r, y + r * 0.85], fill=c)
        d.line([(x, y), (cx + s * r * 0.6, y)], fill=(170, 196, 182, 255), width=max(1, int(w * 0.004)))
def fern(d, w, h):
    pts = [(w * (0.15 + 0.7 * t), h * (0.9 - 0.75 * t - 0.15 * math.sin(t * 3))) for t in np.linspace(0, 1, 40)]
    d.line(pts, fill=(70, 110, 50, 255), width=int(w * 0.008), joint='curve')
    for i in range(1, 38):
        x, y = pts[i]; t = i / 39; L = w * 0.16 * math.sin(math.pi * (0.15 + 0.85 * t)) ** 0.7 * (1.05 - t)
        a = math.atan2(pts[i + 1][1] - y, pts[i + 1][0] - x)
        for s in (-1, 1): draw_leaf(d, x, y, L, L * 0.22, a + s * 1.1, (78, 132, 58, 255), (150, 190, 120, 255))
def olive(d, w, h): branch(d, w, h, col=(110, 128, 78, 255), n=11, L=0.17, W=0.035)

sticker('leaf-monstera.webp', monstera)
sticker('leaf-branch.webp', branch)
sticker('leaf-eucalyptus.webp', eucalyptus, (480, 720))
sticker('leaf-fern.webp', fern)
sticker('leaf-olive.webp', olive)

# washi tape
t = Image.new('RGBA', (320, 90), (248, 236, 200, 190)); d = ImageDraw.Draw(t)
for x in range(-90, 320, 22): d.line([(x, 0), (x + 90, 90)], fill=(236, 190, 150, 120), width=7)
m = Image.new('L', t.size, 0); md = ImageDraw.Draw(m)
md.polygon([(0, 4)] + [(4 + (i % 2) * 5, 4 + i * 8) for i in range(11)] + [(0, 86), (320, 86)] + [(316 - (i % 2) * 5, 86 - i * 8) for i in range(11)] + [(320, 4)], fill=255)
t.putalpha(Image.fromarray(np.minimum(np.array(m), np.array(t.split()[3]))))
save_rgba(t, 'tape.webp')

# ---- hot-air balloon demo photos + aligned cutouts (same canvas size: the cutout sits exactly on the photo) ----
def balloon_layer(size, cx, cy, R, cols, basket_drop=1.55):
    w, h = size; im = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    cx, cy, R = cx * S, cy * S, R * S
    # envelope outline: circle top + taper to the mouth
    pts = []
    for i in range(181):
        a = math.pi + i / 180 * math.pi; pts.append((cx + R * math.cos(a), cy + R * math.sin(a)))
    for i in range(61):
        t = i / 60; x = R * (1 - 0.72 * t ** 1.2); y = R * 1.15 * t
        pts.append((cx + x, cy + y))
    for i in range(61):
        t = 1 - i / 60; x = R * (1 - 0.72 * t ** 1.2); y = R * 1.15 * t
        pts.append((cx - x, cy + y))
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).polygon(pts, fill=255)
    yy, xx = np.mgrid[0:im.size[1], 0:im.size[0]]
    u = np.arcsin(np.clip((xx - cx) / (R * 1.001), -1, 1)); band = np.floor((u + math.pi / 2) / math.pi * 8).astype(int) % len(cols)
    pal = np.array(cols, float)[band]
    shade = np.clip(1.05 - ((xx - cx + R * 0.35) ** 2 + (yy - cy + R * 0.45) ** 2) ** 0.5 / (R * 2.4), 0.55, 1.08)
    rgb = np.clip(pal * shade[..., None], 0, 255).astype(np.uint8)
    env = Image.fromarray(np.dstack([rgb, np.array(mask)]), 'RGBA')
    im.alpha_composite(env)
    my = cy + R * 1.15; mw = R * 0.28; by = cy + R * basket_drop; bw = R * 0.22
    for s in (-1, -0.33, 0.33, 1): d.line([(cx + s * mw, my), (cx + s * bw * 0.8, by)], fill=(60, 45, 35, 255), width=int(R * 0.012) + 1)
    d.rounded_rectangle([cx - bw, by, cx + bw, by + R * 0.26], radius=int(R * 0.03), fill=(126, 84, 46, 255))
    for k in range(1, 4): d.line([(cx - bw, by + R * 0.065 * k), (cx + bw, by + R * 0.065 * k)], fill=(96, 62, 34, 255), width=int(R * 0.01) + 1)
    return im.resize(size, Image.LANCZOS)

def scene(src, name, balloons, tone=None):
    bg = Image.open(os.path.join(A, 'templates', src)).convert('RGBA')
    if tone: bg = Image.blend(bg, Image.new('RGBA', bg.size, tone), 0.18)
    cut = Image.new('RGBA', bg.size, (0, 0, 0, 0))
    for b in balloons: cut.alpha_composite(balloon_layer(bg.size, *b))
    ph = bg.copy(); ph.alpha_composite(cut)
    ph.convert('RGB').save(os.path.join(OUT, name + '-photo.webp'), 'WEBP', quality=78, method=6)
    cut.save(os.path.join(OUT, name + '-subject.webp'), 'WEBP', quality=82, method=6)

RED = [(214, 64, 52), (246, 196, 72), (236, 120, 48), (246, 236, 214)]
BLUE = [(40, 90, 170), (246, 236, 214), (232, 72, 84), (60, 150, 160)]
scene('sky-clouds.webp', 'balloon-sky', [(560, 640, 300, RED, 1.62)])
scene('dusk-hills.webp', 'balloon-dusk', [(540, 700, 270, BLUE), (870, 330, 90, RED)])
scene('misty-mountains.webp', 'balloon-mist', [(540, 860, 230, RED)])
print('ok', sorted(os.listdir(OUT)))

# muted film grade (lifted blacks, low saturation, warm) for the "text behind subject" template; same grade on the cutout
def muted(name):
    for part in ('photo', 'subject'):
        p = os.path.join(OUT, f'{name}-{part}.webp'); im = Image.open(p).convert('RGBA'); a = np.array(im).astype(float)
        rgb = a[..., :3]; g = rgb.mean(axis=2, keepdims=True); rgb = g + (rgb - g) * 0.62
        rgb = 28 + rgb * (226 - 28) / 255; rgb *= np.array([1.04, 1.0, 0.93]); a[..., :3] = np.clip(rgb, 0, 255)
        out = Image.fromarray(a.astype(np.uint8), 'RGBA')
        q = os.path.join(OUT, f'{name}-muted-{part}.webp')
        (out.convert('RGB') if part == 'photo' else out).save(q, 'WEBP', quality=80, method=6)
muted('balloon-sky')
