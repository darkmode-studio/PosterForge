// In-app sheets, menus, toasts and busy overlay (replaces alert/prompt/confirm).
const stack = [];

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

/** Opens a bottom sheet. actions: [{label, value, kind}]. Resolves with the action value, or null when dismissed. */
export function sheet({ title, message, body, actions = [], dismissible = true, onOpen }) {
  return new Promise((resolve) => {
    const back = el('div', { class: 'sheet-backdrop' });
    const box = el('div', { class: 'sheet', role: 'dialog' });
    if (title) box.append(el('h2', { text: title }));
    if (message) box.append(el('div', { class: 'msg', text: message }));
    if (body) box.append(body);
    const close = (v) => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      back.remove();
      resolve(v);
    };
    const entry = { close: () => (dismissible ? close(null) : null) };
    if (actions.length) {
      const row = el('div', { class: 'actions' });
      for (const a of actions) {
        row.append(el('button', { class: a.kind || 'btn-secondary', text: a.label, 'data-value': String(a.value),
          onclick: async () => {
            if (a.validate && !(await a.validate())) return;
            close(typeof a.value === 'function' ? a.value() : a.value);
          } }));
      }
      box.append(row);
    }
    back.addEventListener('click', (e) => { if (e.target === back && dismissible) close(null); });
    back.append(box);
    document.body.append(back);
    stack.push(entry);
    entry.closeWith = close;
    if (onOpen) onOpen(box, close);
  });
}

export const confirmSheet = (title, message, okLabel = 'OK', danger = false) =>
  sheet({ title, message, actions: [{ label: 'Cancel', value: false, kind: 'btn-ghost' }, { label: okLabel, value: true, kind: danger ? 'btn-danger' : 'btn-accent' }] })
    .then((v) => v === true);

export function promptSheet(title, { value = '', placeholder = '', multiline = false, okLabel = 'OK', message } = {}) {
  const input = multiline ? el('textarea', { rows: 4, placeholder }) : el('input', { type: 'text', placeholder });
  input.value = value;
  return sheet({
    title, message, body: input,
    actions: [{ label: 'Cancel', value: null, kind: 'btn-ghost' }, { label: okLabel, value: () => input.value, kind: 'btn-accent' }],
    onOpen: () => setTimeout(() => { input.focus(); if (!multiline) input.select(); }, 60),
  });
}

/** List menu. items: [{label, value}] or 'hr'. */
export function menuSheet(title, items) {
  const list = el('div', { class: 'menu-list' });
  return sheet({
    title, body: list,
    onOpen: (_, close) => {
      for (const it of items) {
        if (it === 'hr') { list.append(el('hr')); continue; }
        list.append(el('button', { text: it.label, 'data-value': it.value, onclick: () => close(it.value) }));
      }
    },
  });
}

/** Closes the top sheet. Returns true if one was open (Android back button). */
export function closeTopSheet() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
export const sheetOpen = () => stack.length > 0;

export function toast(msg, kind = '', ms = 2600) {
  const host = document.getElementById('toastHost');
  const t = el('div', { class: 'toast ' + kind, text: msg, role: 'status' });
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

let busyEl = null;
export function busy(msg) {
  if (!msg) { busyEl?.remove(); busyEl = null; return; }
  if (!busyEl) { busyEl = el('div', { class: 'busy' }, el('div', {}, el('span', { class: 'spinner' }), el('span', { class: 'busy-msg' }))); document.body.append(busyEl); }
  busyEl.querySelector('.busy-msg').textContent = msg;
}

/** Toast with an action button (e.g. Undo). */
export function actionToast(msg, label, fn, ms = 5000) {
  const host = document.getElementById('toastHost');
  const b = el('button', { text: label });
  const t = el('div', { class: 'toast', role: 'status' }, el('span', { text: msg }), b);
  b.onclick = () => { t.remove(); fn(); };
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

// Material-style ripple on .rip elements
document.addEventListener('pointerdown', (e) => {
  const host = e.target.closest && e.target.closest('.rip');
  if (!host || host.disabled) return;
  const r = host.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  host.append(s);
  setTimeout(() => s.remove(), 520);
}, { passive: true });

/**
 * Non-blocking progress pill (the canvas stays usable). Returns { set(fraction), label(text), done() }.
 * Several tasks stack. onCancel adds a cancel button.
 */
export function progressTask(label, { onCancel } = {}) {
  let host = document.getElementById('progressHost');
  if (!host) { host = el('div', { class: 'progress-host', id: 'progressHost' }); document.body.append(host); }
  const bar = el('i'); const txt = el('span', { text: label }); const pct = el('b', { text: '' });
  const item = el('div', { class: 'progress-pill', role: 'progressbar', 'aria-label': label }, el('div', { class: 'pp-row' }, txt, pct), el('div', { class: 'pp-bar' }, bar));
  if (onCancel) item.append(el('button', { class: 'pp-cancel', 'aria-label': 'Cancel', text: '×', onclick: () => { onCancel(); item.remove(); } }));
  host.append(item);
  return {
    set(f) { const v = Math.max(0, Math.min(1, f || 0)); bar.style.width = (v * 100).toFixed(1) + '%'; pct.textContent = Math.round(v * 100) + '%'; item.dataset.progress = v.toFixed(3); },
    label(t) { txt.textContent = t; },
    done() { item.remove(); },
  };
}
