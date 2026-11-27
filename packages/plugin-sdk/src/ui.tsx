import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { iconShapes } from './icons';

/** Shared design primitives: one place for radius, tone and surface decisions. */

export type Tone = 'blue' | 'green' | 'amber' | 'purple' | 'rose' | 'cyan' | 'slate';

export const TONE_TILE: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  purple: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
};

export const TONE_PILL: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  purple: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  cyan: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
};

export const TONE_HEX: Record<Tone, string> = {
  blue: '#2563eb',
  green: '#10b981',
  amber: '#f59e0b',
  purple: '#7c3aed',
  rose: '#f43f5e',
  cyan: '#14b8a6',
  slate: '#64748b',
};

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Icon({ name, size = 18, className, strokeWidth = 1.8 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {iconShapes(name)}
    </svg>
  );
}

export function TintedIcon({ name, tone = 'blue', size = 34, iconSize = 17 }: { name: string; tone?: Tone; size?: number; iconSize?: number }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[10px]', TONE_TILE[tone])}
      style={{ width: size, height: size }}
    >
      <Icon name={name} size={iconSize} />
    </span>
  );
}

export function Pill({ children, tone = 'slate', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TONE_PILL[tone], className)}>
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'navy';

export function Button({
  children,
  variant = 'soft',
  icon,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: string }) {
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-[#1e78ff] text-white shadow-[0_6px_16px_-6px_rgba(30,120,255,.7)] hover:bg-[#1668e3]',
    soft: 'bg-white text-slate-700 border border-[#e2e8f0] hover:border-[#cbd5e1] hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
    danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300',
    navy: 'bg-[#132238] text-white hover:bg-[#1b2f4d]',
  };
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-[8px] px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ name, label, tone = 'slate', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { name: string; label: string; tone?: Tone }) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      className={cn('inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors', TONE_PILL[tone], 'hover:brightness-95')}
    >
      <Icon name={name} size={16} />
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'rounded-[14px] border border-[#e2e8f0] bg-white shadow-[0_1px_2px_rgba(15,23,42,.04),0_12px_32px_-24px_rgba(15,23,42,.35)] dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionHeading({ title, subtitle, icon, tone = 'blue', action }: { title: string; subtitle?: string; icon?: string; tone?: Tone; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon ? <TintedIcon name={icon} tone={tone} size={38} /> : null}
        <div>
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Progress({ value, max = 100, tone = 'blue', className }: { value: number; max?: number; tone?: Tone; className?: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800', className)}>
      <span className="block h-full rounded-full transition-[width]" style={{ width: `${percent}%`, background: TONE_HEX[tone] }} />
    </span>
  );
}

export function EmptyState({ icon = 'sparkles', title, body, action }: { icon?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <Icon name={icon} size={26} />
      </span>
      <div>
        <p className="text-[14px] font-bold text-slate-700 dark:text-slate-200">{title}</p>
        {body ? <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-6 text-slate-500 dark:text-slate-400">{body}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  width = 560,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fixed inset-0 bg-[#0b1220]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="modal-appear relative w-full overflow-hidden rounded-[16px] border border-[#e2e8f0] bg-white shadow-[0_30px_80px_-20px_rgba(15,23,42,.55)] dark:border-slate-700 dark:bg-slate-900"
        style={{ maxWidth: width }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#eef2f7] px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            {icon ? <TintedIcon name={icon} tone="blue" size={36} /> : null}
            <div>
              <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="max-h-[68vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-[#eef2f7] px-5 py-3 dark:border-slate-800">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, icon, children, width = 430 }: { open: boolean; onClose: () => void; title: string; subtitle?: string; icon?: string; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[#0b1220]/35" onClick={onClose} />
      <aside
        className="absolute inset-y-0 left-0 flex flex-col border-r border-[#e2e8f0] bg-white shadow-[30px_0_80px_-40px_rgba(15,23,42,.6)] dark:border-slate-800 dark:bg-slate-900"
        style={{ width }}
      >
        <header className="flex items-center justify-between gap-2 border-b border-[#eef2f7] bg-[#132238] px-4 py-3 text-white dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            {icon ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/10 text-white">
                <Icon name={icon} size={17} />
              </span>
            ) : null}
            <div>
              <p className="text-[13.5px] font-bold">{title}</p>
              {subtitle ? <p className="text-[10.5px] text-white/60">{subtitle}</p> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="flex h-8 w-8 items-center justify-center rounded-[8px] text-white/70 hover:bg-white/10 hover:text-white">
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    </div>
  );
}

export function TextField({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">{label}</span> : null}
      <input
        {...rest}
        className={cn(
          'h-9 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:border-[#1e78ff] focus:outline-none focus:ring-2 focus:ring-[#1e78ff]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          className,
        )}
      />
      {hint ? <span className="mt-1 block text-[10.5px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function TextArea({ label, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">{label}</span> : null}
      <textarea
        {...rest}
        className={cn(
          'w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 py-2 text-[12.5px] leading-6 text-slate-800 placeholder:text-slate-400 focus:border-[#1e78ff] focus:outline-none focus:ring-2 focus:ring-[#1e78ff]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          className,
        )}
      />
    </label>
  );
}

export function Select({ label, className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">{label}</span> : null}
      <select
        {...rest}
        className={cn(
          'h-9 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2 text-[12.5px] text-slate-800 focus:border-[#1e78ff] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          className,
        )}
      >
        {children}
      </select>
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-[#1e78ff]' : 'bg-slate-300 dark:bg-slate-700',
      )}
    >
      <span className={cn('absolute h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-0.5' : 'left-[18px]')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; icon?: string }>; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex rounded-[8px] border border-[#e2e8f0] bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-[6px] px-2.5 text-[11.5px] font-semibold transition-colors',
            value === option.value ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
          )}
        >
          {option.icon ? <Icon name={option.icon} size={13} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  icon,
  gradient,
  onClick,
  hint,
}: {
  label: string;
  value: number | string;
  icon: string;
  gradient: string;
  onClick?: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-[14px] px-4 py-3 text-left text-white shadow-[0_10px_24px_-16px_rgba(15,23,42,.65)] transition-transform',
        onClick ? 'hover:-translate-y-0.5' : 'cursor-default',
      )}
      style={{ background: gradient }}
    >
      <span className="pointer-events-none absolute -left-6 -top-8 h-20 w-20 rounded-full bg-white/15" />
      <span className="pointer-events-none absolute -bottom-10 right-2 h-16 w-16 rounded-full bg-white/10" />
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/20 text-white backdrop-blur-sm">
        <Icon name={icon} size={18} />
      </span>
      <span className="relative min-w-0">
        <span className="block truncate text-[11px] font-medium text-white/80">{label}</span>
        <span className="block text-[19px] font-extrabold leading-6 tabular-nums">{value}</span>
        {hint ? <span className="block truncate text-[10px] text-white/70">{hint}</span> : null}
      </span>
    </button>
  );
}
