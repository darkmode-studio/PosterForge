// Quote template library: editable Fabric JSON in three reference styles, English + Malayalam, post 4:5 / story 9:16 / square.
// Photos are generated placeholders bundled as small WebP files in assets/templates/.
export const SIZES = { post: [1080, 1350], story: [1080, 1920], square: [1080, 1080] };
const PH = { sea: 'templates/sea-aerial.webp', sky: 'templates/sky-clouds.webp', dusk: 'templates/dusk-hills.webp', night: 'templates/night-bokeh.webp', mist: 'templates/misty-mountains.webp', palm: 'templates/backwater-sunset.webp' };
const PHOTO_W = 1080, PHOTO_H = 1350;

const txt = (text, p = {}) => ({ type: 'text', version: '5.3.0', originX: 'center', originY: 'center', text, fontFamily: 'Montserrat', fontWeight: 400, fontSize: 60, fill: '#ffffff',
  textAlign: 'center', lineHeight: 1.12, charSpacing: 0, name: text.split('\n')[0].slice(0, 24), ...p });
function photo(src, W, H) {
  const k = Math.max(W / PHOTO_W, H / PHOTO_H);
  return { type: 'image', version: '5.3.0', originX: 'center', originY: 'center', left: W / 2, top: H / 2, width: PHOTO_W, height: PHOTO_H, scaleX: k, scaleY: k, src,
    crossOrigin: null, name: 'Background photo', pfRole: 'bg', selectable: false, evented: true, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true, locked: true, hasControls: false };
}
const grain = (W, H, op = 0.32) => ({ type: 'rect', version: '5.3.0', left: 0, top: 0, width: W, height: H, fill: { type: 'pattern', source: 'templates/grain.webp', repeat: 'repeat' },
  opacity: op, globalCompositeOperation: 'overlay', name: 'Film grain', selectable: false, evented: false, locked: true, hasControls: false, strokeWidth: 0 });
const shade = (W, H, from = 0.45, a = 0.85) => ({ type: 'rect', version: '5.3.0', left: 0, top: 0, width: W, height: H, strokeWidth: 0, name: 'Shade', selectable: false, evented: false, locked: true,
  fill: { type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: H * from, x2: 0, y2: H }, colorStops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 1, color: `rgba(0,0,0,${a})` }] } });
const arrow = (x, y, s = 1, color = '#ffffff') => ({ type: 'path', version: '5.3.0', originX: 'center', originY: 'center', left: x, top: y, scaleX: s, scaleY: s, name: 'Arrow',
  path: [['M', 0, 12], ['L', 64, 12], ['M', 50, 0], ['L', 64, 12], ['L', 50, 24]], fill: '', stroke: color, strokeWidth: 3, strokeLineCap: 'round', strokeLineJoin: 'round' });
const counter = (W, H, n, total, color = '#f4efe6') => txt(`${n}/${total}`, { left: W - 70, top: 70, fontFamily: 'Cormorant Garamond', fontSize: 30, fill: color, pfRole: 'counter', pfCounterFmt: '{n}/{total}', name: 'Page counter', charSpacing: 60 });
const page = (W, H, bg, objects) => ({ version: '5.3.0', objects, background: bg });

// ---- Style A: photo hero + big serif hook in open sky/sea + small arrow ----
function hook({ W, H, src, lines, ml, color = '#ffffff', y = 0.3, font }) {
  const fs = Math.round(W * (ml ? 0.105 : 0.125));
  return [page(W, H, '#0b1f3a', [photo(src, W, H),
    txt(lines, { left: W / 2, top: H * y, fontFamily: font || (ml ? 'Noto Serif Malayalam' : 'DM Serif Display'), fontWeight: ml ? 700 : 400, fontSize: fs, lineHeight: ml ? 1.18 : 0.98, fill: color, charSpacing: ml ? 0 : -15,
      shadow: { color: 'rgba(0,0,0,0.28)', blur: 30, offsetX: 0, offsetY: 3 } }),
    arrow(W / 2, H * y + fs * (lines.split('\n').length * 0.62) + 70, 1.1, color)])];
}
// ---- Style B: film grain, small serif quote, n/N carousel counter ----
function film({ W, H, src, quotes, ml }) {
  return quotes.map((q, i) => page(W, H, '#221a24', [photo(src, W, H),
    txt(q, { left: W / 2, top: H * 0.24, fontFamily: ml ? 'Manjari' : 'Cormorant Garamond', fontWeight: 400, fontStyle: ml ? 'normal' : 'italic', fontSize: Math.round(W * (ml ? 0.045 : 0.052)), lineHeight: 1.35, fill: '#f4efe6', charSpacing: ml ? 0 : 15,
      shadow: { color: 'rgba(0,0,0,0.35)', blur: 14, offsetX: 0, offsetY: 1 } }),
    counter(W, H, i + 1, quotes.length), grain(W, H)]));
}
// ---- Style C: bold condensed yellow cinematic caption ----
function cine({ W, H, src, line, sub, ml }) {
  return [page(W, H, '#05060a', [photo(src, W, H), shade(W, H, 0.4, 0.9),
    txt(line, { left: W / 2, top: H * 0.8, fontFamily: ml ? 'Anek Malayalam' : 'Bebas Neue', fontWeight: ml ? 900 : 400, fontSize: Math.round(W * (ml ? 0.075 : 0.105)), fill: '#ffd400', lineHeight: ml ? 1.15 : 0.95, charSpacing: ml ? 0 : 30,
      shadow: { color: 'rgba(0,0,0,0.85)', blur: 16, offsetX: 0, offsetY: 4 } }),
    ...(sub ? [txt(sub, { left: W / 2, top: H * 0.8 + W * 0.13, fontFamily: 'Oswald', fontWeight: 300, fontSize: Math.round(W * 0.03), fill: '#f8f8f8', charSpacing: 200 })] : []),
    grain(W, H, 0.18)])];
}

const T = [];
const add = (id, name, cat, size, lang, build) => T.push({ id, name, cat, size, lang, build: () => { const [W, H] = SIZES[size]; return { w: W, h: H, pages: build(W, H) }; } });
// Style A (8)
add('hook-sea-post', 'If you love… (sea)', 'Hook quotes', 'post', 'en', (W, H) => hook({ W, H, src: PH.sea, lines: 'If you love\nthe ocean,\nread this', y: 0.26 }));
add('hook-sky-story', 'Open sky hook', 'Hook quotes', 'story', 'en', (W, H) => hook({ W, H, src: PH.sky, lines: 'Some days\nare made\nfor slowing\ndown', y: 0.24, color: '#ffffff' }));
add('hook-mist-square', 'Quiet mountains', 'Hook quotes', 'square', 'en', (W, H) => hook({ W, H, src: PH.mist, lines: 'Go where\nit feels\nlike peace', y: 0.3, color: '#1c2530' }));
add('hook-sea-story', 'Read this slowly', 'Hook quotes', 'story', 'en', (W, H) => hook({ W, H, src: PH.sea, lines: 'Read this\nslowly', y: 0.22 }));
add('hook-ml-sea-post', 'കടൽ പോലെ (sea)', 'Malayalam', 'post', 'ml', (W, H) => hook({ W, H, src: PH.sea, lines: 'കടൽ പോലെ\nശാന്തമാകൂ', y: 0.26, ml: true }));
add('hook-ml-sky-story', 'ആകാശം (sky)', 'Malayalam', 'story', 'ml', (W, H) => hook({ W, H, src: PH.sky, lines: 'സ്വപ്നങ്ങൾക്ക്\nആകാശത്തോളം\nഉയരം', y: 0.24, ml: true }));
add('hook-ml-mist-square', 'മലനിരകൾ', 'Malayalam', 'square', 'ml', (W, H) => hook({ W, H, src: PH.mist, lines: 'നിശ്ശബ്ദതയിൽ\nസമാധാനം', y: 0.3, ml: true, color: '#1c2530' }));
add('hook-sky-post', 'Before you scroll', 'Hook quotes', 'post', 'en', (W, H) => hook({ W, H, src: PH.sky, lines: 'Before you\nscroll past', y: 0.24, font: 'Playfair Display' }));
// Style B (9)
const enQ = ['“The quiet moments\nare where\nwe grow.”', '“You are allowed\nto start again.”', '“Not everything\nneeds an answer.”', '“Let the light\nfind you.”', '“Slow is\nstill moving.”',
  '“Rest is part\nof the work.”', '“Keep the small\npromises.”', '“Bloom where\nyou are.”', '“Some things\ntake time.”', '“Begin again,\ngently.”'];
const mlQ = ['“ഓരോ പ്രഭാതവും\nഒരു പുതിയ തുടക്കം”', '“സ്നേഹം\nഎല്ലാം മാറ്റും”', '“പതുക്കെ നടന്നാലും\nമുന്നോട്ട് തന്നെ”', '“നിന്റെ വെളിച്ചം\nനീ തന്നെ”', '“കാത്തിരിപ്പും\nഒരു യാത്രയാണ്”'];
add('film-dusk-10', 'Film quotes 1/10', 'Film quotes', 'post', 'en', (W, H) => film({ W, H, src: PH.dusk, quotes: enQ }));
add('film-night-5', 'Night film quotes', 'Film quotes', 'post', 'en', (W, H) => film({ W, H, src: PH.night, quotes: enQ.slice(0, 5) }));
add('film-mist-story', 'Mist film story', 'Film quotes', 'story', 'en', (W, H) => film({ W, H, src: PH.mist, quotes: enQ.slice(5, 8) }));
add('film-sky-square', 'Soft sky quote', 'Film quotes', 'square', 'en', (W, H) => film({ W, H, src: PH.sky, quotes: enQ.slice(2, 5) }));
add('film-palm-post', 'Backwater quotes', 'Film quotes', 'post', 'en', (W, H) => film({ W, H, src: PH.palm, quotes: enQ.slice(4, 9) }));
add('film-ml-dusk-5', 'സിനിമ ഉദ്ധരണികൾ 1/5', 'Malayalam', 'post', 'ml', (W, H) => film({ W, H, src: PH.dusk, quotes: mlQ, ml: true }));
add('film-ml-night-story', 'രാത്രി ഉദ്ധരണി', 'Malayalam', 'story', 'ml', (W, H) => film({ W, H, src: PH.night, quotes: mlQ.slice(0, 3), ml: true }));
add('film-ml-mist-square', 'മഞ്ഞ് ഉദ്ധരണി', 'Malayalam', 'square', 'ml', (W, H) => film({ W, H, src: PH.mist, quotes: mlQ.slice(2, 5), ml: true }));
add('film-dusk-story', 'Golden hour story', 'Film quotes', 'story', 'en', (W, H) => film({ W, H, src: PH.dusk, quotes: enQ.slice(0, 3) }));
// Style C (9)
add('cine-night-post', 'Cinematic caption', 'Cinematic', 'post', 'en', (W, H) => cine({ W, H, src: PH.night, line: 'I KEPT WALKING\nEVEN WHEN IT HURT', sub: 'SCENE 01' }));
add('cine-dusk-story', 'Cinematic story', 'Cinematic', 'story', 'en', (W, H) => cine({ W, H, src: PH.dusk, line: 'THIS IS WHERE\nIT STARTS', sub: 'A FILM BY YOU' }));
add('cine-palm-square', 'Backwater caption', 'Cinematic', 'square', 'en', (W, H) => cine({ W, H, src: PH.palm, line: 'HOME IS A FEELING', sub: '' }));
add('cine-mist-post', 'Mountain subtitle', 'Cinematic', 'post', 'en', (W, H) => cine({ W, H, src: PH.mist, line: 'WE WERE NEVER LOST', sub: 'CHAPTER TWO' }));
add('cine-sea-story', 'Ocean subtitle', 'Cinematic', 'story', 'en', (W, H) => cine({ W, H, src: PH.sea, line: 'THE TIDE ALWAYS\nCOMES BACK', sub: '' }));
add('cine-ml-night-post', 'സിനിമാറ്റിക് (രാത്രി)', 'Malayalam', 'post', 'ml', (W, H) => cine({ W, H, src: PH.night, line: 'ഞാൻ നടന്നു,\nവേദനിച്ചിട്ടും', sub: '' , ml: true }));
add('cine-ml-palm-story', 'കായൽ സന്ധ്യ', 'Malayalam', 'story', 'ml', (W, H) => cine({ W, H, src: PH.palm, line: 'വീട് ഒരു\nഅനുഭൂതിയാണ്', sub: '', ml: true }));
add('cine-ml-dusk-square', 'ഇവിടെ തുടങ്ങുന്നു', 'Malayalam', 'square', 'ml', (W, H) => cine({ W, H, src: PH.dusk, line: 'ഇവിടെ നിന്ന്\nതുടങ്ങുന്നു', sub: '', ml: true }));
add('cine-night-square', 'Night caption', 'Cinematic', 'square', 'en', (W, H) => cine({ W, H, src: PH.night, line: 'NOT EVERY NIGHT\nIS DARK', sub: 'PART III' }));

export const TEMPLATES = T;
export const TEMPLATE_CATS = ['All', 'Hook quotes', 'Film quotes', 'Cinematic', 'Malayalam'];
export const SIZE_LABEL = { post: 'Post 4:5', story: 'Story 9:16', square: 'Square 1:1' };
