/**
 * Tab 1 — tasks & notes workspace: quick add with light NLP, filter pills,
 * inline checklist, edit/delete and page linking.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  completeTask,
  createTask,
  deleteTask,
  filterCounts,
  isNote,
  isToday,
  labelName,
  loadData,
  parseQuickAdd,
  projectName,
  resolveProjectId,
  sortTasks,
  sourceUrl,
  toggleChecklistItem,
  todayISO,
  updateTask,
  type KernelData,
  type TaskRow,
} from '../lib/tasks';
import { getActiveTab, type ActiveTab } from '../lib/browser';

type FilterKey = 'all' | 'today' | 'inbox' | 'notes' | 'projects';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'today', label: 'اليوم' },
  { key: 'inbox', label: 'الوارد' },
  { key: 'notes', label: 'الملاحظات' },
  { key: 'projects', label: 'المشاريع' },
];

interface Props {
  refreshKey: number;
  onChanged: () => void;
  counts: { all: number; today: number; inbox: number; notes: number; projects: number };
}

function formatDue(task: TaskRow): string {
  if (!task.dueDate) return '';
  const today = todayISO();
  if (task.dueDate === today) return 'اليوم';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  if (task.dueDate === iso) return 'غداً';
  return task.dueDate.slice(5);
}

export default function TasksTab({ refreshKey, onChanged, counts }: Props) {
  const [data, setData] = useState<KernelData>({ tasks: [], projects: [], labels: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [quickText, setQuickText] = useState('');
  const [mode, setMode] = useState<'task' | 'note'>('task');
  const [priority, setPriority] = useState(4);
  const [projectId, setProjectId] = useState('');
  const [linkPage, setLinkPage] = useState(true);
  const [page, setPage] = useState<ActiveTab | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await loadData();
      setData(next);
      setError('');
      if (!projectFilter && next.projects.length) {
        setProjectFilter(next.projects.find((project) => !project.isInbox)?.id ?? next.projects[0]!.id);
      }
    } catch (err) {
      setError(`تعذر تحميل المهام: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [projectFilter]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (!linkPage) return;
    getActiveTab().then((tab) => {
      if (tab && /^https?:/.test(tab.url ?? '')) setPage(tab);
    });
  }, [linkPage]);

  const projects = data.projects;
  const notesCount = useMemo(() => data.tasks.filter((task) => isNote(task, data.labels)).length, [data]);

  const visible = useMemo(() => {
    const filtered = data.tasks.filter((task) => {
      if (filter === 'today') return isToday(task);
      if (filter === 'notes') return isNote(task, data.labels);
      if (filter === 'inbox') {
        const project = data.projects.find((row) => row.id === task.projectId);
        return task.projectId === '__inbox' || Boolean(project?.isInbox);
      }
      if (filter === 'projects') {
        const project = data.projects.find((row) => row.id === task.projectId);
        if (project?.isInbox) return false;
        return projectFilter ? task.projectId === projectFilter : true;
      }
      return true;
    });
    return sortTasks(filtered);
  }, [data, filter, projectFilter]);

  const refreshAll = async () => {
    await load();
    onChanged();
  };

  const addQuick = async () => {
    const raw = quickText.trim();
    if (!raw || saving) return;
    setSaving(true);
    setError('');
    try {
      const parsed = parseQuickAdd(raw, priority);
      const descriptionParts: string[] = [];
      if (linkPage && page?.url) {
        descriptionParts.push(`${page.title || page.url}\n${page.url}`);
      }
      const targetProject =
        projectId || resolveProjectId(projects, parsed.projectName) || undefined;
      await createTask({
        content: mode === 'note' ? `📝 ${parsed.content}` : parsed.content,
        description: descriptionParts.join('\n\n') || undefined,
        priority: parsed.priority,
        dueDate: parsed.dueDate,
        projectId: targetProject,
        labelNames: [...(mode === 'note' ? ['ملاحظة'] : []), ...parsed.labels],
      });
      setQuickText('');
      await refreshAll();
    } catch (err) {
      setError(`تعذر الإضافة: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleComplete = async (task: TaskRow) => {
    setBusyId(task.id);
    try {
      await completeTask(task.id, !task.isCompleted);
      await refreshAll();
    } catch (err) {
      setError(`تعذر التحديث: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleItem = async (task: TaskRow, itemId: string) => {
    setBusyId(task.id);
    try {
      const checklist = await toggleChecklistItem(task, itemId);
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks.map((row) => (row.id === task.id ? { ...row, checklist } : row)),
      }));
    } catch (err) {
      setError(`تعذر تحديث التشيك بوكس: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (task: TaskRow) => {
    const content = editText.trim();
    if (!content) return;
    try {
      await updateTask(task.id, { content });
      setEditingId(null);
      await refreshAll();
    } catch (err) {
      setError(`تعذر التعديل: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const remove = async (task: TaskRow) => {
    if (!window.confirm(`حذف «${task.content}»؟`)) return;
    try {
      await deleteTask(task.id);
      await refreshAll();
    } catch (err) {
      setError(`تعذر الحذف: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <>
      <section className="card quick-add-card">
        <div className="qa-row">
          <input
            className="input qa-input"
            placeholder="أضف مهمة… مثال: راجع التقرير p2 #عمل @مهم !today"
            value={quickText}
            onChange={(event) => setQuickText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addQuick();
            }}
          />
          <button className="btn btn-primary" onClick={addQuick} disabled={saving || !quickText.trim()}>
            {saving ? '…' : 'إضافة'}
          </button>
        </div>
        <div className="qa-options">
          <div className="segmented">
            <button className={mode === 'task' ? 'active' : ''} onClick={() => setMode('task')}>مهمة</button>
            <button className={mode === 'note' ? 'active' : ''} onClick={() => setMode('note')}>ملاحظة</button>
          </div>
          <select className="select" value={priority} onChange={(event) => setPriority(Number(event.target.value))} title="الأولوية">
            {[1, 2, 3, 4].map((level) => (
              <option key={level} value={level}>{PRIORITY_LABELS[level]} {level === 1 ? 'ضروري' : level === 2 ? 'عاجل' : level === 3 ? 'مهم' : 'عادي'}</option>
            ))}
          </select>
          <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)} title="المشروع">
            <option value="">الوارد</option>
            {projects.filter((project) => !project.isInbox).map((project) => (
              <option key={project.id} value={project.id}>{projectName(project)}</option>
            ))}
          </select>
          <button
            className={`link-page-btn ${linkPage ? 'on' : ''}`}
            onClick={() => setLinkPage((value) => !value)}
            title={page?.url ?? 'اربط الصفحة الحالية بالمهمة'}
          >
            🔗 {linkPage ? 'الصفحة مربوطة' : 'ربط الصفحة الحالية'}
          </button>
        </div>
      </section>

      {error && <div className="toast-inline err">{error}</div>}

      <div className="filter-scroll">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            className={`filter-pill ${filter === item.key ? 'active' : ''}`}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
            <span className="count">{counts[item.key]}</span>
          </button>
        ))}
      </div>

      {filter === 'projects' && (
        <select className="select" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{projectName(project)}</option>
          ))}
        </select>
      )}

      <div className="task-list">
        {loading && <div className="empty-state"><span className="spinner" /></div>}
        {!loading && visible.length === 0 && (
          <div className="empty-state">لا توجد عناصر هنا بعد — أضف مهمة أو احفظ تحديداً من أي صفحة.</div>
        )}
        {visible.map((task) => {
          const note = isNote(task, data.labels);
          const project = data.projects.find((row) => row.id === task.projectId);
          const url = sourceUrl(task);
          const checklist = task.checklist ?? [];
          const checked = checklist.filter((item) => item.checked).length;
          const isOpen = Boolean(expanded[task.id]);
          const due = formatDue(task);
          const overdue = Boolean(task.dueDate && task.dueDate < todayISO() && !task.isCompleted);
          return (
            <article key={task.id} className={`task-card ${task.isCompleted ? 'completed' : ''}`}>
              <button
                className={`task-check ${task.isCompleted ? 'checked' : ''}`}
                onClick={() => toggleComplete(task)}
                disabled={busyId === task.id}
                title={task.isCompleted ? 'إرجاع كغير مكتملة' : 'إكمال المهمة'}
              >
                {task.isCompleted ? '✓' : ''}
              </button>
              <div className="task-body">
                {editingId === task.id ? (
                  <div className="edit-row">
                    <input className="input" value={editText} onChange={(event) => setEditText(event.target.value)} autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveEdit(task);
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                    />
                    <button className="btn btn-blue btn-sm" onClick={() => saveEdit(task)}>حفظ</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>✕</button>
                  </div>
                ) : (
                  <div className={`task-title ${task.isCompleted ? 'done' : ''}`}>{task.content}</div>
                )}

                <div className="task-meta">
                  {!note && (
                    <span className={`priority-pill p${task.priority}`} style={{ color: PRIORITY_COLORS[task.priority] }}>
                      {PRIORITY_LABELS[task.priority] ?? 'P4'}
                    </span>
                  )}
                  {note && <span className="badge badge-note">#ملاحظة</span>}
                  {project && <span className="badge" style={{ color: project.color, borderColor: `${project.color}55` }}>{projectName(project)}</span>}
                  {due && (
                    <span className={`badge ${overdue ? 'badge-overdue' : isToday(task) ? 'badge-today' : ''}`}>
                      📅 {due}{task.dueTime ? ` · ${task.dueTime}` : ''}
                    </span>
                  )}
                  {task.isCompleted && <span className="badge badge-done">مكتملة</span>}
                  {checklist.length > 0 && (
                    <button className="checklist-toggle" onClick={() => setExpanded((prev) => ({ ...prev, [task.id]: !prev[task.id] }))}>
                      ☑️ {checked}/{checklist.length} {isOpen ? '▲' : '▼'}
                    </button>
                  )}
                  {url && (
                    <a className="source-link" href={url} target="_blank" rel="noreferrer">🔗 المصدر</a>
                  )}
                </div>

                {task.description && !task.description.startsWith('http') && (
                  <div className="task-note">{task.description.split('\n')[0]}</div>
                )}

                {isOpen && checklist.length > 0 && (
                  <div className="checklist">
                    {checklist.map((item) => (
                      <div key={item.id} className={`checklist-item ${item.checked ? 'done' : ''}`} onClick={() => toggleItem(task, item.id)}>
                        <span className={`checklist-box ${item.checked ? 'checked' : ''}`}>{item.checked ? '✓' : ''}</span>
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="task-actions">
                <button className="mini-btn" title="تعديل" onClick={() => { setEditingId(task.id); setEditText(task.content); }}>✎</button>
                <button className="mini-btn danger" title="حذف" onClick={() => remove(task)}>🗑</button>
              </div>
            </article>
          );
        })}
      </div>

      {notesCount > 0 && filter !== 'notes' && (
        <div className="text-xs muted" style={{ textAlign: 'center' }}>
          {notesCount} ملاحظة محفوظة في مساحة الملاحظات
        </div>
      )}
    </>
  );
}
