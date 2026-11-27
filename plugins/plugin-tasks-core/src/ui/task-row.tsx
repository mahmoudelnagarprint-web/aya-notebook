import { useState } from 'react';
import type { Project, Task } from '@ayatodoist/core-kernel';
import { useExecute, useLanguage, useSettings } from '@ayatodoist/plugin-sdk/react';
import { Icon, Pill, Progress, cn } from '@ayatodoist/plugin-sdk/ui';
import { formatDue, isOverdue, priorityMeta } from './helpers';

/**
 * One task row: complete toggle, tinted priority flag, meta pills and inline
 * checklist/attachment indicators. The whole row is a button that opens detail.
 */
export function TaskRow({
  task,
  project,
  onOpen,
  compact = false,
}: {
  task: Task;
  project?: Project | null;
  onOpen?: (taskId: string) => void;
  compact?: boolean;
}) {
  const language = useLanguage();
  const settings = useSettings();
  const run = useExecute();
  const [busy, setBusy] = useState(false);
  const priority = priorityMeta(task.priority);
  const checked = task.checklist.filter((item) => item.checked).length;
  const total = task.checklist.length;
  const overdue = isOverdue(task);

  const toggle = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    await run('task.complete', { id: task.id, completed: !task.isCompleted });
    setBusy(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.(task.id);
        }
      }}
      className={cn(
        'group flex cursor-pointer items-start gap-3 border-b border-[#eef2f7] px-4 transition-colors last:border-b-0 hover:bg-[#f8fafc] dark:border-slate-800 dark:hover:bg-slate-800/40',
        compact ? 'py-2' : 'py-3',
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={task.isCompleted ? 'إعادة فتح المهمة' : 'إكمال المهمة'}
        aria-pressed={task.isCompleted}
        disabled={busy}
        className={cn(
          'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
          task.isCompleted
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : task.priority === 1
              ? 'border-rose-400 text-transparent hover:border-rose-500 hover:bg-rose-50'
              : 'border-slate-300 text-transparent hover:border-[#1e78ff] hover:bg-blue-50 dark:border-slate-600',
        )}
      >
        <Icon name="check" size={11} strokeWidth={3} />
      </button>

      <span
        className={cn('mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px]', priority.tone === 'rose' && 'bg-rose-50 text-rose-500 dark:bg-rose-500/15 dark:text-rose-300', priority.tone === 'amber' && 'bg-amber-50 text-amber-500 dark:bg-amber-500/15 dark:text-amber-300', priority.tone === 'blue' && 'bg-blue-50 text-blue-500 dark:bg-blue-500/15 dark:text-blue-300', priority.tone === 'slate' && 'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500')}
        title={language === 'ar' ? priority.ar : priority.en}
      >
        <Icon name="flag" size={12} />
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn('flex items-center gap-2 text-[13.5px] leading-5', task.isCompleted ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100')}>
          <span className="truncate">{task.content}</span>
          {task.recurrence ? <Icon name="repeat" size={12} className="shrink-0 text-slate-400" /> : null}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {project ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
              {project.name}
            </span>
          ) : null}

          {task.dueDate ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                overdue ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              <Icon name="calendar" size={11} />
              {formatDue(task, language, settings.display.density === 'comfortable')}
            </span>
          ) : null}

          {task.priority < 4 ? <Pill tone={priority.tone}>{language === 'ar' ? priority.ar : priority.en}</Pill> : null}

          {task.labels.slice(0, 2).map((label) => (
            <span key={label} className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-medium text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
              <Icon name="tag" size={9} />@{label}
            </span>
          ))}

          {total > 0 ? (
            <span className="inline-flex min-w-[74px] items-center gap-1.5 text-[10.5px] text-slate-500">
              <Icon name="checklist" size={11} />
              <Progress value={checked} max={total} tone="green" className="w-10" />
              <span className="tabular-nums">
                {checked}/{total}
              </span>
            </span>
          ) : null}

          {task.attachments.length > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[10.5px] text-slate-500">
              <Icon name="image" size={11} />
              {task.attachments.length}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.(task.id);
          }}
          aria-label="تعديل المهمة"
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700"
        >
          <Icon name="pencil" size={13} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void run('task.delete', { id: task.id });
          }}
          aria-label="حذف المهمة"
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}
