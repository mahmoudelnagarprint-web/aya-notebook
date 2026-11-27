import type { PluginUiModule } from '@ayatodoist/plugin-sdk';
import { useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Icon, Pill, cn, type Tone } from '@ayatodoist/plugin-sdk/ui';
import { STARTER_FILTERS } from './query';

const PRIORITY: Record<number, { ar: string; en: string; tone: Tone }> = {
  1: { ar: 'عاجل', en: 'Urgent', tone: 'rose' },
  2: { ar: 'مرتفع', en: 'High', tone: 'amber' },
  3: { ar: 'متوسط', en: 'Medium', tone: 'blue' },
  4: { ar: 'منخفض', en: 'Low', tone: 'slate' },
};

/** Coloured priority pill shared by rows, detail and reports. */
export function PriorityPill({ priority }: { priority: number }) {
  const language = useLanguage();
  const meta = PRIORITY[priority] ?? PRIORITY[4]!;
  return (
    <Pill tone={meta.tone}>
      <Icon name="flag" size={9} />
      {language === 'ar' ? meta.ar : meta.en}
    </Pill>
  );
}

/** Label chip with the label's own colour dot. */
export function LabelChip({ name, color = '#692ec2', onRemove }: { name: string; color?: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#e2e8f0] bg-white px-2 py-0.5 text-[10.5px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {name}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`إزالة ${name}`} className="text-slate-400 hover:text-rose-500">
          <Icon name="close" size={9} />
        </button>
      ) : null}
    </span>
  );
}

/** Starter filter chips; clicking one runs its query through the local engine. */
export function FilterChips({ activeQuery, onPick }: { activeQuery?: string | null; onPick: (query: string) => void }) {
  const language = useLanguage();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STARTER_FILTERS.map((filter) => (
        <button
          key={filter.name}
          type="button"
          onClick={() => onPick(filter.query)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
            activeQuery === filter.query
              ? 'border-transparent bg-[#132238] text-white'
              : 'border-[#e2e8f0] bg-white text-slate-600 hover:border-[#1e78ff] hover:text-[#1e78ff] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
          )}
          title={language === 'ar' ? `فلتر: ${filter.query}` : `Filter: ${filter.query}`}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: filter.color }} />
          {filter.name}
        </button>
      ))}
    </div>
  );
}

export const filtersLabelsUi: PluginUiModule = { id: 'filters-labels' };
