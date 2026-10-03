import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx, IconButton, Tooltip } from '../components/ui';

export interface DockTab<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  count?: number;
  tone?: 'red' | 'amber';
}

/** Below this canvas width the panel opens as a bottom sheet instead of a card on the right. */
export const NARROW_WIDTH = 720;
const EDGE = 12;
const RAIL = 40;
const CARD = 320;
const SHEET_SHARE = 0.55;

/** Canvas area each side that the dock covers, so the canvas can keep its content and controls clear of it. */
export function dockInsets(open: boolean, narrow: boolean, height: number) {
  if (open && narrow) return { right: EDGE + RAIL + EDGE, bottom: Math.round(height * SHEET_SHARE) + EDGE };
  return { right: EDGE + RAIL + EDGE + (open ? CARD + EDGE : 0), bottom: 0 };
}

interface Props<T extends string> {
  tabs: DockTab<T>[];
  open: T | null;
  narrow: boolean;
  onOpen: (tab: T) => void;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The editor's side panels, floating over the canvas: a rail of tabs on the right edge, and the open tab as a card
 * beside it (or a bottom sheet on narrow canvases). Collapsed until a tab is opened or something is selected.
 */
export function Dock<T extends string>({ tabs, open, narrow, onOpen, onClose, children }: Props<T>) {
  const current = tabs.find((t) => t.id === open);

  return (
    <>
      <nav className="absolute z-10 flex flex-col gap-0.5 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg shadow-slate-900/5 backdrop-blur" style={{ top: EDGE, right: EDGE, width: RAIL }}>
        {tabs.map((t) => (
          <Tooltip key={t.id} content={t.label} side="left">
            <button
              type="button"
              aria-label={t.label}
              aria-pressed={t.id === open}
              onClick={() => (t.id === open ? onClose() : onOpen(t.id))}
              className={cx('relative grid size-8 place-items-center rounded-lg transition-colors', t.id === open ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900')}
            >
              {t.icon}
              {!!t.count && (
                <span className={cx('absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums ring-2 ring-white', t.tone === 'red' ? 'bg-rose-500' : 'bg-amber-500')}>
                  {t.count}
                </span>
              )}
            </button>
          </Tooltip>
        ))}
      </nav>

      {current && (
        <section
          aria-label={current.label}
          style={narrow ? { left: EDGE, right: EDGE, bottom: EDGE, height: `${SHEET_SHARE * 100}%` } : { top: EDGE, bottom: EDGE, right: EDGE + RAIL + EDGE, width: CARD }}
          className="af-dock absolute z-10 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
        >
          <header className="flex h-9 shrink-0 items-center justify-between bg-slate-50/80 pr-1 pl-4">
            <span className="text-[12px] font-medium text-slate-500">{current.label}</span>
            <IconButton label="Close panel (Esc)" onClick={onClose}><X size={15} /></IconButton>
          </header>
          <div className="min-h-0 flex-1">{children}</div>
        </section>
      )}
    </>
  );
}
