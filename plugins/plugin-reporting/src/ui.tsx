import { useMemo } from 'react';
import type { PluginUiModule } from '@ayatodoist/plugin-sdk';
import type { Project, Task } from '@ayatodoist/core-kernel';
import { addDayString, todayString, useLanguage, useProjects, useTasks } from '@ayatodoist/plugin-sdk/react';
import { Card, Icon, Progress, SectionHeading, cn } from '@ayatodoist/plugin-sdk/ui';

export interface ReportData {
  total: number;
  completed: number;
  open: number;
  overdue: number;
  completionRate: number;
  byPriority: Array<{ priority: number; count: number }>;
  byProject: Array<{ id: string; name: string; color: string; total: number; completed: number }>;
  trend: Array<{ day: string; created: number; completed: number }>;
}

const PRIORITY_COLORS: Record<number, string> = { 1: '#f43f5e', 2: '#f59e0b', 3: '#2563eb', 4: '#94a3b8' };

export function computeReport(tasks: Task[], projects: Project[], days = 14): ReportData {
  const today = todayString();
  const visible = tasks.filter((task) => !task.deletedAt);
  const completed = visible.filter((task) => task.isCompleted);
  const open = visible.filter((task) => !task.isCompleted);
  const overdue = open.filter((task) => task.dueDate !== null && task.dueDate < today);

  const byPriority = [1, 2, 3, 4].map((priority) => ({
    priority,
    count: open.filter((task) => task.priority === priority).length,
  }));

  const byProject = projects
    .map((project) => {
      const rows = visible.filter((task) => task.projectId === project.id);
      return {
        id: project.id,
        name: project.name,
        color: project.color,
        total: rows.length,
        completed: rows.filter((task) => task.isCompleted).length,
      };
    })
    .filter((row) => row.total > 0 || row.id === '__inbox');

  const trend = Array.from({ length: days }, (_, index) => {
    const day = addDayString(today, index - (days - 1));
    return {
      day,
      created: visible.filter((task) => task.createdAt.slice(0, 10) === day).length,
      completed: completed.filter((task) => (task.completedAt ?? '').slice(0, 10) === day).length,
    };
  });

  return {
    total: visible.length,
    completed: completed.length,
    open: open.length,
    overdue: overdue.length,
    completionRate: visible.length === 0 ? 0 : Math.round((completed.length / visible.length) * 100),
    byPriority,
    byProject,
    trend,
  };
}

function smoothPath(values: number[], width: number, height: number): string {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => [index * step, height - (value / max) * (height - 12) - 6] as const);
  if (points.length === 0) return '';
  return points
    .map(([x, y], index) => {
      if (index === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      const [prevX, prevY] = points[index - 1]!;
      const midX = (prevX + x) / 2;
      return `C ${midX.toFixed(1)} ${prevY.toFixed(1)}, ${midX.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** SVG area chart: created vs completed over the last two weeks. */
export function TrendChart({ trend }: { trend: ReportData['trend'] }) {
  const language = useLanguage();
  const width = 620;
  const height = 150;
  const created = trend.map((point) => point.created);
  const completed = trend.map((point) => point.completed);
  const createdPath = smoothPath(created, width, height);
  const completedPath = smoothPath(completed, width, height);

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-4 text-[11px] font-semibold">
        <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full bg-[#1e78ff]" />
          {language === 'ar' ? 'أُنشئت' : 'Created'}
        </span>
        <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {language === 'ar' ? 'أُنجزت' : 'Completed'}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label={language === 'ar' ? 'اتجاه المهام' : 'Task trend'}>
        <defs>
          <linearGradient id="aya-trend-blue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e78ff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#1e78ff" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="aya-trend-green" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line key={ratio} x1="0" y1={height * ratio} x2={width} y2={height * ratio} stroke="currentColor" strokeWidth="1" className="text-slate-200 dark:text-slate-800" strokeDasharray="4 6" />
        ))}
        {createdPath ? <path d={`${createdPath} L ${width} ${height} L 0 ${height} Z`} fill="url(#aya-trend-blue)" /> : null}
        {completedPath ? <path d={`${completedPath} L ${width} ${height} L 0 ${height} Z`} fill="url(#aya-trend-green)" /> : null}
        {createdPath ? <path d={createdPath} fill="none" stroke="#1e78ff" strokeWidth="2.2" strokeLinecap="round" /> : null}
        {completedPath ? <path d={completedPath} fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" /> : null}
      </svg>
      <div className="mt-1 flex justify-between text-[9.5px] text-slate-400">
        <span>{trend[0]?.day.slice(5)}</span>
        <span>{trend[Math.floor(trend.length / 2)]?.day.slice(5)}</span>
        <span>{trend[trend.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}

/** SVG donut by project. */
export function ProjectDonut({ rows }: { rows: ReportData['byProject'] }) {
  const language = useLanguage();
  const data = rows.filter((row) => row.total > 0);
  const total = data.reduce((sum, row) => sum + row.total, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={language === 'ar' ? 'التوزيع حسب المشروع' : 'Breakdown by project'}>
        <circle cx="70" cy="70" r={radius} fill="none" stroke="currentColor" strokeWidth="16" className="text-slate-100 dark:text-slate-800" />
        {data.map((row) => {
          const length = total > 0 ? (row.total / total) * circumference : 0;
          const dash = `${Math.max(0, length - 2)} ${circumference}`;
          const element = (
            <circle
              key={row.id}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={row.color}
              strokeWidth="16"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              transform="rotate(-90 70 70)"
            />
          );
          offset += length;
          return element;
        })}
        <text x="70" y="66" textAnchor="middle" className="fill-slate-800 dark:fill-slate-100" style={{ fontSize: 22, fontWeight: 800 }}>
          {total}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9 }}>
          {language === 'ar' ? 'مهمة' : 'tasks'}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2">
        {data.length === 0 ? <li className="text-[11.5px] text-slate-400">{language === 'ar' ? 'لا بيانات بعد' : 'No data yet'}</li> : null}
        {data.slice(0, 6).map((row) => (
          <li key={row.id} className="flex items-center gap-2 text-[11.5px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{row.name}</span>
            <span className="tabular-nums font-semibold text-slate-500">{row.total}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PriorityBars({ rows }: { rows: ReportData['byPriority'] }) {
  const language = useLanguage();
  const labels: Record<number, string> = { 1: 'عاجل', 2: 'مرتفع', 3: 'متوسط', 4: 'منخفض' };
  const en: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.priority} className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-[11px] font-semibold text-slate-500">{language === 'ar' ? labels[row.priority] : en[row.priority]}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <span className="block h-full rounded-full transition-[width]" style={{ width: `${(row.count / max) * 100}%`, background: PRIORITY_COLORS[row.priority] }} />
          </span>
          <span className="w-6 text-right text-[11px] font-bold tabular-nums text-slate-500">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function StatTile({ label, value, icon, tone }: { label: string; value: string | number; icon: string; tone: 'blue' | 'green' | 'amber' | 'rose' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  };
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-[#e2e8f0] bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <span className={cn('flex h-9 w-9 items-center justify-center rounded-[10px]', colors[tone])}>
        <Icon name={icon} size={17} />
      </span>
      <div>
        <p className="text-[10.5px] font-medium text-slate-500">{label}</p>
        <p className="text-[17px] font-extrabold leading-6 tabular-nums text-slate-800 dark:text-slate-100">{value}</p>
      </div>
    </div>
  );
}

/** Reports route: KPI tiles, trend, project donut and priority bars. */
export function ReportsView() {
  const language = useLanguage();
  const tasks = useTasks();
  const projects = useProjects();
  const report = useMemo(() => computeReport(tasks, projects), [tasks, projects]);

  return (
    <div className="space-y-4">
      <SectionHeading
        title={language === 'ar' ? 'التقارير' : 'Reports'}
        subtitle={language === 'ar' ? 'نبض إنتاجيتك خلال آخر 14 يومًا' : 'Your productivity pulse over the last 14 days'}
        icon="chart"
        tone="purple"
        action={<span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">{report.completionRate}% {language === 'ar' ? 'إنجاز' : 'done'}</span>}
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label={language === 'ar' ? 'كل المهام' : 'All tasks'} value={report.total} icon="clipboard" tone="blue" />
        <StatTile label={language === 'ar' ? 'مفتوحة' : 'Open'} value={report.open} icon="circle" tone="amber" />
        <StatTile label={language === 'ar' ? 'منجزة' : 'Completed'} value={report.completed} icon="checkCircle" tone="green" />
        <StatTile label={language === 'ar' ? 'متأخرة' : 'Overdue'} value={report.overdue} icon="alert" tone="rose" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{language === 'ar' ? 'اتجاه الإنجاز' : 'Completion trend'}</h3>
            <span className="text-[10.5px] text-slate-400">{language === 'ar' ? 'آخر 14 يومًا' : 'Last 14 days'}</span>
          </div>
          <TrendChart trend={report.trend} />
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-[13px] font-bold text-slate-800 dark:text-slate-100">{language === 'ar' ? 'حسب المشروع' : 'By project'}</h3>
          <ProjectDonut rows={report.byProject} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-[13px] font-bold text-slate-800 dark:text-slate-100">{language === 'ar' ? 'المهام المفتوحة حسب الأولوية' : 'Open tasks by priority'}</h3>
          <PriorityBars rows={report.byPriority} />
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-[13px] font-bold text-slate-800 dark:text-slate-100">{language === 'ar' ? 'تقدم المشاريع' : 'Project progress'}</h3>
          <div className="space-y-3">
            {report.byProject.length === 0 ? <p className="text-[11.5px] text-slate-400">{language === 'ar' ? 'لا مشاريع بعد' : 'No projects yet'}</p> : null}
            {report.byProject.slice(0, 5).map((row) => (
              <div key={row.id}>
                <div className="mb-1 flex items-center justify-between text-[11.5px]">
                  <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: row.color }} />
                    {row.name}
                  </span>
                  <span className="tabular-nums text-slate-400">
                    {row.completed}/{row.total}
                  </span>
                </div>
                <Progress value={row.completed} max={row.total || 1} tone="green" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export const reportingUi: PluginUiModule = { id: 'reporting', routes: { reporting: ReportsView } };
