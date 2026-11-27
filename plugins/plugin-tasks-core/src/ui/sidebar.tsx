import { useState } from 'react';
import type { Project } from '@ayatodoist/core-kernel';
import { useExecute, useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Icon, cn } from '@ayatodoist/plugin-sdk/ui';

/** Sidebar project row with its colour dot and open-task count. */
export function SidebarProjectRow({
  project,
  active,
  count,
  onClick,
}: {
  project: Project;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-[12.5px] transition-colors',
        active ? 'bg-[#1e78ff] font-semibold text-white shadow-[0_6px_16px_-10px_rgba(30,120,255,.9)]' : 'text-slate-300/90 hover:bg-white/10 hover:text-white',
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full ring-2 ring-white/10" style={{ background: active ? '#ffffff' : project.color }} />
      <span className="min-w-0 flex-1 truncate text-left">{project.isInbox ? 'الوارد' : project.name}</span>
      {count > 0 ? (
        <span className={cn('text-[10.5px] tabular-nums', active ? 'text-white/80' : 'text-slate-400/80')}>{count}</span>
      ) : null}
    </button>
  );
}

/** Sidebar saved-filter row. */
export function SidebarFilterRow({ name, color, active, onClick }: { name: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-[12.5px] transition-colors',
        active ? 'bg-[#1e78ff] font-semibold text-white' : 'text-slate-300/90 hover:bg-white/10 hover:text-white',
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: active ? '#ffffff' : color }} />
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
    </button>
  );
}

/** Minimal inline composer used under a project list. */
export function InlineAddBar({ projectId, placeholder }: { projectId: string; placeholder?: string }) {
  const language = useLanguage();
  const run = useExecute();
  const [value, setValue] = useState('');

  const submit = () => {
    const content = value.trim();
    if (!content) return;
    void run('task.create', { content, projectId });
    setValue('');
  };

  return (
    <div className="flex items-center gap-2 border-t border-[#eef2f7] px-4 py-2.5 dark:border-slate-800">
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-slate-300 text-slate-400">
        <Icon name="plus" size={10} />
      </span>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
        placeholder={placeholder ?? (language === 'ar' ? 'أضف مهمة ثم Enter…' : 'Add a task then Enter…')}
        className="h-7 flex-1 bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-200"
      />
      {value.trim() ? (
        <button type="button" onClick={submit} className="rounded-[6px] bg-[#1e78ff] px-2 py-1 text-[11px] font-semibold text-white">
          {language === 'ar' ? 'إضافة' : 'Add'}
        </button>
      ) : null}
    </div>
  );
}
