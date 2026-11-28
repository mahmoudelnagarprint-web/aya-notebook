import { useState, type ReactNode } from 'react';
import type { Task } from '@ayatodoist/core-kernel';
import { useKernel, useKernelVersion, useLanguage, useProjects } from '@ayatodoist/plugin-sdk/react';
import { Button, Card, EmptyState, Icon, SectionHeading, cn, type Tone } from '@ayatodoist/plugin-sdk/ui';
import { TaskRow } from './task-row';
import { TaskDetail } from './task-detail';
import { isOverdue, sortTasks, useTaskBuckets } from './helpers';

interface ViewProps {
  onAddTask?: () => void;
}

function ListCard({ children }: { children: ReactNode }) {
  return <Card className="overflow-hidden">{children}</Card>;
}

function ViewShell({
  title,
  subtitle,
  icon,
  tone,
  count,
  onAddTask,
  children,
  aside,
}: {
  title: string;
  subtitle?: string;
  icon: string;
  tone: Tone;
  count?: number;
  onAddTask?: () => void;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const language = useLanguage();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title={title}
          subtitle={subtitle}
          icon={icon}
          tone={tone}
          action={
            count !== undefined ? (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                {count}
              </span>
            ) : undefined
          }
        />
        <div className="flex items-center gap-2">
          {aside}
          {onAddTask ? (
            <Button variant="primary" icon="plus" onClick={onAddTask}>
              {language === 'ar' ? 'إضافة مهمة' : 'Add task'}
            </Button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export function TaskList({
  tasks,
  emptyTitle,
  emptyBody,
  onOpen,
  onAddTask,
  compact,
}: {
  tasks: Task[];
  emptyTitle: string;
  emptyBody?: string;
  onOpen: (id: string) => void;
  onAddTask?: () => void;
  compact?: boolean;
}) {
  const projects = useProjects();
  const language = useLanguage();
  if (tasks.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="checkCircle"
          title={emptyTitle}
          body={emptyBody}
          action={onAddTask ? <Button variant="soft" icon="plus" onClick={onAddTask}>{language === 'ar' ? 'أضف مهمة' : 'Add a task'}</Button> : undefined}
        />
      </Card>
    );
  }
  return (
    <ListCard>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} project={projects.find((project) => project.id === task.projectId)} onOpen={onOpen} compact={compact} />
      ))}
    </ListCard>
  );
}

export function InboxView({ onAddTask }: ViewProps) {
  const language = useLanguage();
  const { inbox } = useTaskBuckets();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ViewShell
      title={language === 'ar' ? 'الوارد' : 'Inbox'}
      subtitle={language === 'ar' ? 'كل ما لم يُسند إلى مشروع بعد' : 'Everything not yet assigned to a project'}
      icon="inbox"
      tone="blue"
      count={inbox.length}
      onAddTask={onAddTask}
    >
      <TaskList
        tasks={sortTasks(inbox)}
        emptyTitle={language === 'ar' ? 'الوارد صافٍ تمامًا' : 'Inbox zero'}
        emptyBody={language === 'ar' ? 'أضف أول مهمة وستظهر هنا فورًا. Aya يمكنها إنشاؤها لك أيضًا.' : 'Add your first task and it appears here instantly. Aya can create it for you too.'}
        onOpen={setSelected}
        onAddTask={onAddTask}
      />
      <TaskDetail taskId={selected} onClose={() => setSelected(null)} />
    </ViewShell>
  );
}

export function TodayView({ onAddTask }: ViewProps) {
  const language = useLanguage();
  const { today, overdue } = useTaskBuckets();
  const [selected, setSelected] = useState<string | null>(null);
  const tasks = sortTasks([...overdue, ...today]);
  return (
    <ViewShell
      title={language === 'ar' ? 'اليوم' : 'Today'}
      subtitle={language === 'ar' ? 'مهام اليوم والمتأخرة' : 'Today’s tasks plus anything overdue'}
      icon="today"
      tone="purple"
      count={tasks.length}
      onAddTask={onAddTask}
    >
      {overdue.length > 0 ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-rose-100 bg-rose-50/70 px-3 py-2 text-[11.5px] font-semibold text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          <Icon name="alert" size={14} />
          {language === 'ar' ? `${overdue.length} مهمة متأخرة تحتاج قرارًا` : `${overdue.length} overdue task(s) need a decision`}
        </div>
      ) : null}
      <TaskList
        tasks={tasks}
        emptyTitle={language === 'ar' ? 'لا مهام اليوم' : 'Nothing due today'}
        emptyBody={language === 'ar' ? 'استمتع بصفاء اليوم، أو خطط لمهمة قادمة.' : 'Enjoy the clear day, or plan something ahead.'}
        onOpen={setSelected}
        onAddTask={onAddTask}
      />
      <TaskDetail taskId={selected} onClose={() => setSelected(null)} />
    </ViewShell>
  );
}

export function UpcomingView({ onAddTask }: ViewProps) {
  const language = useLanguage();
  const { upcoming } = useTaskBuckets();
  const [selected, setSelected] = useState<string | null>(null);
  const groups = new Map<string, Task[]>();
  for (const task of sortTasks(upcoming)) {
    const key = task.dueDate ?? '';
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return (
    <ViewShell
      title={language === 'ar' ? 'القادمة' : 'Upcoming'}
      subtitle={language === 'ar' ? 'الأيام السبعة القادمة' : 'The next seven days'}
      icon="upcoming"
      tone="amber"
      count={upcoming.length}
      onAddTask={onAddTask}
    >
      {groups.size === 0 ? (
        <TaskList tasks={[]} emptyTitle={language === 'ar' ? 'لا شيء قادم هذا الأسبوع' : 'Nothing upcoming this week'} onOpen={setSelected} onAddTask={onAddTask} />
      ) : (
        <div className="space-y-3">
          {[...groups.entries()].map(([day, tasks]) => (
            <div key={day}>
              <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{day}</p>
              <TaskList tasks={tasks} emptyTitle="" onOpen={setSelected} />
            </div>
          ))}
        </div>
      )}
      <TaskDetail taskId={selected} onClose={() => setSelected(null)} />
    </ViewShell>
  );
}

export function ProjectView({ projectId, onAddTask }: ViewProps & { projectId: string }) {
  const kernel = useKernel();
  useKernelVersion();
  const language = useLanguage();
  const projects = useProjects();
  const project = findProjectById(projects, projectId);
  const tasks = sortTasks(kernel.store.list('tasks').filter((task) => task.projectId === projectId && !task.deletedAt));
  const [selected, setSelected] = useState<string | null>(null);
  const open = tasks.filter((task) => !task.isCompleted);
  const done = tasks.filter((task) => task.isCompleted);
  return (
    <ViewShell
      title={project?.name ?? (language === 'ar' ? 'مشروع' : 'Project')}
      subtitle={language === 'ar' ? `${open.length} مفتوحة · ${done.length} منجزة` : `${open.length} open · ${done.length} completed`}
      icon="folder"
      tone="cyan"
      count={open.length}
      onAddTask={onAddTask}
    >
      <TaskList tasks={open} emptyTitle={language === 'ar' ? 'لا مهام في هذا المشروع' : 'No tasks in this project'} onOpen={setSelected} onAddTask={onAddTask} />
      {done.length > 0 ? (
        <div>
          <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{language === 'ar' ? 'المنجز' : 'Completed'}</p>
          <TaskList tasks={done} emptyTitle="" onOpen={setSelected} compact />
        </div>
      ) : null}
      <TaskDetail taskId={selected} onClose={() => setSelected(null)} />
    </ViewShell>
  );
}

export function CompletedView() {
  const language = useLanguage();
  const { completed } = useTaskBuckets();
  const [selected, setSelected] = useState<string | null>(null);
  const sorted = [...completed].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return (
    <ViewShell
      title={language === 'ar' ? 'المنجز' : 'Completed'}
      subtitle={language === 'ar' ? 'سجل الإنجاز الكامل' : 'Your full completion log'}
      icon="checkCircle"
      tone="green"
      count={sorted.length}
    >
      <TaskList tasks={sorted} emptyTitle={language === 'ar' ? 'لم تُنجز مهامًا بعد' : 'Nothing completed yet'} onOpen={setSelected} />
      <TaskDetail taskId={selected} onClose={() => setSelected(null)} />
    </ViewShell>
  );
}

export function LabelView({ labelName }: { labelName: string }) {
  const language = useLanguage();
  const { all } = useTaskBuckets();
  const [selected, setSelected] = useState<string | null>(null);
  const tasks = sortTasks(all.filter((task) => !task.isCompleted && task.labels.includes(labelName)));
  return (
    <ViewShell title={`@${labelName}`} subtitle={language === 'ar' ? 'مهام هذا التصنيف' : 'Tasks with this label'} icon="tag" tone="purple" count={tasks.length}>
      <TaskList tasks={tasks} emptyTitle={language === 'ar' ? 'لا مهام بهذا التصنيف' : 'No tasks with this label'} onOpen={setSelected} />
      <TaskDetail taskId={selected} onClose={() => setSelected(null)} />
    </ViewShell>
  );
}

/** Ad-hoc list used by search results and saved filters. */
export function TaskResultsView({ tasks, title, subtitle, tone = 'blue' }: { tasks: Task[]; title: string; subtitle?: string; tone?: Tone }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <SectionHeading title={title} subtitle={subtitle} icon="search" tone={tone} />
      <TaskList tasks={sortTasks(tasks)} emptyTitle="لا توجد نتائج" onOpen={setSelected} />
      <TaskDetail taskId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/** Matches a project by id with tolerant string/number coercion. */
function findProjectById(projects: Array<{ id: string | number | null | undefined; name?: string | null }>, projectId: string | null | undefined): { id: string; name?: string | null } | null {
  if (!projectId) return null;
  const target = String(projectId);
  for (const project of projects) {
    if (project && String(project.id) === target) return project as { id: string; name?: string | null };
  }
  return null;
}
