import { useEffect, useMemo, useState } from 'react';
import { useKernel, useKernelVersion, useLabels, useProjects, useSections, useSettings, useTasks, useToolCount } from '@ayatodoist/plugin-sdk/react';
import { useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Button, Icon, KpiCard, Pill, TextField, cn } from '@ayatodoist/plugin-sdk/ui';
import { CompletedView, InboxView, LabelView, ProjectView, SidebarProjectRow, TaskResultsView, TodayView, UpcomingView, useTaskBuckets } from '@ayatodoist/plugin-tasks-core/ui';
import { ReportsView } from '@ayatodoist/plugin-reporting/ui';
import { parseFilter, evaluateFilter } from '@ayatodoist/plugin-filters-labels';
import { AyaChatDrawer, AyaInboxView } from '@ayatodoist/plugin-ai-agent/ui';
import { ayaApi } from '@ayatodoist/plugin-ai-agent';
import { syncFromServer } from '../app/bootstrap';
import { useSyncState } from '../app/sync';
import { routeTitle } from '../app/route';
import { useRuntime, runtimeStore } from '../app/runtime';
import { CommandPalette } from './CommandPalette';
import { QuickAddWindow } from './QuickAddWindow';
import { SearchView } from './SearchView';
import { SettingsPage } from './SettingsPage';
import { HelpModal } from './HelpModal';

interface NavItem {
  kind: string;
  label: string;
  icon: string;
  tone: 'blue' | 'green' | 'amber' | 'purple' | 'rose' | 'cyan' | 'slate';
  badge?: number;
}

const NAV: NavItem[] = [
  { kind: 'inbox', label: 'الوارد', icon: 'inbox', tone: 'blue' },
  { kind: 'today', label: 'اليوم', icon: 'today', tone: 'purple' },
  { kind: 'upcoming', label: 'القادمة', icon: 'upcoming', tone: 'amber' },
];

/**
 * App shell: navy header + RTL sidebar + ice-gray workspace canvas.
 * All data views read the live kernel, so a change from any plugin or from Aya
 * repaints immediately without a reload.
 */
export function Shell() {
  const state = useRuntime();
  const kernel = useKernel();
  useKernelVersion();
  const settings = useSettings();
  const language = useLanguage();
  const tasks = useTasks();
  const projects = useProjects();
  const labels = useLabels();
  const sections = useSections();
  const buckets = useTaskBuckets();
  const toolCount = useToolCount();
  const sync = useSyncState();

  const [ayaUnread, setAyaUnread] = useState(0);
  const [ayaModel, setAyaModel] = useState<{ label: string; latency: number | null } | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [today] = useState(() => new Date());

  const collapsed = settings.sidebarCollapsed;

  useEffect(() => {
    void syncFromServer(kernel).catch(() => undefined);
  }, [kernel]);

  useEffect(() => {
    const refresh = () => {
      void ayaApi
        .inbox('unread')
        .then((result) => setAyaUnread(result.items.length))
        .catch(() => setAyaUnread(0));
      void ayaApi
        .config()
        .then((config) => {
          const preferred = config.routing.chat_deep ?? config.routing.background_24_7;
          const model = [...config.providers.flatMap((provider) => provider.models)].find((item) => item.id === preferred) ?? config.providers.flatMap((provider) => provider.models).find((item) => item.enabled);
          setAyaModel(model ? { label: model.label, latency: model.latencyMs } : null);
        })
        .catch(() => setAyaModel(null));
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [state.ayaOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if (typeof event.key !== 'string') return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        runtimeStore.set({ paletteOpen: !state.paletteOpen });
        return;
      }
      if (typing) return;
      if (event.key.toLowerCase() === 'q') {
        event.preventDefault();
        runtimeStore.openQuickAdd();
      } else if (event.key === '?') {
        event.preventDefault();
        runtimeStore.set({ helpOpen: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.paletteOpen]);

  const navigate = (kind: string, id?: string | null) => {
    runtimeStore.navigate({ kind: kind as never, id: id ?? null });
  };

  const openTask = () => {
    if (state.route.kind === 'project' && state.route.id) runtimeStore.openQuickAdd(state.route.id);
    else runtimeStore.openQuickAdd();
  };

  const filterResult = useMemo(() => {
    if (state.route.kind !== 'filter' || !state.route.id) return null;
    const filter = kernel.store.get('filters', state.route.id);
    if (!filter) return null;
    const parsed = parseFilter(filter.query, new Date().toISOString().slice(0, 10));
    if (!parsed.ast) return { filter, tasks: [] as typeof tasks };
    return {
      filter,
      tasks: evaluateFilter(parsed.ast, tasks, {
        today: new Date().toISOString().slice(0, 10),
        projects,
        sections,
        labels,
      }),
    };
  }, [state.route.kind, state.route.id, kernel, tasks, projects, sections, labels]);

  const kpis = [
    { label: 'مهام اليوم', value: buckets.today.length, icon: 'today', gradient: 'linear-gradient(135deg,#7c3aed,#6366f1)', kind: 'today' },
    { label: 'المنجز', value: buckets.completed.length, icon: 'checkCircle', gradient: 'linear-gradient(135deg,#10b981,#059669)', kind: 'completed' },
    { label: 'القادمة', value: buckets.upcoming.length, icon: 'upcoming', gradient: 'linear-gradient(135deg,#f59e0b,#d97706)', kind: 'upcoming' },
    { label: 'الوارد', value: buckets.inbox.length, icon: 'inbox', gradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)', kind: 'inbox' },
    { label: 'متأخرة', value: buckets.overdue.length, icon: 'alert', gradient: 'linear-gradient(135deg,#f43f5e,#e11d48)', kind: 'today' },
    { label: 'رسائل آية', value: ayaUnread, icon: 'message', gradient: 'linear-gradient(135deg,#14b8a6,#0d9488)', kind: 'aya' },
  ];

  const showKpis = !['settings', 'reporting', 'aya', 'search'].includes(state.route.kind);

  const content = () => {
    switch (state.route.kind) {
      case 'today':
        return <TodayView onAddTask={openTask} />;
      case 'upcoming':
        return <UpcomingView onAddTask={openTask} />;
      case 'completed':
        return <CompletedView />;
      case 'project':
        return <ProjectView projectId={state.route.id ?? projects.find((project) => project.isInbox)?.id ?? '__inbox'} onAddTask={openTask} />;
      case 'label':
        return <LabelView labelName={state.route.id ?? ''} />;
      case 'filter':
        return filterResult ? <TaskResultsView tasks={filterResult.tasks} title={filterResult.filter.name} subtitle={filterResult.filter.query} tone="purple" /> : <InboxView onAddTask={openTask} />;
      case 'reporting':
        return <ReportsView />;
      case 'aya':
        return <AyaInboxView onDiscuss={(text) => runtimeStore.openAya(text)} onAddTask={openTask} />;
      case 'search':
        return <SearchView initialQuery={state.route.query ?? ''} />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <InboxView onAddTask={openTask} />;
    }
  };

  const dateLabel = new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long' }).format(today);

  const navButton = (item: NavItem, active: boolean, onClick: () => void, badge?: number) => (
    <button
      key={item.kind}
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[12.5px] transition-colors',
        active ? 'bg-[#1e78ff] font-semibold text-white shadow-[0_8px_18px_-12px_rgba(30,120,255,.95)]' : 'text-slate-300/90 hover:bg-white/10 hover:text-white',
      )}
    >
      <span className={cn('flex h-6 w-6 items-center justify-center rounded-[6px]', active ? 'bg-white/20 text-white' : 'bg-white/[0.06] text-slate-300 group-hover:text-white')}>
        <Icon name={item.icon} size={14} />
      </span>
      <span className="flex-1 truncate text-left">{item.label}</span>
      {badge ? (
        <span className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold', active ? 'bg-white/25 text-white' : 'bg-rose-500 text-white')}>{badge}</span>
      ) : null}
    </button>
  );

  return (
    <div dir="rtl" className="flex h-screen flex-col overflow-hidden bg-[#f2f5fa] text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      {/* ----------------------------------------------------------- header */}
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 bg-[#132238] px-4 text-white shadow-[0_1px_0_rgba(255,255,255,.06),0_10px_30px_-24px_rgba(15,23,42,.9)]">
        <button
          type="button"
          onClick={() => void kernel.execute('core.settings.update', { sidebarCollapsed: !collapsed } as never)}
          aria-label="إظهار/إخفاء الشريط الجانبي"
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-white/60 hover:bg-white/10 hover:text-white"
        >
          <Icon name="sidebar" size={17} />
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#1e78ff] to-[#7c3aed] shadow-[0_6px_16px_-8px_rgba(30,120,255,.9)]">
            <Icon name="check" size={17} strokeWidth={3} />
          </span>
          <div className="leading-tight">
            <p className="text-[13.5px] font-extrabold tracking-tight">__AYAtodoist</p>
            <p className="text-[9.5px] text-white/50">مساحة عمل ذكية بقيادة آية</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => runtimeStore.set({ paletteOpen: true })}
          className="mx-auto flex h-9 w-full max-w-[420px] items-center gap-2 rounded-full bg-white px-3.5 text-right text-slate-400 shadow-inner transition-shadow hover:shadow-[0_0_0_3px_rgba(30,120,255,.25)]"
        >
          <Icon name="search" size={15} className="text-slate-400" />
          <span className="flex-1 truncate text-[12px]">بحث أو اكتب أمراً...</span>
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-400">Ctrl+K</kbd>
        </button>

        <span className="hidden h-8 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 text-[11px] text-white/75 lg:flex">
          <Icon name="calendar" size={13} className="text-white/50" />
          {dateLabel}
        </span>

        <button
          type="button"
          onClick={() => navigate('aya')}
          aria-label="رسائل آية"
          className="relative flex h-8 w-8 items-center justify-center rounded-[7px] text-white/70 hover:bg-white/10 hover:text-white"
        >
          <Icon name="bell" size={17} />
          {ayaUnread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-[#132238]">
              {ayaUnread}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => runtimeStore.setTheme(state.theme === 'dark' ? 'light' : 'dark')}
          aria-label="تبديل المظهر"
          title={state.theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-white/70 hover:bg-white/10 hover:text-white"
        >
          <Icon name={state.theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>

        <button
          type="button"
          onClick={() => runtimeStore.openAya()}
          className="flex h-8 items-center gap-1.5 rounded-[7px] bg-gradient-to-l from-[#7c3aed] to-[#1e78ff] px-3 text-[12px] font-bold text-white shadow-[0_8px_20px_-12px_rgba(124,58,237,.9)] transition-transform hover:-translate-y-0.5"
        >
          آية
          <span aria-hidden="true">✨</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------------------------------------------------------- sidebar */}
        <aside
          className={cn(
            'app-sidebar flex shrink-0 flex-col overflow-hidden bg-[#16263e] text-slate-200',
            collapsed ? 'w-0' : 'w-[240px]',
          )}
        >
          <div className="flex flex-col gap-3 px-3 pb-2 pt-3">
            <button
              type="button"
              onClick={openTask}
              className="flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-[#1e78ff] text-[12.5px] font-bold text-white shadow-[0_10px_22px_-14px_rgba(30,120,255,1)] transition-colors hover:bg-[#1668e3]"
            >
              <Icon name="plus" size={15} strokeWidth={2.4} />
              إضافة مهمة
              <kbd className="ml-1 rounded bg-black/20 px-1 text-[9px] font-semibold text-white/70">Q</kbd>
            </button>

            <div className="space-y-0.5">
              {NAV.map((item) => navButton(item, state.route.kind === item.kind, () => navigate(item.kind)))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/35">مشاريعي</span>
              <button
                type="button"
                aria-label="مشروع جديد"
                onClick={() => setAddingProject((value) => !value)}
                className="flex h-5 w-5 items-center justify-center rounded-[5px] text-white/40 hover:bg-white/10 hover:text-white"
              >
                <Icon name="plus" size={13} />
              </button>
            </div>

            {addingProject ? (
              <div className="mb-1.5 flex items-center gap-1 rounded-[7px] bg-white/[0.07] p-1">
                <input
                  autoFocus
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && projectName.trim()) {
                      void kernel.execute('project.create', { name: projectName.trim() } as never);
                      setProjectName('');
                      setAddingProject(false);
                    }
                    if (event.key === 'Escape') setAddingProject(false);
                  }}
                  placeholder="اسم المشروع…"
                  className="h-6 min-w-0 flex-1 bg-transparent px-1 text-[11.5px] text-white placeholder:text-white/30 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="إضافة"
                  onClick={() => {
                    if (!projectName.trim()) return;
                    void kernel.execute('project.create', { name: projectName.trim() } as never);
                    setProjectName('');
                    setAddingProject(false);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded bg-[#1e78ff] text-white"
                >
                  <Icon name="check" size={11} strokeWidth={3} />
                </button>
              </div>
            ) : null}

            <div className="space-y-0.5">
              {projects.map((project) => (
                <SidebarProjectRow
                  key={project.id}
                  project={project}
                  active={state.route.kind === 'project' && state.route.id === project.id}
                  count={tasks.filter((task) => task.projectId === project.id && !task.isCompleted).length}
                  onClick={() => navigate('project', project.id)}
                />
              ))}
              {projects.length === 0 ? <p className="px-2 py-1 text-[11px] text-white/30">لا مشاريع بعد</p> : null}
            </div>
          </div>

          <div className="space-y-0.5 border-t border-white/[0.06] px-3 py-2">
            <button
              type="button"
              onClick={() => navigate('aya')}
              className={cn(
                'flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[12.5px] transition-colors',
                state.route.kind === 'aya' ? 'bg-[#1e78ff] font-semibold text-white' : 'text-slate-300/90 hover:bg-white/10 hover:text-white',
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-gradient-to-br from-[#7c3aed] to-[#14b8a6] text-white">
                <Icon name="sparkles" size={13} />
              </span>
              <span className="flex-1 text-left">رسائل آية</span>
              {ayaUnread > 0 ? <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{ayaUnread}</span> : null}
            </button>
            {navButton({ kind: 'reporting', label: 'التقارير', icon: 'chart', tone: 'cyan' }, state.route.kind === 'reporting', () => navigate('reporting'))}
            {navButton({ kind: 'settings', label: 'الإعدادات', icon: 'settings', tone: 'slate' }, state.route.kind === 'settings', () => navigate('settings'))}
          </div>

          {/* live status widget */}
          <div className="m-2.5 rounded-[11px] bg-[#0f1b2d] p-3 ring-1 ring-white/[0.06]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10.5px] font-bold text-white/70">حالة آية المباشرة</span>
              <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                متصلة
              </span>
            </div>
            <p className="truncate text-[11.5px] font-semibold text-white" dir="ltr">
              {ayaModel ? ayaModel.label : 'لم يُضف مزوّد بعد'}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9.5px] text-white/50">
              <span className="rounded-[6px] bg-white/[0.05] px-1.5 py-1">
                الكمون <b className="text-white/80">{ayaModel?.latency ? `${ayaModel.latency}ms` : '—'}</b>
              </span>
              <span className="rounded-[6px] bg-white/[0.05] px-1.5 py-1">
                الأدوات <b className="text-white/80">{toolCount}</b>
              </span>
            </div>
          </div>
        </aside>

        {/* ---------------------------------------------------------- canvas */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#f2f5fa] px-4 py-4 dark:bg-slate-950 lg:px-6">
          <div className="mx-auto w-full max-w-[1320px] space-y-4">
            {showKpis ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
                {kpis.map((kpi) => (
                  <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} gradient={kpi.gradient} onClick={() => navigate(kpi.kind)} />
                ))}
              </div>
            ) : null}

            <div key={`${state.route.kind}-${state.route.id ?? ''}-${state.route.query ?? ''}`}>{content()}</div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8f0] pt-3 text-[10.5px] text-slate-400 dark:border-slate-800">
              <span>{routeTitle(state.route)} · {tasks.length} مهمة · {projects.length} مشروع</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', sync.online ? 'bg-emerald-500' : 'bg-slate-300')} />
                {sync.online ? 'الخادم متصل' : 'وضع محلي — يعمل دون خادم'}
              </span>
            </footer>
          </div>
        </main>
      </div>

      <QuickAddWindow
        open={state.quickAddOpen}
        initialText={state.quickAddText}
        defaultProjectId={state.quickAddProjectId}
        onClose={() => runtimeStore.set({ quickAddOpen: false, quickAddProjectId: null, quickAddText: '' })}
      />
      <AyaChatDrawer open={state.ayaOpen} onClose={() => runtimeStore.closeAya()} />
      <CommandPalette open={state.paletteOpen} onClose={() => runtimeStore.set({ paletteOpen: false })} />
      <HelpModal open={state.helpOpen} onClose={() => runtimeStore.set({ helpOpen: false })} />

      <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[300px] flex-col gap-1.5">
        {state.toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'toast pointer-events-auto flex items-center gap-2 rounded-[9px] px-3 py-2 text-[11.5px] font-semibold text-white shadow-lg',
              toast.tone === 'error' ? 'bg-rose-600' : toast.tone === 'success' ? 'bg-emerald-600' : 'bg-[#132238]',
            )}
          >
            <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'checkCircle' : 'sparkles'} size={14} />
            <span className="flex-1">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
