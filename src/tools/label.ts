import type { App } from '../app';
import { LABEL_FONT, newLabelId, type Label } from '../core/labels';
import { hitLabel } from '../render/labels';
import { strokeTwoTone, type Cursor, type Tool, type ToolEvent } from './tool';

const DOUBLE_CLICK_MS = 400;

/**
 * Text: click empty map to type a new label, click a label to edit its text.
 * Select: click a label to select it, drag to move, double-click or Enter to
 * edit the text, Delete to remove it. With a label selected, the label
 * controls and the color palette restyle it.
 */
export class LabelTool implements Tool {
  private drag: { id: string; before: Label; ox: number; oy: number; moved: boolean } | null = null;
  private lastDown = { t: 0, id: '' };

  constructor(
    private app: App,
    readonly id: 'text' | 'select',
    private editor: LabelEditor,
  ) {}

  onDown(e: ToolEvent): void {
    const hit = this.hitTest(e.wx, e.wy);
    const now = performance.now();
    const isDouble = !!hit && hit.id === this.lastDown.id && now - this.lastDown.t < DOUBLE_CLICK_MS;
    this.lastDown = { t: now, id: hit?.id ?? '' };

    if (hit) {
      this.app.selectLabel(hit.id);
      if (this.id === 'text' || isDouble) {
        this.editor.open(hit, false);
        return;
      }
      this.drag = { id: hit.id, before: { ...hit }, ox: e.wx - hit.x, oy: e.wy - hit.y, moved: false };
      return;
    }
    this.app.selectLabel(null);
    if (this.id === 'text' && this.app.canPaint()) {
      const s = this.app.state;
      this.editor.open(
        {
          id: newLabelId(),
          layer: this.app.activeLayer.id,
          text: '',
          x: e.wx,
          y: e.wy,
          size: s.labelSize,
          color: s.color,
          rotation: (s.labelRotation * Math.PI) / 180,
          curve: s.labelCurve / 100,
        },
        true,
      );
    }
  }

  onMove(e: ToolEvent): void {
    const d = this.drag;
    const label = d && this.app.labels.get(d.id);
    if (!d || !label) return;
    d.moved = true;
    this.app.labels.put({ ...label, x: e.wx - d.ox, y: e.wy - d.oy });
  }

  onUp(): void {
    const d = this.drag;
    this.drag = null;
    if (d?.moved) this.app.history.recordLabels({ before: d.before, after: this.app.labels.get(d.id) ?? null });
  }

  onKey(e: KeyboardEvent): boolean {
    const sel = this.app.selected;
    if (!sel) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.app.flushLabelEdit();
      this.app.history.changeLabels({ before: sel, after: null });
    } else if (e.key === 'Enter') {
      this.editor.open(sel, false);
    } else if (e.key === 'Escape') {
      this.app.selectLabel(null);
    } else {
      return false;
    }
    return true;
  }

  deactivate(): void {
    this.editor.commit();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, cursor: Cursor | null): void {
    if (!cursor) return;
    const { sx: x, sy: y } = cursor;
    const p = new Path2D();
    if (this.id === 'text') {
      // I-beam.
      p.moveTo(x - 4, y - 8);
      p.lineTo(x + 4, y - 8);
      p.moveTo(x, y - 8);
      p.lineTo(x, y + 8);
      p.moveTo(x - 4, y + 8);
      p.lineTo(x + 4, y + 8);
    } else {
      // Arrow.
      p.moveTo(x, y);
      p.lineTo(x, y + 14);
      p.lineTo(x + 4, y + 10);
      p.lineTo(x + 7, y + 16);
      p.lineTo(x + 9, y + 15);
      p.lineTo(x + 6, y + 9);
      p.lineTo(x + 11, y + 9);
      p.closePath();
    }
    strokeTwoTone(ctx, p);
  }

  /** The topmost editable label under a world point. */
  private hitTest(x: number, y: number): Label | undefined {
    const pad = 3 / this.app.camera.zoom;
    const labels = this.app.labels.all();
    const layers = this.app.layers.all;
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible || layer.locked) continue;
      for (let j = labels.length - 1; j >= 0; j--) {
        const l = labels[j];
        if (l.layer === layer.id && hitLabel(l, x, y, pad)) return l;
      }
    }
    return undefined;
  }
}

/**
 * A text box over the map for typing a label. Enter or clicking away keeps
 * the text, Esc cancels; an emptied label is deleted.
 */
export class LabelEditor {
  private input: HTMLInputElement;
  private target: { label: Label; isNew: boolean } | null = null;

  constructor(private app: App) {
    const input = document.createElement('input');
    input.className = 'label-editor';
    input.type = 'text';
    input.spellcheck = false;
    input.hidden = true;
    input.setAttribute('aria-label', 'Label text');
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.commit();
      else if (e.key === 'Escape') this.close();
    });
    input.addEventListener('input', () => this.fit());
    input.addEventListener('blur', () => this.commit());
    app.canvas.parentElement!.append(input);
    this.input = input;
    app.onView(() => this.position());
  }

  open(label: Label, isNew: boolean): void {
    this.commit();
    this.app.flushLabelEdit();
    this.target = { label: { ...label }, isNew };
    this.app.editingLabel = label.id;
    this.input.value = label.text;
    this.input.style.color = label.color;
    this.input.hidden = false;
    this.position();
    this.fit();
    this.input.focus();
    this.input.select();
    this.app.requestRender();
  }

  commit(): void {
    const t = this.target;
    if (!t) return;
    const text = this.input.value.trim();
    const current = this.app.labels.get(t.label.id);
    this.close();
    if (t.isNew) {
      if (!text) return;
      this.app.history.changeLabels({ before: null, after: { ...t.label, text } });
      this.app.selectLabel(t.label.id);
    } else if (current) {
      if (!text) this.app.history.changeLabels({ before: current, after: null });
      else if (text !== current.text) this.app.history.changeLabels({ before: current, after: { ...current, text } });
    }
  }

  private close(): void {
    if (!this.target) return;
    this.target = null;
    this.app.editingLabel = null;
    this.input.hidden = true;
    this.app.requestRender();
    if (document.activeElement === this.input) this.app.canvas.focus();
  }

  private get fontPx(): number {
    const l = this.target!.label;
    return Math.min(72, Math.max(14, l.size * this.app.camera.zoom));
  }

  private position(): void {
    if (!this.target) return;
    const { label } = this.target;
    const cam = this.app.camera;
    this.input.style.left = `${cam.toScreenX(label.x)}px`;
    this.input.style.top = `${cam.toScreenY(label.y)}px`;
    this.input.style.font = `${this.fontPx}px ${LABEL_FONT}`;
  }

  private fit(): void {
    if (!this.target) return;
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${this.fontPx}px ${LABEL_FONT}`;
    const w = ctx.measureText(this.input.value || 'Place name').width;
    this.input.style.width = `${Math.ceil(w + this.fontPx)}px`;
    this.input.placeholder = 'Place name';
  }
}
