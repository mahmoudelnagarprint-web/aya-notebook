import type { PluginUiModule } from '@ayatodoist/plugin-sdk';
import type { Layout } from '@ayatodoist/core-kernel';
import { addDayString, todayString, useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Icon, Segmented, cn } from '@ayatodoist/plugin-sdk/ui';

const LAYOUTS: Array<{ value: Layout; icon: string }> = [
  { value: 'list', icon: 'list' },
  { value: 'board', icon: 'board' },
  { value: 'table', icon: 'table' },
];

/** List / board / table switch — one place, so every view agrees. */
export function LayoutSwitcher({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  const language = useLanguage();
  const labels: Record<Layout, string> = {
    list: language === 'ar' ? 'قائمة' : 'List',
    board: language === 'ar' ? 'لوحة' : 'Board',
    table: language === 'ar' ? 'جدول' : 'Table',
    calendar: language === 'ar' ? 'تقويم' : 'Calendar',
  };
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={LAYOUTS.map((layout) => ({ value: layout.value, label: labels[layout.value], icon: layout.icon }))}
    />
  );
}

/** Seven-day strip above the task list. */
export function WeekStrip({ selected, onSelect, counts }: { selected: string; onSelect: (day: string) => void; counts?: Record<string, number> }) {
  const language = useLanguage();
  const today = todayString();
  const days = Array.from({ length: 7 }, (_, index) => addDayString(today, index));
  const namesAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const namesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((day) => {
        const [year, month, date] = day.split('-').map(Number);
        const weekday = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).getDay();
        const active = day === selected;
        return (
          <button
            key={day}
            type="button"
            onClick={() => onSelect(day)}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-[10px] border px-1 py-2 transition-colors',
              active
                ? 'border-transparent bg-[#132238] text-white shadow-[0_8px_20px_-14px_rgba(15,23,42,.9)]'
                : 'border-[#e2e8f0] bg-white text-slate-600 hover:border-[#1e78ff]/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
            )}
          >
            <span className={cn('text-[9.5px] font-semibold', active ? 'text-white/60' : 'text-slate-400')}>
              {language === 'ar' ? namesAr[weekday] : namesEn[weekday]}
            </span>
            <span className="text-[14px] font-bold tabular-nums">{date}</span>
            <span className={cn('h-1 w-1 rounded-full', (counts?.[day] ?? 0) > 0 ? (active ? 'bg-white' : 'bg-[#1e78ff]') : 'bg-transparent')} />
          </button>
        );
      })}
    </div>
  );
}

/** Count pill used in view headers and toolbars. */
export function CountBadge({ count, tone = 'blue' }: { count: number; tone?: 'blue' | 'green' | 'amber' | 'rose' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  };
  return <span className={cn('inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[11px] font-bold tabular-nums', colors[tone])}>{count}</span>;
}

export const viewsLayoutsUi: PluginUiModule = { id: 'views-layouts' };

/** Small helper so report views can reuse the icon-only toolbar button. */
export function ToolbarIconButton({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#e2e8f0] bg-white text-slate-500 hover:border-[#1e78ff] hover:text-[#1e78ff] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}
