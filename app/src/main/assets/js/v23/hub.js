import { el, sheet } from '../ui.js';
import { haptic } from '../native.js';
export function parseColor(colorStr) {
  if (!colorStr) return [0, 0, 0, 0];
  if (colorStr.startsWith('#')) {
    let hex = colorStr.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    if (hex.length === 6 || hex.length === 8) {
      const num = parseInt(hex, 16);
      if (hex.length === 6) {
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 255];
      } else {
        return [(num >> 24) & 255, (num >> 16) & 255, (num >> 8) & 255, num & 255];
      }
    }
  }
  const rgbMatch = colorStr.match(/rgba?\(?\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)(?:,\s*([0-9.]+))?\s*\)?/i);
  if (rgbMatch) {
    return [
      parseFloat(rgbMatch[1]),
      parseFloat(rgbMatch[2]),
      parseFloat(rgbMatch[3]),
      rgbMatch[4] !== undefined ? Math.round(parseFloat(rgbMatch[4]) * 255) : 255
    ];
  }
  return [0, 0, 0, 255];
}

export function relativeLuminance(r, g, b) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

export function contrastRatio(colorA, colorB) {
  const [r1, g1, b1] = parseColor(colorA);
  const [r2, g2, b2] = parseColor(colorB);
  const lum1 = relativeLuminance(r1, g1, b1);
  const lum2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

let toolsList = [];

export function registerTool({ id, label, group, keywords, icon, run, when }) {
  if (!toolsList.some(t => t.id === id)) {
    toolsList.push({ id, label, group, keywords: keywords || [], icon: icon || '🛠️', run, when });
  }
}

export function listTools() {
  return toolsList;
}

function getRecentToolIds() {
  try {
    const raw = localStorage.getItem('pf.recentTools');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function addRecentToolId(id) {
  try {
    let recent = getRecentToolIds();
    recent = [id, ...recent.filter(i => i !== id)].slice(0, 6);
    localStorage.setItem('pf.recentTools', JSON.stringify(recent));
  } catch (e) {}
}

export function openToolLibrary() {
  try {
    const groups = ['All', ...Array.from(new Set(toolsList.map(t => t.group || 'General')))];
    let activeGroup = 'All';
    let currentQuery = '';

    const body = el('div', { class: 'v23-hub-wrap' },
      el('input', {
        id: 'hubSearch',
        type: 'search', class: 'v23-hub-search',
        placeholder: 'Search tools…',
        oninput: (e) => {
          currentQuery = e.target.value.toLowerCase().trim();
          renderGrid();
        }
      }),
      el('div', { id: 'hubGroups', class: 'v23-hub-groups' },
        ...groups.map(g => el('button', {
          class: `chip small ${g === activeGroup ? 'on' : ''}`, 'data-group': g,
          text: g,
          onclick: () => {
            activeGroup = g;
            body.querySelectorAll('#hubGroups .chip').forEach(c => c.classList.toggle('on', c.textContent === g));
            renderGrid();
          }
        }))
      ),
      el('div', { id: 'hubGrid', class: 'v23-hub-grid' })
    );

    const gridEl = body.querySelector('#hubGrid');

    function renderGrid() {
      gridEl.replaceChildren();
      const queryWords = currentQuery ? currentQuery.split(/\s+/) : [];
      
      const filtered = toolsList.filter(t => {
        if (activeGroup !== 'All' && (t.group || 'General') !== activeGroup) return false;
        if (queryWords.length > 0) {
          const searchableText = [t.label, t.group || '', ...(t.keywords || [])].join(' ').toLowerCase();
          return queryWords.every(w => searchableText.includes(w));
        }
        return true;
      });

      if (filtered.length === 0) {
        gridEl.appendChild(el('div', { class: 'v23-empty', text: `No tool matches “${currentQuery || activeGroup}”` }));
        return;
      }

      if (!currentQuery && activeGroup === 'All') {
        const recentIds = getRecentToolIds();
        const recentTools = recentIds.map(id => toolsList.find(t => t.id === id)).filter(Boolean);
        if (recentTools.length > 0) {
          gridEl.appendChild(el('div', { class: 'v23-hub-h', text: 'Recent' }));
          recentTools.forEach(t => {
            gridEl.appendChild(createTile(t));
          });
          gridEl.appendChild(el('div', { class: 'v23-hub-h', text: 'All Tools' }));
        }
      }

      filtered.forEach(t => {
        gridEl.appendChild(createTile(t));
      });
    }

    function createTile(t) {
      const isEnabled = typeof t.when !== 'function' || t.when();
      return el('button', {
        class: `v23-hub-tile ${!isEnabled ? 'v23-disabled' : ''}`,
        'data-tool': t.id,
        onclick: () => {
          if (!isEnabled) return;
          haptic('tick');
          addRecentToolId(t.id);
          closeFn();
          try {
            t.run();
          } catch (err) {
            console.error(err);
          }
        }
      },
        el('span', { class: 'v23-hub-icon', text: t.icon }),
        el('span', { class: 'v23-hub-label', text: t.label })
      );
    }

    let closeFn = () => {};
    sheet({
      title: 'Tools',
      body,
      actions: [{ label: 'Close', value: 'close', kind: 'btn-ghost' }],
      onOpen: (box, close) => {
        closeFn = close;
        renderGrid();

      }
    });
  } catch (e) {
    console.error(e);
  }
}

export function runChecklist() {
  const results = [];
  const pf = window.PF;
  if (!pf || !pf.canvas) return results;

  const W = pf.state ? pf.state.W : 1080;
  const H = pf.state ? pf.state.H : 1080;

  // 1. Size
  if (W >= 1080 && H >= 1080) {
    results.push({ id: 'size', label: 'Canvas size', ok: true, level: 'ok', detail: `${W} × ${H} px` });
  } else {
    results.push({ id: 'size', label: 'Canvas size', ok: false, level: 'warn', detail: `${W} × ${H} px (recommended >= 1080px)` });
  }

  const objects = pf.canvas.getObjects() || [];

  // 4. Empty
  if (objects.length === 0) {
    results.push({ id: 'empty', label: 'Has content', ok: false, level: 'fail', detail: 'Canvas is empty' });
  } else {
    results.push({ id: 'empty', label: 'Has content', ok: true, level: 'ok', detail: `${objects.length} object(s)` });
  }

  // Safe zone calculation
  const isStory = (H / W) > 1.7;
  const marginX = W * 0.05;
  const safeTop = isStory ? H * 0.14 : H * 0.05;
  const safeBottom = isStory ? H * 0.80 : H * 0.95;
  const safeLeft = marginX;
  const safeRight = W - marginX;

  let safeOffendingCount = 0;
  let hiddenTextCount = 0;
  let worstContrast = 21;
  let worstContrastDetail = '';

  const visibleObjects = objects.filter(o => o.visible !== false && !o.locked);
  const textObjects = objects.filter(o => o.visible !== false && pf.isText && pf.isText(o));

  // Safe zone & hidden text check
  textObjects.forEach(o => {
    try {
      const rect = o.getBoundingRect(true, true);
      const fullyOutside = rect.left + rect.width <= 0 || rect.top + rect.height <= 0 || rect.left >= W || rect.top >= H;
      if (fullyOutside) {
        hiddenTextCount++;
      } else {
        const inSafe = rect.left >= safeLeft && (rect.left + rect.width) <= safeRight &&
                       rect.top >= safeTop && (rect.top + rect.height) <= safeBottom;
        if (!inSafe) {
          safeOffendingCount++;
        }
      }
    } catch (e) {}
  });

  if (safeOffendingCount === 0) {
    results.push({ id: 'safe', label: 'Safe zones', ok: true, level: 'ok', detail: 'All text inside safe margins' });
  } else {
    results.push({ id: 'safe', label: 'Safe zones', ok: false, level: 'fail', detail: `${safeOffendingCount} text object(s) outside safe zone` });
  }

  if (hiddenTextCount === 0) {
    results.push({ id: 'hidden-text', label: 'Text on the page', ok: true, level: 'ok', detail: 'No text outside artboard' });
  } else {
    results.push({ id: 'hidden-text', label: 'Text on the page', ok: false, level: 'warn', detail: `${hiddenTextCount} text object(s) completely outside artboard` });
  }

  // 3. Contrast check via sampling
  if (textObjects.length > 0 && pf.canvas.lowerCanvasEl) {
    try {
      const origVisibilities = textObjects.map(o => {
        const v = o.visible;
        o.set('visible', false);
        return v;
      });
      pf.canvas.renderAll();

      const canvasEl = pf.canvas.lowerCanvasEl;
      const ctx = canvasEl.getContext('2d');
      const vpt = pf.canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const retina = typeof pf.canvas.getRetinaScaling === 'function' ? pf.canvas.getRetinaScaling() : 1;

      textObjects.forEach((o, idx) => {
        try {
          const centerCanvas = o.getCenterPoint();
          const point = fabric.util.transformPoint(centerCanvas, vpt);
          const screenX = Math.round(point.x * retina);
          const screenY = Math.round(point.y * retina);

          if (screenX >= 0 && screenX < canvasEl.width && screenY >= 0 && screenY < canvasEl.height) {
            const pixel = ctx.getImageData(screenX, screenY, 1, 1).data;
            const bgColor = `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]/255})`;
            const textColor = typeof o.fill === 'string' ? o.fill : '#000000';
            const ratio = contrastRatio(textColor, bgColor);
            if (ratio < worstContrast) {
              worstContrast = ratio;
              worstContrastDetail = `${ratio.toFixed(1)}:1`;
            }
          }
        } catch (e) {}
      });

      textObjects.forEach((o, idx) => {
        o.set('visible', origVisibilities[idx]);
      });
      pf.canvas.renderAll();
    } catch (e) {}
  }

  if (worstContrast >= 3) {
    results.push({ id: 'contrast', label: 'Text contrast', ok: true, level: 'ok', detail: worstContrast < 21 ? `Lowest ratio ${worstContrastDetail}` : 'Adequate contrast' });
  } else {
    results.push({ id: 'contrast', label: 'Text contrast', ok: false, level: 'warn', detail: `Low contrast detected (${worstContrastDetail})` });
  }

  // 5. Lowres image check
  let lowResCount = 0;
  visibleObjects.forEach(o => {
    if (o.type === 'image') {
      try {
        const elElem = o._element;
        const naturalW = elElem && elElem.naturalWidth ? elElem.naturalWidth : o.width;
        const scaledW = o.getScaledWidth();
        if (scaledW > 0) {
          const ratio = (naturalW / scaledW) * (1080 / W);
          if (ratio < 0.75) {
            lowResCount++;
          }
        }
      } catch (e) {}
    }
  });

  if (lowResCount === 0) {
    results.push({ id: 'lowres', label: 'Photo sharpness', ok: true, level: 'ok', detail: 'No low-res images' });
  } else {
    results.push({ id: 'lowres', label: 'Photo sharpness', ok: false, level: 'warn', detail: `${lowResCount} image(s) may appear pixelated/upscaled` });
  }

  return results;
}

export function openChecklist() {
  try {
    const results = runChecklist();
    const fails = results.filter(r => !r.ok).length;

    const summaryText = fails === 0 ? 'All checks passed. Ready to publish!' : `${fails} issue(s) need your attention before publishing.`;

    const body = el('div', { class: 'v23-checklist-wrap' },
      el('p', { class: 'note', id: 'ckSummary', text: summaryText }),
      el('div', { class: 'v23-check-list' },
        ...results.map(r => {
          let iconChar = '✓';
          if (r.level === 'warn') iconChar = '!';
          if (r.level === 'fail') iconChar = '✕';
          return el('div', { class: 'v23-check', 'data-level': r.level },
            el('span', { class: 'ic', text: iconChar }),
            el('div', { class: 'v23-check-content' },
              el('b', { text: r.label }),
              el('small', { text: r.detail })
            )
          );
        })
      )
    );

    sheet({
      title: 'Ready to publish?',
      body,
      actions: [
        ...(results.some(r => r.id === 'safe' && !r.ok) ? [{ label: 'Fix safe zones', value: 'fix', kind: 'btn-accent' }] : []),
        { label: 'Close', value: 'close', kind: 'btn-ghost' }
      ],
      onOpen: (box, close) => {
        const fixBtn = box.querySelector('button[data-value="fix"]');
        if (fixBtn) {
          fixBtn.id = 'ckFixSafe';
          fixBtn.onclick = () => {
            const pf = window.PF;
            if (pf && pf.canvas && pf.history) {
              const W = pf.state ? pf.state.W : 1080;
              const H = pf.state ? pf.state.H : 1080;
              const isStory = (H / W) > 1.7;
              const marginX = W * 0.05;
              const safeTop = isStory ? H * 0.14 : H * 0.05;
              const safeBottom = isStory ? H * 0.80 : H * 0.95;
              const safeLeft = marginX;
              const safeRight = W - marginX;

              let changed = false;
              pf.canvas.getObjects().forEach(o => {
                if (o.visible !== false && !o.locked && pf.isText && pf.isText(o)) {
                  try {
                    const rect = o.getBoundingRect(true, true);
                    let dx = 0;
                    let dy = 0;
                    if (rect.left < safeLeft) dx = safeLeft - rect.left;
                    else if (rect.left + rect.width > safeRight) dx = safeRight - (rect.left + rect.width);
                    if (rect.top < safeTop) dy = safeTop - rect.top;
                    else if (rect.top + rect.height > safeBottom) dy = safeBottom - (rect.top + rect.height);

                    if (dx !== 0 || dy !== 0) {
                      o.set('left', (o.left || 0) + dx);
                      o.set('top', (o.top || 0) + dy);
                      o.setCoords();
                      changed = true;
                    }
                  } catch (e) {}
                }
              });

              if (changed) {
                pf.history.record();
                pf.canvas.requestRenderAll();
                haptic('success');
                close();
                openChecklist();
              }
            }
          };
        }
      }
    });
  } catch (e) {
    console.error(e);
  }
}
