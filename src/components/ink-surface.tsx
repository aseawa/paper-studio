'use client';
import { useEffect, useRef, type MutableRefObject } from 'react';
import { hitsStroke, type PaperPage, type Point, type Stroke } from '../lib/practice';
export type InkTool = 'pen' | 'eraser' | 'hand';
export function paintStroke(ctx: CanvasRenderingContext2D, line: Stroke) {
  ctx.strokeStyle = line.colour;
  ctx.fillStyle = line.colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (line.points.length === 1) {
    const p = line.points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, (line.width * (0.45 + 0.85 * p.p)) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 1; i < line.points.length; i++) {
    const a = line.points[i - 1],
      b = line.points[i];
    ctx.lineWidth = line.width * (0.45 + (0.85 * (a.p + b.p)) / 2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}
type Props = {
  page: PaperPage;
  scale: number;
  tool: InkTool;
  colour: string;
  width: number;
  locked: boolean;
  onEdit: (before: Stroke[], after: Stroke[]) => void;
  onInput: (kind: string, pressure: number) => void;
  finishRef: MutableRefObject<(() => void) | null>;
};
type ActiveStroke = {
  id: number;
  line: Stroke;
  erase: boolean;
  before: Stroke[];
  removed: Set<string>;
  pan?: { x: number; y: number; left: number; top: number; el: HTMLElement };
};
export default function InkSurface(props: Props) {
  const saved = useRef<HTMLCanvasElement>(null),
    live = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const lastInput = useRef(0);
  const active = useRef<ActiveStroke | null>(null);
  const repaint = () => {
    const canvas = saved.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, latest.current.page.width, latest.current.page.height);
    for (const line of latest.current.page.strokes)
      if (!active.current?.removed.has(line.id)) paintStroke(ctx, line);
  };
  const finish = () => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    if (!a.pan) {
      const after = a.erase ? a.before.filter((l) => !a.removed.has(l.id)) : [...a.before, a.line];
      if (!a.erase || a.removed.size) latest.current.onEdit(a.before, after);
    }
    live.current
      ?.getContext('2d')
      ?.clearRect(0, 0, latest.current.page.width, latest.current.page.height);
    if (live.current?.hasPointerCapture(a.id)) live.current.releasePointerCapture(a.id);
  };
  props.finishRef.current = finish;
  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2),
      ratio = props.scale * dpr;
    for (const canvas of [saved.current, live.current])
      if (canvas) {
        canvas.width = Math.ceil(props.page.width * ratio);
        canvas.height = Math.ceil(props.page.height * ratio);
        canvas.getContext('2d')!.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
    repaint();
  }, [props.page, props.scale]);
  useEffect(() => {
    repaint();
  }, [props.page.strokes]);
  useEffect(
    () => () => {
      active.current = null;
    },
    [],
  );
  const point = (e: PointerEvent) => {
    const r = live.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(props.page.width, ((e.clientX - r.left) / r.width) * props.page.width),
      ),
      y: Math.max(
        0,
        Math.min(props.page.height, ((e.clientY - r.top) / r.height) * props.page.height),
      ),
      p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5,
    };
  };
  const erase = (p: Point) => {
    const a = active.current!;
    for (const line of a.before) if (hitsStroke(line, p)) a.removed.add(line.id);
    repaint();
  };
  return (
    <>
      <canvas ref={saved} className="ink-layer saved-ink" aria-hidden="true" />
      <canvas
        ref={live}
        className={`ink-layer live-ink ${props.tool}`}
        aria-label="Handwriting surface"
        data-testid="ink-canvas"
        style={{ touchAction: props.locked || props.tool === 'hand' ? 'pan-x pan-y' : 'none' }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.pointerType === 'touch' || active.current) return;
          if (
            props.tool !== 'hand' &&
            (props.locked || (e.button !== 0 && e.pointerType !== 'pen'))
          )
            return;
          e.preventDefault();
          const p = point(e.nativeEvent);
          const a: ActiveStroke = {
            id: e.pointerId,
            line: {
              id: crypto.randomUUID(),
              colour: props.colour,
              width: props.width,
              points: [p],
            },
            erase:
              props.tool === 'eraser' ||
              (e.pointerType === 'pen' && (e.button === 5 || e.button === 2 || !!(e.buttons & 32))),
            before: props.page.strokes,
            removed: new Set<string>(),
          };
          if (props.tool === 'hand') {
            const el = live.current!.closest('.paper-viewport') as HTMLElement;
            if (!el) return;
            a.pan = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, el };
          }
          active.current = a;
          e.currentTarget.setPointerCapture(e.pointerId);
          props.onInput(e.pointerType, e.pressure);
          if (a.pan) return;
          if (a.erase) erase(p);
          else paintStroke(live.current!.getContext('2d')!, a.line);
        }}
        onPointerMove={(e) => {
          const a = active.current;
          if (!a || a.id !== e.pointerId) return;
          if (a.pan) {
            a.pan.el.scrollLeft = a.pan.left - e.clientX + a.pan.x;
            a.pan.el.scrollTop = a.pan.top - e.clientY + a.pan.y;
            return;
          }
          if (props.locked) {
            finish();
            return;
          }
          if (performance.now() - lastInput.current > 150) {
            props.onInput(e.pointerType, e.pressure);
            lastInput.current = performance.now();
          }
          const coalesced = e.nativeEvent.getCoalescedEvents?.() || [];
          for (const event of coalesced.length ? coalesced : [e.nativeEvent]) {
            const p = point(event);
            if (a.erase) {
              erase(p);
              continue;
            }
            const last = a.line.points[a.line.points.length - 1];
            if (Math.hypot(p.x - last.x, p.y - last.y) < 0.15) continue;
            a.line.points.push(p);
            paintStroke(live.current!.getContext('2d')!, { ...a.line, points: [last, p] });
          }
        }}
        onPointerUp={(e) => {
          if (active.current?.id === e.pointerId) {
            props.onInput(e.pointerType, e.pressure);
            finish();
          }
        }}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
    </>
  );
}
