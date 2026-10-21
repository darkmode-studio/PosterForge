#!/usr/bin/env python3
"""Builds the bundled font set: static Regular/Bold instances of variable fonts, subset to the scripts PosterForge
uses, keeping every OpenType layout feature (so Malayalam conjunct shaping stays intact). Needs fonttools.
Usage: build-fonts.py <source-dir> <assets/fonts dir>"""
import sys, os, json, shutil
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SRC, OUT = sys.argv[1], sys.argv[2]
LATIN = list(range(0x20, 0x7F)) + list(range(0xA0, 0x250)) + list(range(0x2000, 0x2070)) + [0x20B9, 0x20AC, 0x2122, 0x2190, 0x2192, 0x2022, 0x25CF]
MAL = list(range(0x0D00, 0x0D80)) + [0x200C, 0x200D, 0x25CC, 0x0964, 0x0965]
# family, category, script, {weight: source file}
FAMILIES = [
  ('Manjari', 'Malayalam', 'ml', {400: 'Manjari-Regular.ttf', 700: 'Manjari-Bold.ttf'}, 'OFL-manjari.txt'),
  ('Chilanka', 'Malayalam', 'ml', {400: 'Chilanka-Regular.ttf'}, 'OFL-chilanka.txt'),
  ('Noto Sans Malayalam', 'Malayalam', 'ml', {400: 'NotoSansMalayalam[wdth,wght].ttf', 700: 'NotoSansMalayalam[wdth,wght].ttf'}, 'LIC-notosansmalayalam.txt'),
  ('Noto Serif Malayalam', 'Malayalam', 'ml', {400: 'NotoSerifMalayalam[wght].ttf', 700: 'NotoSerifMalayalam[wght].ttf'}, 'LIC-notoserifmalayalam.txt'),
  ('Baloo Chettan 2', 'Malayalam', 'ml', {400: 'BalooChettan2[wght].ttf', 700: 'BalooChettan2[wght].ttf'}, 'LIC-baloochettan2.txt'),
  ('Anek Malayalam', 'Malayalam', 'ml', {400: 'AnekMalayalam[wdth,wght].ttf', 700: 'AnekMalayalam[wdth,wght].ttf'}, 'LIC-anekmalayalam.txt'),
  ('Gayathri', 'Malayalam', 'ml', {400: 'Gayathri-Regular.ttf', 700: 'Gayathri-Bold.ttf'}, 'LIC-gayathri.txt'),
  ('Rachana', 'Malayalam', 'ml', {400: 'Rachana-Regular.ttf', 700: 'Rachana-Bold.ttf'}, 'smc'),
  ('Meera', 'Malayalam', 'ml', {400: 'Meera-Regular.ttf'}, 'smc'),
  ('Keraleeyam', 'Malayalam', 'ml', {400: 'Keraleeyam-Regular.ttf'}, 'smc'),
  ('Uroob', 'Malayalam', 'ml', {400: 'Uroob-Regular.ttf'}, 'smc'),
  ('Dyuthi', 'Malayalam', 'ml', {400: 'Dyuthi-Regular.ttf'}, 'smc'),
  ('Playfair Display', 'Serif', 'la', {400: 'PlayfairDisplay[wght].ttf', 700: 'PlayfairDisplay[wght].ttf'}, 'LIC-playfairdisplay.txt'),
  ('DM Serif Display', 'Serif', 'la', {400: 'DMSerifDisplay-Regular.ttf'}, 'LIC-dmserifdisplay.txt'),
  ('Cormorant Garamond', 'Serif', 'la', {400: 'CormorantGaramond[wght].ttf', 700: 'CormorantGaramond[wght].ttf'}, 'LIC-cormorantgaramond.txt'),
  ('Fraunces', 'Serif', 'la', {400: 'Fraunces[SOFT,WONK,opsz,wght].ttf', 700: 'Fraunces[SOFT,WONK,opsz,wght].ttf'}, 'LIC-fraunces.txt'),
  ('Lora', 'Serif', 'la', {400: 'Lora[wght].ttf', 700: 'Lora[wght].ttf'}, 'LIC-lora.txt'),
  ('Montserrat', 'Sans', 'la', {400: 'Montserrat-Regular.ttf', 700: 'Montserrat-Bold.ttf'}, 'OFL-montserrat.txt'),
  ('Poppins', 'Sans', 'la', {400: 'Poppins-Regular.ttf', 700: 'Poppins-Bold.ttf'}, 'OFL-poppins.txt'),
  ('Inter', 'Sans', 'la', {400: 'Inter[opsz,wght].ttf', 700: 'Inter[opsz,wght].ttf'}, 'LIC-inter.txt'),
  ('Space Grotesk', 'Sans', 'la', {400: 'SpaceGrotesk[wght].ttf', 700: 'SpaceGrotesk[wght].ttf'}, 'LIC-spacegrotesk.txt'),
  ('Oswald', 'Sans', 'la', {400: 'Oswald[wght].ttf', 700: 'Oswald[wght].ttf'}, 'LIC-oswald.txt'),
  ('Bebas Neue', 'Display', 'la', {400: 'BebasNeue-Regular.ttf'}, 'OFL-bebasneue.txt'),
  ('Anton', 'Display', 'la', {400: 'Anton-Regular.ttf'}, 'LIC-anton.txt'),
  ('Archivo Black', 'Display', 'la', {400: 'ArchivoBlack-Regular.ttf'}, 'LIC-archivoblack.txt'),
  ('Dancing Script', 'Script', 'la', {400: 'DancingScript[wght].ttf', 700: 'DancingScript[wght].ttf'}, 'LIC-dancingscript.txt'),
  ('Great Vibes', 'Script', 'la', {400: 'GreatVibes-Regular.ttf'}, 'LIC-greatvibes.txt'),
  ('Caveat', 'Script', 'la', {400: 'Caveat[wght].ttf', 700: 'Caveat[wght].ttf'}, 'LIC-caveat.txt'),
  ('Permanent Marker', 'Script', 'la', {400: 'PermanentMarker-Regular.ttf'}, 'LIC-permanentmarker.txt'),
]
OFL_BODY = open(os.path.join(SRC, 'LIC-gayathri.txt')).read().split('\n', 2)[2]  # standard OFL 1.1 text without the copyright line

def build(src, weight):
    f = TTFont(os.path.join(SRC, src))
    if 'fvar' in f:
        pins = {}
        for a in f['fvar'].axes:
            if a.axisTag == 'wght': pins['wght'] = max(a.minValue, min(a.maxValue, weight))
            elif a.axisTag == 'opsz': pins['opsz'] = max(a.minValue, min(a.maxValue, 32))  # display optical size
            elif a.axisTag == 'wdth': pins['wdth'] = max(a.minValue, min(a.maxValue, 100))
            else: pins[a.axisTag] = a.defaultValue
        f = instancer.instantiateVariableFont(f, pins, updateFontNames=False)
    return f

def subset_font(f, script):
    opts = subset.Options()
    opts.layout_features = ['*']; opts.name_IDs = ['*']; opts.name_languages = ['*']; opts.notdef_outline = True
    opts.glyph_names = False; opts.hinting = False; opts.legacy_kern = True; opts.layout_scripts = ['*']
    s = subset.Subsetter(opts)
    s.populate(unicodes=LATIN + (MAL if script == 'ml' else []))
    s.subset(f)
    return f

os.makedirs(OUT, exist_ok=True)
for fn in os.listdir(OUT):
    if fn.endswith('.ttf') or fn.startswith(('OFL', 'LICENSE')): os.remove(os.path.join(OUT, fn))
manifest = []
for fam, cat, script, weights, lic in FAMILIES:
    base = fam.replace(' ', '')
    files = {}
    for w, src in weights.items():
        f = subset_font(build(src, w), script)
        name = f"{base}-{'Bold' if w >= 600 else 'Regular'}.ttf"
        f.save(os.path.join(OUT, name)); files[w] = 'fonts/' + name
    licname = f'LICENSE-{base}.txt'
    if lic == 'smc':
        cr = TTFont(os.path.join(SRC, list(weights.values())[0]))['name'].getDebugName(0)
        open(os.path.join(OUT, licname), 'w').write(cr + '\n\n' + OFL_BODY)
    else:
        shutil.copy(os.path.join(SRC, lic), os.path.join(OUT, licname))
    manifest.append({'family': fam, 'category': cat, 'malayalam': script == 'ml', 'files': files,
                     'license': 'Apache-2.0' if 'permanentmarker' in lic else 'OFL-1.1', 'licenseFile': 'fonts/' + licname})
open(os.path.join(OUT, 'fonts.json'), 'w').write(json.dumps(manifest, indent=1))
total = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
print(f'{len(manifest)} families, {total/1e6:.2f} MB')
