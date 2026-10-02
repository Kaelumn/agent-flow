import type { GraphDoc } from '@agent-flow/core';
import { Panel, useReactFlow, useStore, useViewport } from '@xyflow/react';
import { Copy, Send, SquareDashedMousePointer, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { Button, IconButton, Textarea, useConfirm } from '../../components/ui';
import type { CanvasEdge } from '../canvas/edges';
import type { CanvasNode } from '../canvas/nodes';
import { describeTarget, type Annotation } from './message';
import { nodeAt, resolveTarget, type Point, type Rect, type Shapes } from './targets';

interface Props {
  doc: GraphDoc;
  /** "Send" inside MSPbots, "Copy" when the canvas is opened on its own. */
  mode: 'send' | 'copy';
  /** Delivers the notes; the parent leaves annotation mode on success and reports failures. */
  onSend: (annotations: Annotation[]) => Promise<void>;
  onExit: () => void;
}

/** Below a drag this short (screen px) the gesture is a click. */
const CLICK_SLOP = 5;
const SAMPLE_STEP = 8;
const NODE_PAD = 6;
const EDITOR_WIDTH = 288;

const span = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
const pad = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 });

/**
 * Annotation mode: an overlay above the canvas where the reviewer boxes what needs to change and says why.
 * Boxes are kept in flow coordinates so they stay on their elements while zooming.
 */
export function AnnotationLayer({ doc, mode, onSend, onExit }: Props) {
  const rf = useReactFlow<CanvasNode, CanvasEdge>();
  const viewport = useViewport();
  const domNode = useStore((s) => s.domNode);
  const minZoom = useStore((s) => s.minZoom);
  const maxZoom = useStore((s) => s.maxZoom);
  const confirm = useConfirm();
  const [items, setItems] = useState<Annotation[]>([]);
  const [drag, setDrag] = useState<{ from: Point; to: Point; screen: Point } | null>(null);
  /** Last pointer position while panning with Space or the middle button held; a ref, as moves outpace renders. */
  const pan = useRef<Point | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toScreen = (r: Rect) => ({ left: r.x * viewport.zoom + viewport.x, top: r.y * viewport.zoom + viewport.y, width: r.width * viewport.zoom, height: r.height * viewport.zoom });
  const toFlow = (e: ReactPointerEvent) => rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });

  const shapes = (): Shapes => ({
    nodes: rf.getNodes().map((n) => ({ id: n.id, rect: { x: n.position.x, y: n.position.y, width: n.measured?.width ?? 0, height: n.measured?.height ?? 0 } })),
    edges: [...(domNode?.querySelectorAll<SVGPathElement>('.react-flow__edge:not([data-id^="jump:"]) path.react-flow__edge-path') ?? [])].map((path) => {
      const length = path.getTotalLength();
      const points = Array.from({ length: Math.ceil(length / SAMPLE_STEP) + 1 }, (_, i) => path.getPointAtLength(Math.min(i * SAMPLE_STEP, length)));
      return { id: path.closest('.react-flow__edge')!.getAttribute('data-id')!, points: points.map(({ x, y }) => ({ x, y })) };
    }),
  });

  const ready = items.filter((a) => a.note.trim());
  const update = (id: string, patch: Partial<Annotation>) => setItems((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const remove = (id: string) => setItems((xs) => xs.filter((a) => a.id !== id));
  /** Leaving a note empty discards its box. */
  const finishEditing = () => {
    if (editing && !items.find((a) => a.id === editing)?.note.trim()) remove(editing);
    setEditing(null);
  };

  const exit = async () => {
    if (ready.length && !(await confirm({ title: 'Discard annotations', message: `Discard ${ready.length} annotation(s) without sending?`, confirmLabel: 'Discard', danger: true }))) return;
    onExit();
  };

  const send = async () => {
    finishEditing();
    setBusy(true);
    try {
      await onSend(ready);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && !typing(e)) {
        e.preventDefault();
        setSpaceHeld(e.type === 'keydown');
      }
      if (e.type !== 'keydown' || e.key !== 'Escape') return;
      if (editing) finishEditing();
      else void exit();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startPan = e.button === 1 || (e.button === 0 && spaceHeld);
    if (e.button !== 0 && !startPan) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (startPan) {
      pan.current = { x: e.clientX, y: e.clientY };
      return setPanning(true);
    }
    finishEditing();
    const at = toFlow(e);
    setDrag({ from: at, to: at, screen: { x: e.clientX, y: e.clientY } });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.current) {
      const { x, y, zoom } = rf.getViewport();
      void rf.setViewport({ x: x + e.clientX - pan.current.x, y: y + e.clientY - pan.current.y, zoom });
      pan.current = { x: e.clientX, y: e.clientY };
    } else if (drag) {
      setDrag({ ...drag, to: toFlow(e) });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.current) {
      pan.current = null;
      return setPanning(false);
    }
    if (!drag) return;
    setDrag(null);
    const current = shapes();
    const clicked = Math.hypot(e.clientX - drag.screen.x, e.clientY - drag.screen.y) < CLICK_SLOP;
    // A click on a card boxes that card; a click on empty canvas does nothing.
    const box = clicked ? nodeAt(drag.from, current)?.rect : span(drag.from, toFlow(e));
    if (!box) return;
    const framed = clicked ? pad(box, NODE_PAD) : box;
    const annotation: Annotation = { id: crypto.randomUUID(), box: framed, note: '', target: resolveTarget(clicked ? box : framed, current) };
    setItems((xs) => [...xs, annotation]);
    setEditing(annotation.id);
  };

  // As on the canvas underneath: the wheel scrolls (Shift for sideways), Ctrl + wheel or a pinch zooms at the pointer.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!domNode) return;
    const { x, y, zoom } = rf.getViewport();
    if (!e.ctrlKey && !e.metaKey) {
      const [dx, dy] = e.shiftKey && !e.deltaX ? [e.deltaY, 0] : [e.deltaX, e.deltaY];
      void rf.setViewport({ x: x - dx, y: y - dy, zoom });
      return;
    }
    const next = Math.min(maxZoom, Math.max(minZoom, zoom * 2 ** Math.max(-1, Math.min(1, -e.deltaY * 0.01))));
    const bounds = domNode.getBoundingClientRect();
    const px = e.clientX - bounds.left;
    const py = e.clientY - bounds.top;
    void rf.setViewport({ zoom: next, x: px - ((px - x) * next) / zoom, y: py - ((py - y) * next) / zoom });
  };

  const active = items.find((a) => a.id === editing);
  const canvasWidth = domNode?.clientWidth ?? 0;

  return (
    <>
      <div
        className={`absolute inset-0 z-[4] touch-none bg-slate-900/[0.03] ${panning ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : 'cursor-crosshair'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        {items.map((a, i) => {
          const at = toScreen(a.box);
          const current = a.id === editing;
          return (
            <div key={a.id} style={at} className={`pointer-events-none absolute rounded-xl border-2 ${current ? 'border-orange-500 bg-orange-500/10' : 'border-orange-400 bg-orange-400/5'}`}>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setEditing(a.id)}
                className="pointer-events-auto absolute -top-3 -left-3 flex h-6 max-w-[240px] cursor-pointer items-center gap-1.5 rounded-full bg-orange-500 pr-2.5 pl-0.5 text-[11.5px] font-medium text-white shadow-md ring-2 ring-white"
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/20 text-[11px] font-bold tabular-nums">{i + 1}</span>
                <span className="truncate">{a.note.trim() || 'New annotation'}</span>
              </button>
            </div>
          );
        })}

        {drag && <div style={toScreen(span(drag.from, drag.to))} className="pointer-events-none absolute rounded-xl border-2 border-dashed border-orange-500 bg-orange-500/10" />}

        {active && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{ left: Math.max(8, Math.min(toScreen(active.box).left, canvasWidth - EDITOR_WIDTH - 8)), top: toScreen(active.box).top + toScreen(active.box).height + 10, width: EDITOR_WIDTH }}
            className="absolute cursor-default rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10"
          >
            <Textarea
              autoFocus
              rows={2}
              value={active.note}
              onChange={(e) => update(active.id, { note: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  finishEditing();
                }
              }}
              placeholder="What should change here?"
              maxLength={1000}
            />
            <p className="mt-2 line-clamp-2 text-[11.5px] leading-snug text-slate-500">
              <span className="font-medium text-slate-600">On </span>
              {describeTarget(active.target, doc)}
            </p>
            <div className="mt-2.5 flex items-center justify-between">
              <IconButton label="Delete annotation" onClick={() => { remove(active.id); setEditing(null); }} className="hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></IconButton>
              <Button size="sm" variant="primary" onClick={finishEditing} disabled={!active.note.trim()}>Done</Button>
            </div>
          </div>
        )}
      </div>

      {!items.length && !drag && (
        <Panel position="top-center" className="!mt-[68px]">
          <div className="pointer-events-none flex items-center gap-2 whitespace-nowrap rounded-full border border-orange-200 bg-white/95 px-4 py-2 text-[12.5px] text-slate-600 shadow-lg shadow-slate-900/5 backdrop-blur">
            <SquareDashedMousePointer size={15} className="text-orange-500" />
            Box what needs to change, or click a step · Scroll or hold <Key>Space</Key> to move · <Key>Esc</Key> to leave
          </div>
        </Panel>
      )}

      <Panel position="bottom-center" className="!mb-5">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/95 py-1.5 pr-1.5 pl-3.5 shadow-lg shadow-slate-900/5 backdrop-blur">
          <span className="flex items-center gap-2 text-[12.5px] font-medium whitespace-nowrap text-slate-700">
            <SquareDashedMousePointer size={15} className="text-orange-500" />
            Annotating
            <span className="font-normal text-slate-400 tabular-nums">· {ready.length} {ready.length === 1 ? 'note' : 'notes'}</span>
          </span>
          <span className="h-5 w-px bg-slate-200" />
          <Button size="sm" variant="ghost" onClick={() => void exit()}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => void send()} disabled={busy || !ready.length} className="bg-orange-500 hover:bg-orange-400 disabled:bg-orange-200">
            {mode === 'send' ? <Send size={13} /> : <Copy size={13} />}
            {busy ? 'Sending…' : `${mode === 'send' ? 'Send' : 'Copy'}${ready.length ? ` ${ready.length}` : ''}`}
          </Button>
        </div>
      </Panel>
    </>
  );
}

const Key = ({ children }: { children: string }) => <kbd className="rounded border border-slate-200 px-1 font-sans text-[10.5px] text-slate-400">{children}</kbd>;
