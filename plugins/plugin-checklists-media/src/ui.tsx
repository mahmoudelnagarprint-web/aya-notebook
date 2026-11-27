import { useState } from 'react';
import type { PluginUiModule } from '@ayatodoist/plugin-sdk';
import { useExecute, useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Button, Icon, Progress, TextField, cn } from '@ayatodoist/plugin-sdk/ui';
import type { ChecklistItem } from './checklist-types';

/** Compact n/m progress used inside task rows and detail headers. */
export function ChecklistProgress({ items, showLabel = true }: { items: ChecklistItem[]; showLabel?: boolean }) {
  const done = items.filter((item) => item.checked).length;
  if (items.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Progress value={done} max={items.length} tone={done === items.length ? 'green' : 'blue'} className="w-16" />
      {showLabel ? (
        <span className="text-[10.5px] font-semibold tabular-nums text-slate-500">
          {done}/{items.length}
        </span>
      ) : null}
    </span>
  );
}

/** Inline checklist editor bound to the checklist.* commands. */
export function ChecklistEditor({ taskId, items }: { taskId: string; items: ChecklistItem[] }) {
  const language = useLanguage();
  const run = useExecute();
  const [text, setText] = useState('');
  const done = items.filter((item) => item.checked).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500">
          <Icon name="checklist" size={13} />
          {language === 'ar' ? 'قائمة التحقق' : 'Checklist'}
        </span>
        <span className="text-[10.5px] font-semibold tabular-nums text-slate-400">
          {done}/{items.length}
        </span>
      </div>
      <Progress value={done} max={items.length || 1} tone="green" />
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2 rounded-[6px] px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <button
              type="button"
              aria-label={language === 'ar' ? 'تبديل البند' : 'Toggle item'}
              onClick={() => void run('checklist.toggle', { taskId, itemId: item.id })}
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                item.checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400',
              )}
            >
              <Icon name="check" size={9} strokeWidth={3} />
            </button>
            <span className={cn('flex-1 text-[12px]', item.checked ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200')}>{item.text}</span>
            <button
              type="button"
              aria-label={language === 'ar' ? 'حذف البند' : 'Remove item'}
              onClick={() => void run('checklist.removeItem', { taskId, itemId: item.id })}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-300 opacity-0 hover:text-rose-500 group-hover:opacity-100"
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <TextField
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={language === 'ar' ? 'بند جديد…' : 'New item…'}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && text.trim()) {
              void run('checklist.addItem', { taskId, text: text.trim() });
              setText('');
            }
          }}
        />
        <Button
          variant="soft"
          icon="plus"
          onClick={() => {
            if (!text.trim()) return;
            void run('checklist.addItem', { taskId, text: text.trim() });
            setText('');
          }}
        >
          {language === 'ar' ? 'إضافة' : 'Add'}
        </Button>
      </div>
    </div>
  );
}

/** Read-only attachment thumbnails served by /api/v1/uploads. */
export function AttachmentStrip({ files, onRemove }: { files: string[]; onRemove?: (name: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((name) => (
        <span key={name} className="group relative inline-flex">
          <a
            href={`/api/v1/uploads/${encodeURIComponent(name)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[8px] border border-[#e2e8f0] bg-slate-50 text-slate-400 hover:border-[#1e78ff] dark:border-slate-700 dark:bg-slate-800"
            title={name}
          >
            {/\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? (
              <img src={`/api/v1/uploads/${encodeURIComponent(name)}`} alt={name} className="h-full w-full object-cover" />
            ) : (
              <Icon name="clipboard" size={18} />
            )}
          </a>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(name)}
              aria-label={`إزالة ${name}`}
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Icon name="close" size={9} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export const checklistsUi: PluginUiModule = { id: 'checklists-media' };
