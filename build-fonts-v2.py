#!/usr/bin/env python3
"""PosterForge 2.0 font pipeline. Downloads open-licensed fonts (Google Fonts, SMC, Rachana Institute of Typography),
builds static faces, subsets them (Latin for English fonts; Malayalam+Latin for Malayalam fonts, every OpenType
layout feature kept so HarfBuzz conjunct shaping is intact) and writes fonts/fonts.json + fonts/licenses/.
OFL rule: fonts whose licence declares a Reserved Font Name are shipped UNMODIFIED (no subsetting/instancing),
because a modified version may not keep that name.  Usage: build-fonts-v2.py <cache-dir> <assets/fonts dir> <tree.json> <rit-dir>"""
import sys, os, json, re, glob, urllib.request, urllib.parse, shutil
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
CACHE, OUT, TREE, RIT = sys.argv[1:5]
sys.path.insert(0, os.path.dirname(TREE)); exec(open(os.path.join(os.path.dirname(TREE), 'en_list.py')).read())
G = 'https://raw.githubusercontent.com/google/fonts/main/'
LATIN = list(range(0x20, 0x7F)) + list(range(0xA0, 0x250)) + list(range(0x2000, 0x2070)) + [0x20B9, 0x20AC, 0x2122, 0x2190, 0x2192, 0x2022, 0x25CF, 0x2192, 0x2794, 0x27F6]
MAL = list(range(0x0D00, 0x0D80)) + [0x200C, 0x200D, 0x25CC, 0x0964, 0x0965]
paths = [x['path'] for x in json.load(open(TREE))['tree']]

def fetch(url, dst):
    if not os.path.exists(dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with urllib.request.urlopen(urllib.parse.quote(url, safe=':/'), timeout=60) as r, open(dst + '.part', 'wb') as f: f.write(r.read())
        os.rename(dst + '.part', dst)
    return dst

def gf_sources(fam):
    d = re.sub('[^a-z0-9]', '', fam.lower())
    for lic in ('ofl', 'apache', 'ufl'):
        ttf = [p for p in paths if p.startswith(f'{lic}/{d}/') and p.endswith('.ttf') and p.count('/') == 2]
        if ttf:
            licf = [p for p in paths if p.startswith(f'{lic}/{d}/') and p.split('/')[-1] in ('OFL.txt', 'LICENSE.txt', 'UFL.txt')]
            return lic, ttf, licf[0]
    raise SystemExit('missing ' + fam)

def instance(src, wght, ital_file=False):
    f = TTFont(src)
    if 'fvar' in f:
        pins = {}
        for a in f['fvar'].axes:
            if a.axisTag == 'wght':
                if not (a.minValue <= wght <= a.maxValue): return None
                pins['wght'] = wght
            elif a.axisTag == 'opsz': pins['opsz'] = max(a.minValue, min(a.maxValue, 32))
            elif a.axisTag == 'wdth': pins['wdth'] = max(a.minValue, min(a.maxValue, 100))
            else: pins[a.axisTag] = a.defaultValue
        f = instancer.instantiateVariableFont(f, pins, updateFontNames=False)
        f['OS/2'].usWeightClass = wght
    return f

def do_subset(f, ml):
    o = subset.Options(); o.layout_features = ['*']; o.name_IDs = ['*']; o.name_languages = ['*']; o.notdef_outline = True
    o.glyph_names = False; o.hinting = False; o.legacy_kern = True; o.layout_scripts = ['*']
    s = subset.Subsetter(o); s.populate(unicodes=LATIN + (MAL if ml else [])); s.subset(f); return f

def rfn(text):
    head = re.split(r'This Font Software is licensed|SIL OPEN FONT LICENSE', text or '', flags=re.I)[0]
    return bool(re.search(r'Reserved\s+Font\s+Names?', head, re.I))
os.makedirs(OUT + '/licenses', exist_ok=True)
for fn in glob.glob(OUT + '/*.ttf') + glob.glob(OUT + '/*.otf') + glob.glob(OUT + '/LICENSE-*') + glob.glob(OUT + '/licenses/*'): os.remove(fn)
manifest, lic_rows = [], []
def key(w, i): return f"{w}{'i' if i else ''}"
def save(fam, faces, cat, ml, licname, lictext, source, modified, extra=None):
    base = re.sub('[^A-Za-z0-9]', '', fam) or re.sub('[^A-Za-z0-9]', '', (extra or {}).get('_base', 'Font'))
    files = {}
    for (w, i), f in faces.items():
        name = f"{base}-{w}{'i' if i else ''}.ttf"
        f.save(os.path.join(OUT, name)); files[key(w, i)] = 'fonts/' + name
    lf = f'fonts/licenses/{base}.txt'; open(os.path.join(OUT, 'licenses', base + '.txt'), 'w').write(lictext)
    e = {'family': fam, 'category': cat, 'malayalam': ml, 'files': files, 'license': licname, 'licenseFile': lf, 'source': source, 'modified': modified}
    if extra: e['variable'] = extra
    manifest.append(e); lic_rows.append(e)

# ---------- English (Google Fonts) ----------
WANT = [(400, False), (700, False), (400, True), (300, False), (900, False)]
for cat, fams in EN.items():
    for fam in fams:
        lic, srcs, licp = gf_sources(fam)
        local = {p: fetch(G + p, os.path.join(CACHE, p)) for p in srcs}
        lictext = open(fetch(G + licp, os.path.join(CACHE, licp)), encoding='utf-8', errors='replace').read()
        licname = {'ofl': 'OFL-1.1', 'apache': 'Apache-2.0', 'ufl': 'UFL-1.0'}[lic]
        if lic == 'ufl': continue
        keep_unmod = rfn(lictext)
        var = [p for p in srcs if '[' in p]; static = [p for p in srcs if '[' not in p]
        faces = {}
        for w, it in WANT:
            if (300 in (w,) or 900 in (w,)) and cat not in ('Serif', 'Sans', 'Condensed'): continue
            pick = None
            if static:
                nm = {400: 'Regular', 700: 'Bold', 300: 'Light', 900: 'Black'}[w]
                want = (nm + 'Italic' if nm != 'Regular' else 'Italic') if it else nm
                c = [p for p in static if p.split('/')[-1].rsplit('.', 1)[0].split('-')[-1] == want]
                if c: pick = TTFont(local[c[0]])
                elif w == 400 and not it and len(static) == 1: pick = TTFont(local[static[0]])
            if pick is None and var and not keep_unmod:
                vs = [p for p in var if ('Italic' in p) == it]
                if vs: pick = instance(local[vs[0]], w)
            if pick is not None:
                if not keep_unmod: pick = do_subset(pick, False)
                faces[(w, it)] = pick
        if (400, False) not in faces:  # e.g. black-only display fonts: take whatever regular-ish face exists
            if static:
                f = TTFont(local[static[0]]); faces[(f['OS/2'].usWeightClass if f['OS/2'].usWeightClass in (400, 700, 900) else 400, False)] = f if keep_unmod else do_subset(f, False)
        varfiles = {}
        if not faces and var and keep_unmod:  # RFN + variable-only: ship the variable file(s) byte-for-byte
            base = re.sub('[^A-Za-z0-9]', '', fam)
            for p in var:
                it = 'Italic' in p; f = TTFont(local[p]); ax = [a for a in f['fvar'].axes if a.axisTag == 'wght'][0]
                name = f"{base}-VF{'i' if it else ''}.ttf"; shutil.copyfile(local[p], os.path.join(OUT, name))
                varfiles['vi' if it else 'v'] = {'file': 'fonts/' + name, 'wght': [int(ax.minValue), int(ax.maxValue)]}
        if not faces and not varfiles: print('SKIP', fam); continue
        save(fam, faces, cat, False, licname, lictext, 'Google Fonts', not keep_unmod, varfiles)
        print(cat, fam, sorted(key(*k) for k in faces), 'RFN' if keep_unmod else '')

# ---------- Malayalam ----------
SMC = 'https://smc.org.in/downloads/fonts/'
OFL_BODY = open(fetch(G + 'ofl/gayathri/OFL.txt', os.path.join(CACHE, 'ofl/gayathri/OFL.txt'))).read().split('\n', 2)[2]
GPL_FE = 'GNU General Public License v3 (or later) with the font embedding exception.\nAs a special exception, if you create a document which uses this font, and embed this font or unaltered portions of this font into the document, this font does not by itself cause the resulting document to be covered by the GNU General Public License.\nFull text: https://www.gnu.org/licenses/gpl-3.0.txt\n'
ML_GF = [('Manjari', {(100, False): 'ofl/manjari/Manjari-Thin.ttf', (400, False): 'ofl/manjari/Manjari-Regular.ttf', (700, False): 'ofl/manjari/Manjari-Bold.ttf'}),
         ('Chilanka', {(400, False): 'ofl/chilanka/Chilanka-Regular.ttf'}),
         ('Gayathri', {(100, False): 'ofl/gayathri/Gayathri-Thin.ttf', (400, False): 'ofl/gayathri/Gayathri-Regular.ttf', (700, False): 'ofl/gayathri/Gayathri-Bold.ttf'}),
         ('Noto Sans Malayalam', 'ofl/notosansmalayalam/NotoSansMalayalam[wdth,wght].ttf'),
         ('Noto Sans Malayalam UI', 'ofl/notosansmalayalamui/NotoSansMalayalamUI[wdth,wght].ttf'),
         ('Noto Serif Malayalam', 'ofl/notoserifmalayalam/NotoSerifMalayalam[wght].ttf'),
         ('Baloo Chettan 2', 'ofl/baloochettan2/BalooChettan2[wght].ttf'),
         ('Anek Malayalam', 'ofl/anekmalayalam/AnekMalayalam[wdth,wght].ttf')]
for fam, spec in ML_GF:
    d = (spec if isinstance(spec, str) else next(iter(spec.values()))).split('/')[1]
    lictext = open(fetch(G + f'ofl/{d}/OFL.txt', os.path.join(CACHE, f'ofl/{d}/OFL.txt'))).read(); unmod = rfn(lictext)
    faces = {}
    if isinstance(spec, str):
        src = fetch(G + spec, os.path.join(CACHE, spec))
        for w in (300, 400, 700, 900):
            f = instance(src, w)
            if f: faces[(w, False)] = do_subset(f, True)
    else:
        for k, p in spec.items():
            if p not in paths: continue
            f = TTFont(fetch(G + p, os.path.join(CACHE, p))); faces[k] = f if unmod else do_subset(f, True)
    save(fam, faces, 'Malayalam', True, 'OFL-1.1', lictext, 'Google Fonts', not unmod); print('ML', fam, sorted(faces))
SMC_FONTS = [('Rachana', {(400, False): 'rachana/Rachana-Regular', (700, False): 'rachana/Rachana-Bold'}), ('Meera', {(400, False): 'meera/Meera-Regular'}),
             ('Keraleeyam', {(400, False): 'keraleeyam/Keraleeyam-Regular'}), ('Uroob', {(400, False): 'uroob/Uroob-Regular'}), ('Dyuthi', {(400, False): 'dyuthi/Dyuthi-Regular'}),
             ('Suruma', {(400, False): 'suruma/Suruma'}), ('Raghu Malayalam Sans', {(400, False): 'raghumalayalamsans/RaghuMalayalamSans-Regular'}),
             ('Anjali Old Lipi', {(400, False): 'anjalioldlipi/AnjaliOldLipi-Regular'}), ('Karumbi', {(400, False): 'karumbi/Karumbi-Regular'})]
for fam, spec in SMC_FONTS:
    faces = {}; texts = ''
    for k, p in spec.items():
        f = TTFont(fetch(SMC + p + '.ttf', os.path.join(CACHE, 'smc', p + '.ttf'))); faces[k] = f
        texts = (f['name'].getDebugName(0) or '') + '\n' + (f['name'].getDebugName(13) or '')
    gpl = 'GPL' in texts
    unmod = rfn(texts) or gpl
    if not unmod: faces = {k: do_subset(v, True) for k, v in faces.items()}
    lic = 'GPL-3.0-or-later WITH Font-exception' if gpl else 'OFL-1.1'
    body = (texts.split('\n')[0] + '\n\n' + (GPL_FE if gpl else OFL_BODY))
    save(fam, faces, 'Malayalam', True, lic, body, 'Swathanthra Malayalam Computing (smc.org.in)', not unmod); print('ML', fam, lic, 'unmod' if unmod else '')
for proj in sorted(os.listdir(RIT)):
    d = os.path.join(RIT, proj)
    if not os.path.isdir(d): continue
    faces = {}; fam = None
    for p in sorted(glob.glob(d + '/fonts/ttf/*.ttf')):
        f = TTFont(p); fam = f['name'].getDebugName(16) or f['name'].getDebugName(1)
        w = f['OS/2'].usWeightClass; it = bool(f['OS/2'].fsSelection & 1)
        faces[(w, it)] = f
        if not re.search('[A-Za-z]', fam or ''): fam = 'RIT ' + proj.replace('RIT-', '').capitalize()  # RIT licences declare a Reserved Font Name -> ship unmodified
    if not faces: continue
    lic = os.path.join(d, 'LICENSE.txt')
    lictext = open(lic).read() if os.path.exists(lic) else (faces[next(iter(faces))]['name'].getDebugName(0) + '\n\n' + OFL_BODY)
    if 'SIL OPEN FONT LICENSE' not in lictext.upper(): lictext = lictext.strip() + '\n\n' + OFL_BODY
    save(fam, faces, 'Malayalam', True, 'OFL-1.1', lictext, 'Rachana Institute of Typography (gitlab.com/rit-fonts)', False); print('ML', fam, sorted(faces))
json.dump(manifest, open(os.path.join(OUT, 'fonts.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
en = sum(1 for m in manifest if not m['malayalam']); ml = len(manifest) - en
print('EN', en, 'ML', ml, 'faces', sum(len(m['files']) for m in manifest))
