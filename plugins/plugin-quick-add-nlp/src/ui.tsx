import { useEffect, useMemo, useState } from 'react';
import type { PluginUiModule } from '@ayatodoist/plugin-sdk';
import { useExecute, useLabels, useLanguage, useProjects, useSections, todayString } from '@ayatodoist/plugin-sdk/react';
import { Button, Icon, Modal, Pill, Select, Toggle, cn } from '@ayatodoist/plugin-sdk/ui';
import { parseQuickAdd, type NlpContext, type ParsedTask } from './parser';

function useNlpContext(): NlpContext {
  const projects = useProjects();
  const sections = useSections();
  const labels = useLabels();
  return useMemo(
    () => ({
      today: todayString(),
      projects: projects.map((project) => ({ id: project.id, name: project.name })),
      sections: sections.map((section) => ({ id: section.id, name: section.name, projectId: section.projectId })),
      labels: labels.map((label) => ({ id: label.id, name: label.name })),
    }),
    [projects, sections, labels],
  );
}

function parsedPills(parsed: ParsedTask, language: 'ar' | 'en') {
  const pills: Array<{ key: string; label: string; tone: 'blue' | 'green' | 'amber' | 'purple' | 'rose' | 'cyan'; icon: string }> = [];
  if (parsed.dueDate) pills.push({ key: 'date', label: parsed.dueDate, tone: 'blue', icon: 'calendar' });
  if (parsed.dueTime) pills.push({ key: 'time', label: parsed.dueTime, tone: 'cyan', icon: 'clock' });
  if (parsed.priority) pills.push({ key: 'priority', label: `P${parsed.priority}`, tone: 'rose', icon: 'flag' });
  if (parsed.projectName) pills.push({ key: 'project', label: parsed.projectName, tone: 'amber', icon: 'folder' });
  if (parsed.recurrence) pills.push({ key: 'recurrence', label: parsed.recurrence.text, tone: 'purple', icon: 'repeat' });
  if (parsed.deadline) pills.push({ key: 'deadline', label: parsed.deadline, tone: 'rose', icon: 'alert' });
  for (const label of parsed.labelNames) pills.push({ key: `label-${label}`, label: `@${label}`, tone: 'green', icon: 'tag' });
  if (pills.length === 0) {
    pills.push({ key: 'hint', label: language === 'ar' ? 'اكتب «غدًا 3م #مشروع p1»' : 'Try “tomorrow 3pm #project p1”', tone: 'green', icon: 'sparkles' });
  }
  return pills;
}

/** Quick Add: type naturally, the local parser turns phrases into fields. */
export function QuickAddModal({
  open,
  onClose,
  defaultProjectId,
  initialText,
}: {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string | null;
  initialText?: string;
}) {
  const language = useLanguage();
  const projects = useProjects();
  const run = useExecute();
  const ctx = useNlpContext();
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId ?? '__inbox');
  const [priority, setPriority] = useState(4);
  const [checklistMode, setChecklistMode] = useState(false);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseQuickAdd(text, ctx), [text, ctx]);

  useEffect(() => {
    if (open) {
      setText(initialText ?? '');
      setPriority(4);
      setChecklistMode(false);
      if (defaultProjectId) setProjectId(defaultProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProjectId, initialText]);

  useEffect(() => {
    if (parsed.priority) setPriority(parsed.priority);
  }, [parsed.priority]);

  useEffect(() => {
    if (parsed.projectId) setProjectId(parsed.projectId);
  }, [parsed.projectId]);

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const submit = async () => {
    if (busy) return;
    const title = checklistMode ? lines[0] ?? parsed.title : parsed.title || text;
    if (!title.trim()) return;
    setBusy(true);
    const created = await run<{ id: string }>('task.create', {
      content: title.trim(),
      projectId,
      priority,
      dueDate: parsed.dueDate ?? undefined,
      dueTime: parsed.dueTime ?? undefined,
      deadline: parsed.deadline ?? undefined,
      durationMinutes: parsed.durationMinutes ?? undefined,
      labelNames: parsed.labelNames,
      recurrence: parsed.recurrence ?? undefined,
    });
    if (created?.id && checklistMode && lines.length > 1) {
      await run('checklist.setItems', {
        taskId: created.id,
        items: lines.map((line, index) => ({ id: `chk-${Date.now()}-${index}`, text: line, checked: false })),
      });
    }
    setBusy(false);
    setText('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={language === 'ar' ? 'إضافة مهمة سريعة' : 'Quick add task'}
      subtitle={language === 'ar' ? 'التحليل يعمل محليًا — لا يخرج النص من جهازك' : 'Parsing runs locally — your text never leaves the device'}
      icon="wand"
      width={640}
      footer={
        <>
          <span className="mr-auto hidden items-center gap-1 text-[10.5px] text-slate-400 sm:flex">
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800">Enter</kbd>
            {language === 'ar' ? 'لإضافة المهمة' : 'to add'}
          </span>
          <Button variant="soft" onClick={onClose}>
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button variant="primary" icon="plus" disabled={!text.trim() || busy} onClick={() => void submit()}>
            {language === 'ar' ? 'إضافة' : 'Add task'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <textarea
          autoFocus
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setChecklistMode(event.target.value.includes('\n'));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && text.trim()) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={checklistMode ? 5 : 2}
          placeholder={
            language === 'ar'
              ? 'مثال: مراجعة التقرير غدًا الساعة 3 عصرًا #العمل p1 @مهم'
              : 'e.g. Review the report tomorrow at 3pm #Work p1 @important'
          }
          className="w-full resize-none rounded-[10px] border border-[#e2e8f0] bg-white px-3 py-2.5 text-[14px] leading-6 text-slate-800 placeholder:text-slate-400 focus:border-[#1e78ff] focus:outline-none focus:ring-2 focus:ring-[#1e78ff]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {parsedPills(parsed, language).map((pill) => (
            <span
              key={pill.key}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold',
                pill.tone === 'blue' && 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
                pill.tone === 'green' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
                pill.tone === 'amber' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
                pill.tone === 'purple' && 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
                pill.tone === 'rose' && 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
                pill.tone === 'cyan' && 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
              )}
            >
              <Icon name={pill.icon} size={11} />
              {pill.label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">{language === 'ar' ? 'المشروع' : 'Project'}</span>
            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={language === 'ar' ? 'المشروع' : 'Project'}>
              <option value="__inbox">{language === 'ar' ? 'الوارد' : 'Inbox'}</option>
              {projects
                .filter((project) => project.id !== '__inbox')
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">{language === 'ar' ? 'الأولوية' : 'Priority'}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPriority(value)}
                  className={cn(
                    'flex h-9 flex-1 items-center justify-center gap-1 rounded-[8px] border text-[11px] font-semibold transition-colors',
                    priority === value
                      ? 'border-transparent bg-[#132238] text-white'
                      : 'border-[#e2e8f0] bg-white text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                  )}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: value === 1 ? '#f43f5e' : value === 2 ? '#f59e0b' : value === 3 ? '#2563eb' : '#94a3b8' }}
                  />
                  P{value}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[9px] border border-[#e2e8f0] bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-white text-slate-500 shadow-sm dark:bg-slate-900">
              <Icon name="checklist" size={14} />
            </span>
            <div>
              <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">{language === 'ar' ? 'وضع القائمة' : 'Checklist mode'}</p>
              <p className="text-[10.5px] text-slate-400">{language === 'ar' ? 'كل سطر يصبح بندًا داخل المهمة' : 'Each line becomes a checklist item'}</p>
            </div>
          </div>
          <Toggle checked={checklistMode} onChange={setChecklistMode} label={language === 'ar' ? 'وضع القائمة' : 'Checklist mode'} />
        </div>

        {checklistMode && lines.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            <Pill tone="green">
              {lines.length} {language === 'ar' ? 'بند' : 'items'}
            </Pill>
            {parsed.dueDate ? <Pill tone="blue">{parsed.dueDate}</Pill> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export const quickAddUi: PluginUiModule = { id: 'quick-add-nlp' };
