import React from 'react';
import clsx from 'clsx';

/* ── Button ───────────────────────────────────────────────────────────────
 * A button says what happens when it is used, and keeps that name through
 * the whole flow: "Generate roster" produces "Roster generated".          */
export function Button({
  variant = 'primary', size = 'md', loading, className, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'restricted' | 'danger';
  size?: 'sm' | 'md'; loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-[4px] font-medium transition-colors',
        'disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-signal text-white hover:bg-signal-dark',
        variant === 'secondary' && 'bg-white text-ink ring-1 ring-ink-30 hover:bg-ink-10',
        variant === 'ghost' && 'text-ink-70 hover:text-ink hover:bg-ink-10',
        variant === 'restricted' && 'bg-restricted text-white hover:bg-restricted-dark',
        variant === 'danger' && 'bg-alert text-white hover:brightness-90',
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <svg className={clsx('animate-spin h-4 w-4', className)} viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
    <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/* ── Panel ─ a bordered region, not a floating card. Hospital data is dense
 * and tabular; stacking it into shadowed cards wastes the page.           */
export function Panel({ title, description, actions, children, tone = 'default', className }: {
  title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode;
  children: React.ReactNode; tone?: 'default' | 'restricted'; className?: string;
}) {
  return (
    <section className={clsx(
      'bg-surface border rounded-card',
      tone === 'restricted' ? 'border-restricted/30' : 'border-ink-10',
      className,
    )}>
      {(title || actions) && (
        <header className={clsx(
          'flex items-start justify-between gap-4 px-5 py-3.5 border-b',
          tone === 'restricted' ? 'border-restricted/20 bg-restricted-tint/50' : 'border-ink-10',
        )}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-600 font-semibold leading-tight">{title}</h2>}
            {description && <p className="text-[13px] text-ink-70 mt-0.5 max-w-[68ch]">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* ── Badge ─ states, never decoration. ─────────────────────────────────── */
const TONES = {
  neutral:    'bg-ink-10 text-ink-70',
  signal:     'bg-signal-tint text-signal-dark',
  restricted: 'bg-restricted-tint text-restricted-dark',
  alert:      'bg-alert-tint text-alert',
  amber:      'bg-amber-tint text-amber',
  night:      'bg-night-tint text-night',
} as const;

export const Badge = ({ tone = 'neutral', children, className }: {
  tone?: keyof typeof TONES; children: React.ReactNode; className?: string;
}) => (
  <span className={clsx('inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-2xs font-medium', TONES[tone], className)}>
    {children}
  </span>
);

/* ── Table ─ the workhorse. ────────────────────────────────────────────── */
export const Table = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className="overflow-x-auto"><table className={clsx('w-full text-sm', className)}>{children}</table></div>
);
export const TH = ({ children, align = 'left', className }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string;
}) => (
  <th className={clsx(
    'px-4 py-2.5 text-[12px] font-semibold text-ink-70 border-b border-ink-10 bg-paper/60',
    align === 'right' && 'text-right', align === 'center' && 'text-center',
    align === 'left' && 'text-left', className,
  )}>{children}</th>
);
export const TD = ({ children, align = 'left', className }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string;
}) => (
  <td className={clsx(
    'px-4 py-2.5 border-b border-ink-10/60 align-middle',
    align === 'right' && 'text-right', align === 'center' && 'text-center', className,
  )}>{children}</td>
);

/* ── Field ────────────────────────────────────────────────────────────── */
export const Label = ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
  <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink mb-1.5">{children}</label>
);
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={clsx(
    'w-full h-10 px-3 rounded-[4px] bg-white border border-ink-30 text-sm',
    'placeholder:text-ink-50 focus:border-signal focus:ring-0', p.className)} />
);
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={clsx(
    'w-full h-10 px-3 rounded-[4px] bg-white border border-ink-30 text-sm focus:border-signal', p.className)} />
);
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={clsx(
    'w-full px-3 py-2 rounded-[4px] bg-white border border-ink-30 text-sm',
    'placeholder:text-ink-50 focus:border-signal', p.className)} />
);

/* ── Banner ─ explains what happened and what to do, in the product's
 * voice. Errors are never vague and never apologise.                      */
export function Banner({ tone = 'info', title, children, className }: {
  tone?: 'info' | 'success' | 'warn' | 'error' | 'restricted';
  title?: React.ReactNode; children?: React.ReactNode; className?: string;
}) {
  const map = {
    info:       'bg-ink-10/60 border-ink-30 text-ink',
    success:    'bg-signal-tint border-signal/30 text-signal-dark',
    warn:       'bg-amber-tint border-amber/30 text-amber',
    error:      'bg-alert-tint border-alert/30 text-alert',
    restricted: 'bg-restricted-tint border-restricted/30 text-restricted-dark',
  } as const;
  return (
    <div className={clsx('border rounded-[4px] px-4 py-3 text-[13px] leading-relaxed', map[tone], className)}>
      {title && <p className="font-semibold mb-0.5">{title}</p>}
      {children}
    </div>
  );
}

/* ── Empty state ─ an invitation to act, not a shrug. ─────────────────── */
export const Empty = ({ title, children, action }: {
  title: string; children?: React.ReactNode; action?: React.ReactNode;
}) => (
  <div className="px-5 py-12 text-center">
    <p className="text-sm font-semibold">{title}</p>
    {children && <p className="text-[13px] text-ink-70 mt-1 max-w-[46ch] mx-auto">{children}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/* ── Metric ─ a figure with its unit and what it is measured against. ──── */
export const Metric = ({ label, value, unit, sub, tone }: {
  label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode;
  tone?: 'signal' | 'alert' | 'amber' | 'restricted';
}) => (
  <div className="px-5 py-4">
    <p className="text-[12px] text-ink-70 font-medium">{label}</p>
    <p className={clsx('mt-1 text-[26px] leading-none font-semibold num',
      tone === 'signal' && 'text-signal-dark', tone === 'alert' && 'text-alert',
      tone === 'amber' && 'text-amber', tone === 'restricted' && 'text-restricted')}>
      {value}{unit && <span className="text-[14px] font-medium text-ink-50 ml-1">{unit}</span>}
    </p>
    {sub && <p className="text-[12px] text-ink-70 mt-1.5 leading-snug">{sub}</p>}
  </div>
);

/* ── Bar ─ a proportion shown in place, without a chart library. ───────── */
export const Bar = ({ value, max, tone = 'signal' }: { value: number; max: number; tone?: 'signal' | 'alert' | 'amber' | 'night' }) => (
  <div className="h-1.5 w-full bg-ink-10 rounded-full overflow-hidden">
    <div className={clsx('h-full rounded-full',
      tone === 'signal' && 'bg-signal', tone === 'alert' && 'bg-alert',
      tone === 'amber' && 'bg-amber', tone === 'night' && 'bg-night')}
      style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
  </div>
);

export const Modal = ({ open, onClose, title, children, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string;
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
         onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="fixed inset-0 bg-ink/40" />
      <div className={clsx('relative bg-surface rounded-card shadow-pop w-full my-8', width)}
           onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-ink-10">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {/* Labelled distinctly from any "Close" button in the footer, so a
              screen-reader user is not offered two identical controls. */}
          <button onClick={onClose} aria-label={`Close ${title}`}
                  className="text-ink-50 hover:text-ink p-1 -m-1">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {children}
      </div>
    </div>
  );
};
