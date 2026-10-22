import { el } from '../ui.js';
import { haptic } from '../native.js';

let activeMode = null; // 'brush', 'eraser', 'pen', or null
let drawBarEl = null;

function removeDrawBar() {
  if (drawBarEl && drawBarEl.parentNode) {
    drawBarEl.parentNode.removeChild(drawBarEl);
  }
  drawBarEl = null;
}

export function isDrawing() {
  return activeMode !== null;
}

export function stopDrawing() {
  try {
    const canvas = window.PF && window.PF.canvas;
    if (canvas) {
      canvas.isDrawingMode = false;
      canvas.selection = true; canvas.skipTargetFind = false; document.body.classList.remove('v23-drawing');
      if (brushListeners) {
        canvas.off('path:created', brushListeners.pathCreated);
        brushListeners = null;
      }
      if (eraserListeners) {
        canvas.off('mouse:down', eraserListeners.mouseDown);
        canvas.off('mouse:move', eraserListeners.mouseMove);
        canvas.off('mouse:up', eraserListeners.mouseUp);
        eraserListeners = null;
      }
      if (penListeners) {
        canvas.off('mouse:down', penListeners.mouseDown);
        canvas.off('mouse:move', penListeners.mouseMove);
        canvas.off('mouse:up', penListeners.mouseUp);
        penListeners = null;
      }
      removePenPreview();
    }
  } catch (e) {}
  activeMode = null;
  removeDrawBar();
}

let brushListeners = null;

export function startBrush({ color = '#000000', width = 5 } = {}) {
  stopDrawing();
  activeMode = 'brush';
  const canvas = window.PF && window.PF.canvas;
  if (!canvas) return;

  canvas.isDrawingMode = true;
  canvas.selection = false; canvas.discardActiveObject(); document.body.classList.add('v23-drawing');
  if (canvas.freeDrawingBrush) {
    canvas.freeDrawingBrush.color = color;
    canvas.freeDrawingBrush.width = width;
    canvas.freeDrawingBrush.decimate = 2;
  } else if (window.fabric && window.fabric.PencilBrush) {
    const b = new window.fabric.PencilBrush(canvas);
    b.color = color;
    b.width = width;
    b.decimate = 2;
    canvas.freeDrawingBrush = b;
  }

  const pathCreated = (e) => {
    try {
      if (e.path) {
        e.path.pfRole = 'brush';
        e.path.name = 'Brush stroke';
        if (window.PF && window.PF.history) {
          window.PF.history.record();
        }
        if (canvas) canvas.requestRenderAll();
      }
    } catch (err) {}
  };
  canvas.on('path:created', pathCreated);
  brushListeners = { pathCreated };

  renderBrushBar(color, width);
}

function renderBrushBar(initialColor, initialWidth) {
  removeDrawBar();
  drawBarEl = el('div', { class: 'v23-drawbar', id: 'v23DrawBar' },
    el('input', { type: 'color', id: 'drawColor', value: initialColor }),
    el('input', { type: 'range', id: 'drawWidth', min: '2', max: '80', value: initialWidth }),
    el('button', { id: 'drawModeBrush', class: 'v23-btn', text: 'Brush', onclick: () => {
      haptic('select');
      const col = document.getElementById('drawColor')?.value || '#000000';
      const wid = parseInt(document.getElementById('drawWidth')?.value || '5', 10);
      startBrush({ color: col, width: wid });
    }}),
    el('button', { id: 'drawModeEraser', class: 'v23-btn', text: 'Eraser', onclick: () => {
      haptic('select');
      startEraser();
    }}),
    el('button', { id: 'drawDone', class: 'primary', text: 'Done', onclick: () => {
      haptic('success');
      stopDrawing();
      if (window.PF && window.PF.canvas) window.PF.canvas.requestRenderAll();
    }})
  );

  const colorInput = drawBarEl.querySelector('#drawColor');
  if (colorInput) {
    colorInput.onchange = (e) => {
      const canvas = window.PF && window.PF.canvas;
      if (canvas && canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.color = e.target.value;
      }
    };
  }

  const widthInput = drawBarEl.querySelector('#drawWidth');
  if (widthInput) {
    widthInput.oninput = (e) => {
      const canvas = window.PF && window.PF.canvas;
      if (canvas && canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.width = parseInt(e.target.value, 10);
      }
    };
  }

  document.body.appendChild(drawBarEl);
}

let eraserListeners = null;

export function startEraser() {
  stopDrawing();
  activeMode = 'eraser';
  const canvas = window.PF && window.PF.canvas;
  if (!canvas) return;

  canvas.isDrawingMode = false;
  canvas.selection = false; canvas.skipTargetFind = true; canvas.discardActiveObject(); document.body.classList.add('v23-drawing');

  let isPointerDown = false;
  let erasedAny = false;

  const processErase = (opt) => {
    if (!isPointerDown) return;
    try {
      const pointer = canvas.getPointer(opt.e);
      const objects = canvas.getObjects();
      const toRemove = [];

      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (obj.locked) continue;
        if (obj.pfRole === 'brush') {
          try {
            const rect = obj.getBoundingRect(true);
            if (
              pointer.x >= rect.left &&
              pointer.x <= rect.left + rect.width &&
              pointer.y >= rect.top &&
              pointer.y <= rect.top + rect.height
            ) {
              if (typeof obj.containsPoint === 'function' && obj.containsPoint(pointer)) {
                toRemove.push(obj);
              } else {
                // fallback approximation
                toRemove.push(obj);
              }
            }
          } catch (ex) {}
        }
      }

      if (toRemove.length > 0) {
        erasedAny = true;
        toRemove.forEach((o) => canvas.remove(o));
        canvas.requestRenderAll();
      }
    } catch (e) {}
  };

  const mouseDown = (opt) => {
    isPointerDown = true;
    erasedAny = false;
    processErase(opt);
  };

  const mouseMove = (opt) => {
    processErase(opt);
  };

  const mouseUp = () => {
    if (isPointerDown && erasedAny) {
      try {
        if (window.PF && window.PF.history) {
          window.PF.history.batch(async () => {
            // already removed
          });
          window.PF.history.record();
        }
      } catch (e) {}
    }
    isPointerDown = false;
    erasedAny = false;
  };

  canvas.on('mouse:down', mouseDown);
  canvas.on('mouse:move', mouseMove);
  canvas.on('mouse:up', mouseUp);

  eraserListeners = { mouseDown, mouseMove, mouseUp };

  renderEraserBar();
}

function renderEraserBar() {
  removeDrawBar();
  drawBarEl = el('div', { class: 'v23-drawbar', id: 'v23DrawBar' },
    el('button', { id: 'drawModeBrush', class: 'v23-btn', text: 'Brush', onclick: () => {
      haptic('select');
      startBrush({ color: '#000000', width: 5 });
    }}),
    el('button', { id: 'drawModeEraser', class: 'v23-btn', text: 'Eraser', onclick: () => {
      haptic('select');
      startEraser();
    }}),
    el('button', { id: 'drawDone', class: 'primary', text: 'Done', onclick: () => {
      haptic('success');
      stopDrawing();
      if (window.PF && window.PF.canvas) window.PF.canvas.requestRenderAll();
    }})
  );
  document.body.appendChild(drawBarEl);
}

let penPoints = []; // array of {x, y, cpX, cpY, type}
let penListeners = null;
let penPreviewObj = null;
let penCurrentColor = '#000000';
let penCurrentFill = 'transparent';

function removePenPreview() {
  try {
    const canvas = window.PF && window.PF.canvas;
    if (canvas && penPreviewObj) {
      const H = window.PF.history; H.muted++; try { canvas.remove(penPreviewObj); } finally { H.muted--; }
    }
  } catch (e) {}
  penPreviewObj = null;
}

function updatePenPreview() {
  const canvas = window.PF && window.PF.canvas;
  if (!canvas) return;

  removePenPreview();
  if (penPoints.length === 0) return;

  let pathData = '';
  for (let i = 0; i < penPoints.length; i++) {
    const pt = penPoints[i];
    if (i === 0) {
      pathData += `M ${pt.x} ${pt.y}`;
    } else {
      if (pt.cpX !== undefined && pt.cpY !== undefined) {
        pathData += ` Q ${pt.cpX} ${pt.cpY}, ${pt.x} ${pt.y}`;
      } else {
        pathData += ` L ${pt.x} ${pt.y}`;
      }
    }
  }

  try {
    if (window.fabric && window.fabric.Path) {
      penPreviewObj = new window.fabric.Path(pathData, {
        fill: penCurrentFill !== 'transparent' ? penCurrentFill : 'transparent',
        stroke: penCurrentColor,
        strokeWidth: 4,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        pfRole: 'penPreview'
      });
      const H = window.PF.history; H.muted++; try { canvas.add(penPreviewObj); } finally { H.muted--; }
      canvas.requestRenderAll();
    }
  } catch (e) {}
}

export function penAddPoint(x, y, cpX, cpY) {
  try {
    const isFirst = penPoints.length === 0;
    const pt = { x, y };
    if (cpX !== undefined && cpY !== undefined) {
      pt.cpX = cpX;
      pt.cpY = cpY;
    }
    penPoints.push(pt);
    haptic('tick');
    updatePenPreview();
  } catch (e) {}
}

export function penFinish(close = false) {
  try {
    const canvas = window.PF && window.PF.canvas;
    if (!canvas) return;

    removePenPreview();

    if (penPoints.length < 2) {
      penPoints = [];
      updatePenPreview();
      return;
    }

    let pathData = '';
    for (let i = 0; i < penPoints.length; i++) {
      const pt = penPoints[i];
      if (i === 0) {
        pathData += `M ${pt.x} ${pt.y}`;
      } else {
        if (pt.cpX !== undefined && pt.cpY !== undefined) {
          pathData += ` Q ${pt.cpX} ${pt.cpY}, ${pt.x} ${pt.y}`;
        } else {
          pathData += ` L ${pt.x} ${pt.y}`;
        }
      }
    }

    if (close) {
      pathData += ' Z';
    }

    if (window.fabric && window.fabric.Path) {
      const shape = new window.fabric.Path(pathData, {
        fill: close ? penCurrentFill : 'transparent',
        stroke: penCurrentColor,
        strokeWidth: 4,
        pfRole: 'pen',
        name: 'Pen shape'
      });
      canvas.add(shape);
      if (window.PF && window.PF.history) {
        window.PF.history.record();
      }
      canvas.setActiveObject(shape);
      canvas.requestRenderAll();
    }
  } catch (e) {}

  penPoints = [];
  stopDrawing();
}

export function startPen({ color = '#000000', fill = 'transparent' } = {}) {
  stopDrawing();
  activeMode = 'pen';
  penCurrentColor = color;
  penCurrentFill = fill;
  penPoints = [];

  const canvas = window.PF && window.PF.canvas;
  if (!canvas) return;

  canvas.isDrawingMode = false;
  canvas.selection = false; canvas.skipTargetFind = true; canvas.discardActiveObject(); document.body.classList.add('v23-drawing');

  let downPointer = null;

  const mouseDown = (opt) => {
    try {
      const pointer = canvas.getPointer(opt.e);
      downPointer = pointer;
    } catch (e) {}
  };

  const mouseMove = (opt) => {
    // If needed for live drag handle preview, can be handled here or on mouse up
  };

  const mouseUp = (opt) => {
    try {
      if (!downPointer) return;
      const upPointer = canvas.getPointer(opt.e);
      const canvasZoom = canvas.getZoom() || 1;

      // Check if tapping near first vertex to close shape
      if (penPoints.length > 0) {
        const first = penPoints[0];
        const dx = (upPointer.x - first.x) * canvasZoom;
        const dy = (upPointer.y - first.y) * canvasZoom;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 18) {
          penFinish(true);
          downPointer = null;
          return;
        }
      }

      // Check drag distance for quadratic curve control point
      const ddx = upPointer.x - downPointer.x;
      const ddy = upPointer.y - downPointer.y;
      const dragDist = Math.sqrt(ddx * ddx + ddy * ddy);

      let cpX, cpY;
      if (dragDist > 8) {
        // control point = mirror of drag point relative to downPointer or similar smooth handle
        // Requirement: "store control point = mirror of drag point — implement quadratic-curve: if drag distance > 8px use 'Q' segment with control = drag point"
        cpX = downPointer.x;
        cpY = downPointer.y;
      }

      penAddPoint(upPointer.x, upPointer.y, cpX, cpY);
    } catch (e) {}
    downPointer = null;
  };

  canvas.on('mouse:down', mouseDown);
  canvas.on('mouse:move', mouseMove);
  canvas.on('mouse:up', mouseUp);

  penListeners = { mouseDown, mouseMove, mouseUp };

  renderPenBar(color, fill);
}

function renderPenBar(initialColor, initialFill) {
  removeDrawBar();
  drawBarEl = el('div', { class: 'v23-drawbar', id: 'v23DrawBar' },
    el('input', { type: 'color', id: 'drawColor', value: initialColor }),
    el('button', { id: 'penUndo', class: 'v23-btn', text: 'Undo point', onclick: () => {
      haptic('tick');
      if (penPoints.length > 0) {
        penPoints.pop();
        updatePenPreview();
      }
    }}),
    el('button', { id: 'penClose', class: 'v23-btn', text: 'Close shape', onclick: () => {
      haptic('success');
      penFinish(true);
    }}),
    el('button', { id: 'penDone', class: 'primary', text: 'Done', onclick: () => {
      haptic('success');
      penFinish(false);
    }}),
    el('button', { id: 'penCancel', class: 'v23-btn', text: 'Cancel', onclick: () => {
      haptic('select');
      penPoints = [];
      removePenPreview();
      stopDrawing();
      if (window.PF && window.PF.canvas) window.PF.canvas.requestRenderAll();
    }})
  );

  const colorInput = drawBarEl.querySelector('#drawColor');
  if (colorInput) {
    colorInput.onchange = (e) => {
      penCurrentColor = e.target.value;
      if (penPreviewObj) {
        penPreviewObj.set('stroke', penCurrentColor);
        if (window.PF && window.PF.canvas) window.PF.canvas.requestRenderAll();
      }
    };
  }

  document.body.appendChild(drawBarEl);
}
