import { useEffect, useMemo, useRef, useState } from 'react';
import { useExecute, useKernel, useLanguage, useTasks } from '@ayatodoist/plugin-sdk/react';
import { Icon, cn } from '@ayatodoist/plugin-sdk/ui';
import { runtimeStore } from '../app/runtime';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  group: string;
  run: () => void;
}

/** Ctrl+K palette: navigation, actions and live task search in one list. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const kernel = useKernel();
  const language = useLanguage();
  const tasks = useTasks();
  const run = useExecute();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const navigate = (kind: string) => () => {
      runtimeStore.navigate({ kind: kind as never });
      onClose();
    };
    return [
      { id: 'quick-add', label: language === 'ar' ? 'إضافة مهمة سريعة' : 'Quick add task', hint: 'Q', icon: 'plus', group: 'actions', run: () => { runtimeStore.openQuickAdd(); onClose(); } },
      { id: 'aya', label: language === 'ar' ? 'افتحي آية' : 'Open Aya', icon: 'sparkles', group: 'actions', run: () => { runtimeStore.openAya(); onClose(); } },
      { id: 'undo', label: language === 'ar' ? 'تراجع عن آخر إجراء' : 'Undo last action', icon: 'undo', group: 'actions', run: () => { void run('core.history.undo', {}); onClose(); } },
      { id: 'redo', label: language === 'ar' ? 'إعادة' : 'Redo', icon: 'redo', group: 'actions', run: () => { void run('core.history.redo', {}); onClose(); } },
      { id: 'inbox', label: language === 'ar' ? 'الوارد' : 'Inbox', icon: 'inbox', group: 'navigate', run: navigate('inbox') },
      { id: 'today', label: language === 'ar' ? 'اليوم' : 'Today', icon: 'today', group: 'navigate', run: navigate('today') },
      { id: 'upcoming', label: language === 'ar' ? 'القادمة' : 'Upcoming', icon: 'upcoming', group: 'navigate', run: navigate('upcoming') },
      { id: 'completed', label: language === 'ar' ? 'المنجز' : 'Completed', icon: 'checkCircle', group: 'navigate', run: navigate('completed') },
      { id: 'reporting', label: language === 'ar' ? 'التقارير' : 'Reports', icon: 'chart', group: 'navigate', run: navigate('reporting') },
      { id: 'settings', label: language === 'ar' ? 'الإعدادات' : 'Settings', icon: 'settings', group: 'navigate', run: navigate('settings') },
    ];
  }, [language, run, onClose]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle ? commands.filter((command) => command.label.toLowerCase().includes(needle)) : commands;
    const taskMatches = needle
      ? tasks.filter((task) => !task.isCompleted && task.content.toLowerCase().includes(needle)).slice(0, 6)
      : [];
    return { commands: matched, tasks: taskMatches };
  }, [commands, tasks, query]);

  const flat = useMemo(
    () => [
      ...results.commands.map((command) => ({ key: `c-${command.id}`, label: command.label, group: command.group, icon: command.icon, run: command.run })),
      ...results.tasks.map((task) => ({
        key: `t-${task.id}`,
        label: task.content,
        group: 'tasks',
        icon: 'checkCircle',
        run: () => {
          runtimeStore.navigate({ kind: 'search', query: task.content });
          onClose();
        },
      })),
    ],
    [results, onClose],
  );

  useEffect(() => {
    if (index >= flat.length) setIndex(0);
  }, [flat.length, index]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="لوحة الأوامر">
      <div className="fixed inset-0 bg-[#0b1220]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="modal-appear relative w-full max-w-[560px] overflow-hidden rounded-[14px] border border-[#e2e8f0] bg-white shadow-[0_30px_80px_-20px_rgba(15,23,42,.6)] dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-[#eef2f7] px-4 py-3 dark:border-slate-800">
          <Icon name="search" size={17} className="text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((value) => Math.min(flat.length - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                flat[index]?.run();
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
            placeholder="ابحث عن مهمة أو اكتب أمراً…"
            className="h-8 flex-1 bg-transparent text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            aria-label="بحث"
          />
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-400 dark:border-slate-700 dark:bg-slate-800">Esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {flat.length === 0 ? <p className="px-3 py-8 text-center text-[12px] text-slate-400">لا توجد نتائج</p> : null}
          {flat.map((item, itemIndex) => (
            <button
              key={item.key}
              type="button"
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={item.run}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] transition-colors',
                itemIndex === index ? 'bg-blue-50 text-[#1e78ff] dark:bg-blue-500/10' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              <Icon name={item.icon} size={15} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="text-[9.5px] uppercase tracking-wide text-slate-400">
                {item.group === 'tasks' ? 'مهمة' : item.group === 'navigate' ? 'تنقل' : 'أمر'}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-[#eef2f7] px-4 py-2 text-[10px] text-slate-400 dark:border-slate-800">
          <span className="inline-flex items-center gap-1"><kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">↑</kbd><kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">↓</kbd> تنقل</span>
          <span className="inline-flex items-center gap-1"><kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">Enter</kbd> تنفيذ</span>
          <span className="mr-auto">{kernel.toolCatalogue().length} أداة</span>
        </div>
      </div>
    </div>
  );
}
