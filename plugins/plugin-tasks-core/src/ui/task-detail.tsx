import { useEffect, useState } from 'react';
import type { Task } from '@ayatodoist/core-kernel';
import { useExecute, useKernel, useKernelVersion, useLabels, useLanguage, useProjects } from '@ayatodoist/plugin-sdk/react';
import { Button, Icon, Modal, Pill, TextField, cn } from '@ayatodoist/plugin-sdk/ui';
import { PRIORITY_META, formatDue } from './helpers';

/** Task detail: inline edit of title, priority, schedule and checklist. */
export function TaskDetail({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const kernel = useKernel();
  useKernelVersion();
  const language = useLanguage();
  const projects = useProjects();
  const labels = useLabels();
  const run = useExecute();
  const task = taskId ? (kernel.store.get('tasks', taskId) as Task | null) : null;

  const [content, setContent] = useState(task?.content ?? '');
  const [priority, setPriority] = useState(task?.priority ?? 4);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');
  const [newItem, setNewItem] = useState('');

  useEffect(() => {
    setContent(task?.content ?? '');
    setPriority(task?.priority ?? 4);
    setDueDate(task?.dueDate ?? '');
    setDueTime(task?.dueTime ?? '');
    setNewItem('');
  }, [taskId, task?.content, task?.priority, task?.dueDate, task?.dueTime]);

  if (!task) return null;
  const project = projects.find((item) => item.id === task.projectId);
  const checked = task.checklist.filter((item) => item.checked).length;

  const save = async () => {
    if (!content.trim()) return;
    await run('task.update', {
      id: task.id,
      content: content.trim(),
      priority,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
    });
    onClose();
  };

  return (
    <Modal
      open={Boolean(taskId)}
      onClose={onClose}
      title={language === 'ar' ? 'تفاصيل المهمة' : 'Task details'}
      subtitle={project ? `${project.name} · ${formatDue(task, language) || 'بدون تاريخ'}` : undefined}
      icon="clipboard"
      width={620}
      footer={
        <>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => {
              void run('task.delete', { id: task.id });
              onClose();
            }}
          >
            حذف
          </Button>
          <Button variant="soft" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" icon="save" onClick={() => void save()}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">عنوان المهمة</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={2}
            className="w-full resize-none rounded-[8px] border border-[#e2e8f0] bg-white px-3 py-2 text-[14px] font-semibold text-slate-800 focus:border-[#1e78ff] focus:outline-none focus:ring-2 focus:ring-[#1e78ff]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">التاريخ</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="h-9 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2 text-[12.5px] text-slate-800 focus:border-[#1e78ff] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">الوقت</span>
            <input
              type="time"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              className="h-9 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2 text-[12.5px] text-slate-800 focus:border-[#1e78ff] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">الأولوية</span>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4].map((value) => {
              const meta = PRIORITY_META[value]!;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPriority(value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                    priority === value ? 'border-transparent bg-[#132238] text-white' : 'border-[#e2e8f0] bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: value === 1 ? '#f43f5e' : value === 2 ? '#f59e0b' : value === 3 ? '#2563eb' : '#94a3b8' }} />
                  {language === 'ar' ? meta.ar : meta.en}
                </button>
              );
            })}
          </div>
        </div>

        {task.description ? (
          <div>
            <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">الوصف</span>
            <p className="whitespace-pre-wrap rounded-[8px] bg-slate-50 px-3 py-2 text-[12.5px] leading-6 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {task.description}
            </p>
          </div>
        ) : null}

        {task.labels.length > 0 ? (
          <div>
            <span className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">التصنيفات</span>
            <div className="flex flex-wrap gap-1.5">
              {task.labels.map((labelId) => {
                const label = labels.find((item) => item.id === labelId);
                if (!label) return null;
                return (
                  <Pill key={labelId} tone="purple">
                    <Icon name="tag" size={10} />
                    {label.name}
                  </Pill>
                );
              })}
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-slate-500">
              قائمة التحقق {task.checklist.length ? `· ${checked}/${task.checklist.length}` : ''}
            </span>
          </div>
          <div className="space-y-1">
            {task.checklist.map((item) => (
              <div key={item.id} className="group flex items-center gap-2 rounded-[7px] px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <button
                  type="button"
                  onClick={() => void run('checklist.toggle', { taskId: task.id, itemId: item.id })}
                  aria-label="تبديل البند"
                  className={cn(
                    'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                    item.checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400',
                  )}
                >
                  <Icon name="check" size={10} strokeWidth={3} />
                </button>
                <span className={cn('flex-1 text-[12.5px]', item.checked ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200')}>{item.text}</span>
                <button
                  type="button"
                  onClick={() => void run('checklist.removeItem', { taskId: task.id, itemId: item.id })}
                  aria-label="حذف البند"
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <TextField
              value={newItem}
              onChange={(event) => setNewItem(event.target.value)}
              placeholder="إضافة بند…"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newItem.trim()) {
                  event.preventDefault();
                  void run('checklist.addItem', { taskId: task.id, text: newItem.trim() });
                  setNewItem('');
                }
              }}
            />
            <Button
              variant="soft"
              icon="plus"
              onClick={() => {
                if (!newItem.trim()) return;
                void run('checklist.addItem', { taskId: task.id, text: newItem.trim() });
                setNewItem('');
              }}
            >
              إضافة
            </Button>
          </div>
        </div>

        {task.attachments.length > 0 ? (
          <div>
            <span className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">المرفقات</span>
            <div className="flex flex-wrap gap-2">
              {task.attachments.map((name) => (
                <a
                  key={name}
                  href={`/api/v1/uploads/${encodeURIComponent(name)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-[7px] border border-[#e2e8f0] bg-slate-50 px-2 py-1 text-[11.5px] text-slate-600 hover:border-[#1e78ff] hover:text-[#1e78ff] dark:border-slate-700 dark:bg-slate-800"
                >
                  <Icon name="image" size={12} />
                  {name}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
