// 2.2 "Send text behind subject": moves the selected text just under the lifted subject layer it overlaps.
import { toast } from '../ui.js';
import { haptic } from '../native.js';
const PF = () => window.PF;
const isSubject = (o) => o.pfRole === 'subject' || o.pfRole === 'popSubject';
const overlap = (a, b) => !(a.left + a.width < b.left || b.left + b.width < a.left || a.top + a.height < b.top || b.top + b.height < a.top);
export function sendBehindSubject(t = PF().canvas.getActiveObject()) {
  const pf = PF(); if (!t || !['text', 'i-text', 'textbox'].includes(t.type)) { toast('Select a text layer'); return false; }
  const objs = pf.canvas.getObjects(); const subs = objs.filter(isSubject);
  if (!subs.length) { toast('Lift a subject first: long-press the photo (or ✨ Lift subject)', 'error', 4000); return false; }
  const tb = t.getBoundingRect(true, true); const hit = subs.filter((s) => overlap(tb, s.getBoundingRect(true, true)));
  const sub = (hit.length ? hit : subs).sort((a, b) => objs.indexOf(b) - objs.indexOf(a))[0];
  const si = objs.indexOf(sub); const ti = objs.indexOf(t);
  pf.canvas.moveTo(t, ti < si ? si - 1 : si); t.set('pfBehind', true);
  pf.canvas.requestRenderAll(); pf.history.record(); pf.refreshLayers(); haptic('confirm'); toast('Text sent behind the subject');
  return true;
}
