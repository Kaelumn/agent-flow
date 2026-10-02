import { Panel, useReactFlow, useStore, useViewport, type FitViewOptions } from '@xyflow/react';
import { CircleStop, LayoutGrid, Maximize, Minus, Plus, SquareDashedMousePointer, SquarePlus } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx, Tooltip } from '../../components/ui';

interface Props {
  readOnly: boolean;
  onAddStep: () => void;
  onAddEnd: () => void;
  onTidy: () => void;
  onAnnotate: () => void;
  /** Icons only, for narrow canvases. */
  compact: boolean;
  /** Width covered along the bottom-right edge. The toolbar stays centred and moves left only to clear it. */
  reserve: number;
  fit: FitViewOptions['padding'];
}

/** Floating canvas toolbar: editing on the left, view controls on the right. */
const GAP = 12;

export function Toolbar({ readOnly, onAddStep, onAddEnd, onTidy, onAnnotate, compact, reserve, fit }: Props) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const canvas = useStore((s) => s.width);
  const bar = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState(0);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setOwn(el.offsetWidth));
    observer.observe(el);
    setOwn(el.offsetWidth);
    return () => observer.disconnect();
  }, []);
  // Centred on the canvas; shifted left only as far as needed to clear the corner, never past the left edge.
  const overlap = canvas / 2 + own / 2 - (canvas - reserve - GAP);
  const shift = Math.max(0, Math.min(overlap, canvas / 2 - own / 2 - GAP));
  const label = (text: string) => (compact ? undefined : text);
  const fitAll = () => void fitView({ padding: fit, maxZoom: 1, duration: 250 });

  return (
    <Panel position="bottom-center" className="!mb-4" style={{ translate: `${-shift}px 0` }}>
      <div ref={bar} className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg shadow-slate-900/5 backdrop-blur">
        {!readOnly && (
          <>
            <Tool onClick={onAddStep} label="Add a step" shortcut={label('Step')} primary><SquarePlus size={16} /></Tool>
            <Tool onClick={onAddEnd} label="Add an end" shortcut={label('End')}><CircleStop size={16} /></Tool>
            <Tool onClick={onTidy} label="Tidy up the layout" shortcut={label('Tidy')}><LayoutGrid size={16} /></Tool>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <Tool onClick={onAnnotate} label="Box what needs to change and send it to the agent (A)" shortcut={label('Annotate')}><SquareDashedMousePointer size={16} className="text-orange-500" /></Tool>
            <span className="mx-1 h-5 w-px bg-slate-200" />
          </>
        )}
        <Tool onClick={() => zoomOut({ duration: 150 })} label="Zoom out"><Minus size={16} /></Tool>
        <Tooltip content="Fit to screen">
          <button type="button" onClick={fitAll} className="w-12 rounded-md py-1.5 text-center text-xs font-medium text-slate-600 tabular-nums hover:bg-slate-100">
            {Math.round(zoom * 100)}%
          </button>
        </Tooltip>
        <Tool onClick={() => zoomIn({ duration: 150 })} label="Zoom in"><Plus size={16} /></Tool>
        {!compact && <Tool onClick={fitAll} label="Fit to screen"><Maximize size={15} /></Tool>}
      </div>
    </Panel>
  );
}

function Tool({ onClick, label, shortcut, primary, children }: { onClick: () => void; label: string; shortcut?: string; primary?: boolean; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cx(
          'flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
          primary ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )}
      >
        {children}
        {shortcut && <span>{shortcut}</span>}
      </button>
    </Tooltip>
  );
}
