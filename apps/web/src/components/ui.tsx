import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ApiError } from '../api/client';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:text-red-300',
};

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 px-3 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

const control = 'w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-none disabled:bg-slate-50';

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input className={cx(control, 'h-9', className)} {...props} />;

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx(control, 'min-h-20 py-2 leading-relaxed', className)} {...props} />
);

export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx(control, 'h-9', className)} {...props} />;

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

type Tone = 'slate' | 'indigo' | 'green' | 'amber' | 'red' | 'blue';
const TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600',
  indigo: 'bg-indigo-50 text-indigo-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-sky-50 text-sky-700',
};

export const Badge = ({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) => (
  <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', TONES[tone], className)}>{children}</span>
);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="px-6 py-10 text-center">
    <p className="text-sm font-medium text-slate-700">{title}</p>
    {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
  </div>
);

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
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
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cx('rounded-lg px-4 py-3 text-sm shadow-lg', t.tone === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white')}>
            {t.text}
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
        <Modal title={request.title} onClose={() => close(false)}>
          <div className="text-sm text-slate-600">{request.message}</div>
          <div className="mt-6 flex justify-end gap-2">
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
