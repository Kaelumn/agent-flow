import { Check, CircleAlert, CircleCheck, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api/client';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

// ---- Buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-500 disabled:bg-indigo-300 disabled:shadow-none',
  secondary: 'border border-slate-200 bg-white text-slate-700 shadow-xs hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300 disabled:hover:bg-transparent',
  danger: 'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:text-rose-300',
};

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({ label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={cx('grid size-7 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none', className)}
        {...props}
      />
    </Tooltip>
  );
}

// ---- Tooltip

/**
 * Hover hint for a single child element. Rendered in a portal with fixed positioning, so it is never clipped
 * by scrolling panels and ignores canvas zoom.
 */
export function Tooltip({ content, side = 'top', children }: { content: ReactNode; side?: 'top' | 'bottom' | 'left'; children: ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hide = () => {
    clearTimeout(timer.current);
    setAt(null);
  };
  const show = (el: Element | null) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!el?.isConnected) return;
      const r = el.getBoundingClientRect();
      setAt(side === 'left' ? { x: r.left - 8, y: r.top + r.height / 2 } : { x: r.left + r.width / 2, y: side === 'top' ? r.top - 8 : r.bottom + 8 });
    }, 300);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  if (content == null || content === '') return children;
  return (
    <span className="contents" onPointerEnter={(e) => show(e.currentTarget.firstElementChild)} onPointerLeave={hide} onPointerDown={hide} onWheel={hide}>
      {children}
      {at &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: at.x, top: at.y }}
            className={cx(
              'af-tooltip pointer-events-none fixed z-[100] rounded-md bg-slate-900 px-2 py-1 text-[11.5px] leading-4 font-medium whitespace-nowrap text-white shadow-lg shadow-slate-900/20',
              side === 'left' ? '-translate-x-full -translate-y-1/2' : '-translate-x-1/2',
              side === 'top' && '-translate-y-full',
            )}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

// ---- Form controls

const control =
  'w-full rounded-md border border-transparent bg-slate-100/80 px-2.5 text-[13px] text-slate-900 transition-colors placeholder:text-slate-400 hover:bg-slate-100 focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-500/15 focus:outline-none disabled:opacity-60';

export const Input = ({ className, ...props }: ComponentProps<'input'>) => <input className={cx(control, 'h-8', className)} {...props} />;

export const Textarea = ({ className, ...props }: ComponentProps<'textarea'>) => (
  <textarea className={cx(control, 'min-h-16 resize-y py-1.5 leading-relaxed', className)} {...props} />
);

export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx(control, 'h-8 pr-8', className)} {...props} />;

export function Field({ label, hint, error, action, children }: { label?: ReactNode; hint?: ReactNode; error?: string | null; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {(label || action) && (
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="text-[12px] text-slate-500">{label}</label>
          {action}
        </div>
      )}
      {children}
      {error ? <p className="mt-1 text-[11.5px] text-rose-600">{error}</p> : hint && <p className="mt-1 text-[11px] leading-snug text-slate-400">{hint}</p>}
    </div>
  );
}

/** A row of mutually exclusive options. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; activeClass?: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-all',
            o.value === value ? cx('bg-white shadow-sm', o.activeClass ?? 'text-slate-900') : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 text-left">
      <span className={cx('mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors', checked ? 'bg-indigo-600' : 'bg-slate-200')}>
        <span className={cx('size-4 rounded-full bg-white shadow-sm transition-transform', checked && 'translate-x-4')} />
      </span>
      <span>
        <span className="block text-[13px] font-medium text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

// ---- Layout

/** A titled block inside a side panel. */
export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('px-4 pt-5 last:pb-5', className)}>
      {(title || action) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title && <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>}
          {action}
        </div>
      )}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** The top of a side panel: what is being edited, in one line each for name and kind. */
export function PanelHead({ icon, tile, title, subtitle, aside }: { icon: ReactNode; tile: string; title: ReactNode; subtitle: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 pt-1 pb-4">
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl ring-1', tile)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-slate-900">{title}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] text-slate-500">
          <span className="min-w-0 truncate">{subtitle}</span>
          {aside && <span className="ml-auto shrink-0">{aside}</span>}
        </div>
      </div>
    </div>
  );
}

/** A heading that is also the field that edits it. */
export const TitleInput = ({ className, ...props }: ComponentProps<'input'>) => (
  <input
    className={cx('-mx-1.5 w-[calc(100%+12px)] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[15px] font-semibold text-slate-900 transition-colors placeholder:font-normal placeholder:text-slate-400 hover:bg-slate-100 focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-500/15 focus:outline-none', className)}
    {...props}
  />
);

/** The bottom of a side panel. Save and discard appear only when there is something to save. */
export function SaveBar({ dirty, saving, disabled, onSave, onDiscard, children }: { dirty: boolean; saving: boolean; disabled?: boolean; onSave: () => void; onDiscard?: () => void; children?: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-slate-100 bg-white px-4">
      {dirty ? (
        <>
          <Button variant="primary" size="sm" onClick={onSave} disabled={saving || disabled}>{saving ? 'Saving…' : 'Save changes'}</Button>
          {onDiscard && <Button variant="ghost" size="sm" onClick={onDiscard}>Discard</Button>}
        </>
      ) : (
        <span className="flex items-center gap-1.5 text-[12px] text-slate-400"><Check size={13} />No unsaved changes</span>
      )}
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}

const POPOVER_ROOM = 320;

/** Opens `content` below `trigger`, or above it when there is no room below; closes on outside click and Escape. */
export function Popover({ open, onClose, trigger, children, className }: { open: boolean; onClose: () => void; trigger: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    setAbove(window.innerHeight - box.bottom < POPOVER_ROOM && box.top > window.innerHeight - box.bottom);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && <div className={cx('absolute z-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10', above ? 'bottom-full mb-1.5' : 'mt-1.5', className)}>{children}</div>}
    </div>
  );
}

// ---- Display

type Tone = 'slate' | 'indigo' | 'green' | 'amber' | 'red' | 'blue';
const TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600 ring-slate-200/60',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200/60',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  red: 'bg-rose-50 text-rose-700 ring-rose-200/60',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200/60',
};
const DOTS: Record<Tone, string> = { slate: 'bg-slate-400', indigo: 'bg-indigo-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', blue: 'bg-sky-500' };

export const Badge = ({ tone = 'slate', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) => (
  <span className={cx('inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone], className)}>
    {dot && <span className={cx('size-1.5 rounded-full', DOTS[tone])} />}
    {children}
  </span>
);

export const StatusDot = ({ tone, className }: { tone: Tone; className?: string }) => <span className={cx('inline-block size-2 shrink-0 rounded-full', DOTS[tone], className)} />;

const AVATAR_COLORS = ['bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700', 'bg-violet-100 text-violet-700'];

export function Avatar({ name, className }: { name: string; className?: string }) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const initials = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
  return <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold', AVATAR_COLORS[hash % AVATAR_COLORS.length], className)}>{initials}</span>;
}

export const Empty = ({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center px-8 py-12 text-center">
    {icon && <div className="mb-3 grid size-10 place-items-center rounded-full bg-slate-100 text-slate-400">{icon}</div>}
    <p className="text-[13px] font-semibold text-slate-800">{title}</p>
    {children && <div className="mt-1 max-w-xs text-[12.5px] leading-relaxed text-slate-500">{children}</div>}
  </div>
);

export function Modal({ title, description, children, onClose }: { title: string; description?: ReactNode; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-slate-500">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-1"><X size={16} /></IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- Toasts

interface Toast {
  id: number;
  tone: 'info' | 'error';
  text: string;
}

const ToastContext = createContext<(tone: Toast['tone'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-start gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-[13px] text-white shadow-xl shadow-slate-900/20">
            {t.tone === 'error' ? <CircleAlert size={16} className="mt-px shrink-0 text-rose-400" /> : <CircleCheck size={16} className="mt-px shrink-0 text-emerald-400" />}
            <span className="leading-relaxed">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns notify(text) and fail(err) helpers that show toasts. */
export function useToast() {
  const push = useContext(ToastContext);
  return {
    notify: (text: string) => push('info', text),
    fail: (err: unknown) => push('error', err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong'),
  };
}

// ---- Confirmation dialog

interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<(request: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const ask = useCallback((r: Omit<ConfirmRequest, 'resolve'>) => new Promise<boolean>((resolve) => setRequest({ ...r, resolve })), []);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request && (
        <Modal title={request.title} description={request.message} onClose={() => close(false)}>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
            <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>{request.confirmLabel ?? 'Confirm'}</Button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/** `await confirm({...})` resolves true when the user confirms. */
export const useConfirm = () => useContext(ConfirmContext);

export { cx };
