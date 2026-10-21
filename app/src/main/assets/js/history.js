// Undo/redo with 30 snapshots. Restores never record (events are muted while loading), AI inserts are batched into
// one step, and rapid edits (colour drags, sliders) can be coalesced with recordSoon().
export class History {
  constructor({ serialize, restore, limit = 30, onChange = () => {} }) {
    this.serialize = serialize; this.restore = restore; this.limit = limit; this.onChange = onChange;
    this.undoStack = []; this.redoStack = []; this.muted = 0; this.batching = 0; this.timer = null;
  }
  reset() { this.undoStack = [this.serialize()]; this.redoStack = []; this.onChange(); }
  record() {
    if (this.muted || this.batching) return false;
    clearTimeout(this.timer); this.timer = null;
    const s = this.serialize();
    if (this.undoStack[this.undoStack.length - 1] === s) return false;
    this.undoStack.push(s);
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
    return true;
  }
  /** Coalesces a burst of edits into one step. */
  recordSoon(ms = 400) {
    if (this.muted) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.record(), ms);
  }
  flush() { if (this.timer) this.record(); }
  async batch(fn) {
    this.flush();
    this.batching++;
    try { return await fn(); } finally { this.batching--; if (!this.batching) this.record(); }
  }
  async mute(fn) { this.muted++; try { return await fn(); } finally { this.muted--; } }
  get canUndo() { return this.undoStack.length > 1; }
  get canRedo() { return this.redoStack.length > 0; }
  async undo() {
    this.flush();
    if (!this.canUndo) return;
    this.redoStack.push(this.undoStack.pop());
    await this.mute(() => this.restore(this.undoStack[this.undoStack.length - 1]));
    this.onChange();
  }
  async redo() {
    if (!this.canRedo) return;
    const s = this.redoStack.pop();
    this.undoStack.push(s);
    await this.mute(() => this.restore(s));
    this.onChange();
  }
}
