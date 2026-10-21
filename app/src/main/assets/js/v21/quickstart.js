// 2.1 quote quick-start: type or paste a quote (and an optional author), it fills every template, swipe the previews, pick one.
/* global fabric */
import { el, sheet, toast } from '../ui.js';
import { haptic } from '../native.js';
import { TEMPLATES, SIZE_LABEL } from '../v2/templates.js';
import { openBuilt } from '../v2/home.js';
import { fontEntry, MALAYALAM_RE } from '../tools.js';

const PF = () => window.PF;
const ML_FOR = { 'DM Serif Display': 'Noto Serif Malayalam', 'Playfair Display': 'Noto Serif Malayalam', 'Cormorant Garamond': 'Manjari', 'Bebas Neue': 'Anek Malayalam', Oswald: 'Anek Malayalam' };
const EN_FOR = { 'Noto Serif Malayalam': 'DM Serif Display', Manjari: 'Cormorant Garamond', 'Anek Malayalam': 'Bebas Neue' };

/** Greedy word wrap to about `n` characters per line (keeps the user's own line breaks). */
export function wrapQuote(q, n) {
  return q.split('\n').map((para) => {
    const words = para.trim().split(/\s+/).filter(Boolean); const lines = []; let cur = '';
    for (const w of words) { if (cur && (cur + ' ' + w).length > n) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
    if (cur) lines.push(cur); return lines.join('\n');
  }).join('\n');
}
const styleOf = (t) => (t.id.startsWith('hook') ? 'hook' : t.id.startsWith('film') ? 'film' : 'cine');
const isQuoteText = (o) => (o.type === 'text' || o.type === 'textbox' || o.type === 'i-text') && o.pfRole !== 'counter';

/** Returns a built template { w, h, pages:[1 page] } with the quote put into its main text. */
export function fillTemplate(t, quote, author = '') {
  const b = t.build(); const page = JSON.parse(JSON.stringify(b.pages[0]));
  const ml = MALAYALAM_RE.test(quote); const st = styleOf(t);
  const textObjs = page.objects.filter(isQuoteText);
  const main = textObjs.sort((a, b2) => (b2.fontSize || 0) - (a.fontSize || 0))[0]; if (!main) return null;
  const clean = quote.trim().replace(/^["“”]+|["“”]+$/g, '');
  let text = st === 'film' ? `“${clean}”` : clean; if (st === 'cine' && !ml) text = text.toUpperCase();
  const per = { hook: ml ? 12 : 13, film: ml ? 18 : 20, cine: ml ? 16 : 18 }[st] * (b.w > b.h ? 1.6 : 1);
  text = wrapQuote(text, Math.round(per));
  const origLen = Math.max(8, (main.text || '').length); const k = Math.max(0.45, Math.min(1.1, Math.sqrt(origLen / Math.max(8, text.length))));
  main.text = text; main.fontSize = Math.round(main.fontSize * k); main.name = clean.slice(0, 24); main.styles = {};
  if (ml && !fontEntry(main.fontFamily)?.ml) main.fontFamily = ML_FOR[main.fontFamily] || 'Manjari';
  if (!ml && fontEntry(main.fontFamily)?.ml) main.fontFamily = EN_FOR[main.fontFamily] || 'Playfair Display';
  if (ml) { main.charSpacing = 0; main.lineHeight = Math.max(main.lineHeight || 1.1, 1.18); }
  // second text (subtitle) becomes the author, or is dropped; carousel counters go (one page)
  page.objects = page.objects.filter((o) => o.pfRole !== 'counter' && !(isQuoteText(o) && o !== main));
  // move the arrow (hook style) under the new text block
  const lines = text.split('\n').length;
  for (const o of page.objects) if (o.name === 'Arrow') o.top = main.top + main.fontSize * lines * (main.lineHeight || 1) * 0.55 + 70;
  if (author.trim()) {
    const a = author.trim(); const aml = MALAYALAM_RE.test(a);
    page.objects.push({ type: 'text', version: '5.3.0', originX: 'center', originY: 'center', left: b.w / 2, top: Math.min(b.h - 90, main.top + main.fontSize * lines * (main.lineHeight || 1) * 0.5 + (st === 'hook' ? 150 : 70)),
      text: '— ' + a, fontFamily: aml ? 'Manjari' : (st === 'cine' ? 'Oswald' : 'Cormorant Garamond'), fontWeight: 400, fontStyle: aml || st === 'cine' ? 'normal' : 'italic', fontSize: Math.round(b.w * 0.032),
      fill: typeof main.fill === 'string' ? main.fill : '#ffffff', textAlign: 'center', name: 'Author', pfRole: 'author', charSpacing: st === 'cine' ? 120 : 20, opacity: 0.9 });
  }
  return { w: b.w, h: b.h, pages: [page], name: t.name };
}

export async function renderThumb(built, maxSide = 420) {
  const k = maxSide / Math.max(built.w, built.h); const c = document.createElement('canvas');
  const sc = new fabric.StaticCanvas(c, { width: Math.round(built.w * k), height: Math.round(built.h * k), enableRetinaScaling: false, renderOnAddRemove: false });
  await PF().ensureFonts(built.pages[0]);
  await new Promise((r) => sc.loadFromJSON(built.pages[0], r)); sc.getObjects().forEach((o) => o.initDimensions && o.initDimensions());
  sc.setViewportTransform([k, 0, 0, k, 0, 0]); sc.renderAll(); const url = c.toDataURL('image/jpeg', 0.8); sc.dispose(); return url;
}

export async function quoteQuickStart(initial = '') {
  const qI = el('textarea', { id: 'qsQuote', rows: 3, placeholder: 'Type or paste your quote…' }); qI.value = initial;
  const aI = el('input', { type: 'text', id: 'qsAuthor', placeholder: 'Author (optional)' });
  const paste = el('button', { class: 'btn-tonal rip', id: 'qsPaste', text: 'Paste', onclick: async () => { try { qI.value = await navigator.clipboard.readText(); } catch (_) { toast('Long-press the box and choose Paste'); } } });
  const v = await sheet({ title: 'Quote quick-start', message: 'Your quote goes into every template. Swipe the previews and pick one.', body: el('div', { class: 'col' }, qI, el('div', { class: 'row' }, aI, paste)),
    actions: [{ label: 'Cancel', value: null, kind: 'btn-ghost' }, { label: 'Fill templates', value: () => ({ q: qI.value, a: aI.value }), kind: 'btn-accent', validate: () => { if (!qI.value.trim()) { toast('Type a quote first'); return false; } return true; } }] });
  if (!v) return null;
  return quoteGallery(v.q, v.a);
}

/** Full-screen swipe preview (scroll-snap). Resolves with the template id that was opened, or null. */
export function quoteGallery(quote, author = '') {
  const pf = PF(); const built = TEMPLATES.map((t) => ({ t, b: fillTemplate(t, quote, author) })).filter((x) => x.b);
  return new Promise((resolve) => {
    const counter = el('span', { id: 'qsCount', text: `1 / ${built.length}` });
    const track = el('div', { class: 'qs-track', id: 'qsTrack' });
    const close = (v) => { ov.remove(); resolve(v); };
    const cards = built.map(({ t, b }, i) => el('div', { class: 'qs-card', 'data-template': t.id, 'data-i': String(i) },
      el('div', { class: 'qs-img', style: `aspect-ratio:${b.w}/${b.h}` }, el('img', { alt: t.name })),
      el('div', { class: 'qs-meta' }, el('b', { text: t.name }), el('small', { text: SIZE_LABEL[t.size] })),
      el('button', { class: 'btn-accent rip qs-use', text: 'Use this', onclick: async () => { haptic('confirm'); const ok = await openBuilt(b, t.name); if (ok) close(t.id); } })));
    track.append(...cards);
    const ov = el('div', { class: 'qs-overlay', id: 'quickStart', role: 'dialog', 'aria-label': 'Quote previews' },
      el('header', { class: 'qs-top' }, el('button', { class: 'fab rip', id: 'qsClose', 'aria-label': 'Close', text: '✕', onclick: () => close(null) }), el('b', { text: 'Pick a style' }), counter), track);
    document.body.append(ov);
    const fill = async (card) => { if (card.dataset.done) return; card.dataset.done = '1'; const i = Number(card.dataset.i);
      try { card.querySelector('img').src = await renderThumb(built[i].b); card.classList.add('ready'); } catch (e) { card.classList.add('failed'); } };
    let chain = Promise.resolve();
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) chain = chain.then(() => fill(e.target)); }), { root: track, rootMargin: '0px 60% 0px 60%' }) : null;
    cards.forEach((c) => (io ? io.observe(c) : (chain = chain.then(() => fill(c)))));
    track.addEventListener('scroll', () => { const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth * 0.82)); counter.textContent = `${Math.min(built.length, i + 1)} / ${built.length}`; }, { passive: true });
    ov.pfClose = () => close(null);
    void pf;
  });
}
