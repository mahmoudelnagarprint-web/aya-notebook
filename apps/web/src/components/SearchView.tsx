import { useEffect, useMemo, useState } from 'react';
import { useLabels, useLanguage, useTasks } from '@ayatodoist/plugin-sdk/react';
import { Icon } from '@ayatodoist/plugin-sdk/ui';
import { TaskResultsView } from '@ayatodoist/plugin-tasks-core/ui';

/** Live search across titles, descriptions and label names. */
export function SearchView({ initialQuery = '' }: { initialQuery?: string }) {
  const language = useLanguage();
  const tasks = useTasks();
  const labels = useLabels();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return tasks.filter((task) => {
      if (task.content.toLowerCase().includes(needle)) return true;
      if (task.description.toLowerCase().includes(needle)) return true;
      return task.labels.some((labelId) => {
        const label = labels.find((item) => item.id === labelId);
        return Boolean(label && label.name.toLowerCase().includes(needle));
      });
    });
  }, [query, tasks, labels]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-[12px] border border-[#e2e8f0] bg-white px-3.5 py-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Icon name="search" size={18} className="text-slate-400" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={language === 'ar' ? 'ابحث في كل المهام…' : 'Search every task…'}
          className="h-7 flex-1 bg-transparent text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
          aria-label={language === 'ar' ? 'بحث' : 'Search'}
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} aria-label="مسح" className="text-slate-400 hover:text-slate-700">
            <Icon name="close" size={15} />
          </button>
        ) : null}
      </div>

      {query.trim() ? (
        <TaskResultsView
          tasks={results}
          title={`${results.length} ${language === 'ar' ? 'نتيجة' : 'results'}`}
          subtitle={`«${query.trim()}»`}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[14px] border border-[#e2e8f0] bg-white py-16 text-center dark:border-slate-800 dark:bg-slate-900">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
            <Icon name="search" size={22} />
          </span>
          <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{language === 'ar' ? 'ابدأ الكتابة للبحث' : 'Start typing to search'}</p>
          <p className="max-w-xs text-[11.5px] leading-6 text-slate-500">{language === 'ar' ? 'يشمل البحث العناوين والأوصاف والتصنيفات.' : 'Titles, descriptions and labels are all searched.'}</p>
        </div>
      )}
    </div>
  );
}
