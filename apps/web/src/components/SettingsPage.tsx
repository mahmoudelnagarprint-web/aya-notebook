import { useRef, useState } from 'react';
import { bumpKernelRevision, useKernel, useKernelVersion, useLanguage, usePluginStatuses, useSettings } from '@ayatodoist/plugin-sdk/react';
import { Button, Card, Icon, Pill, SectionHeading, Toggle, cn } from '@ayatodoist/plugin-sdk/ui';
import { AyaSettingsPanel } from '@ayatodoist/plugin-ai-agent/ui';
import { syncFromServer } from '../app/bootstrap';
import { runtimeStore } from '../app/runtime';
import { syncStore, useSyncState } from '../app/sync';

type Tab = 'general' | 'appearance' | 'plugins' | 'data' | 'aya' | 'about';

const TABS: Array<{ id: Tab; ar: string; en: string; icon: string }> = [
  { id: 'general', ar: 'عام', en: 'General', icon: 'settings' },
  { id: 'appearance', ar: 'المظهر واللغة', en: 'Appearance', icon: 'sun' },
  { id: 'plugins', ar: 'الإضافات', en: 'Plugins', icon: 'board' },
  { id: 'data', ar: 'البيانات والمزامنة', en: 'Data & sync', icon: 'save' },
  { id: 'aya', ar: 'آية', en: 'Aya', icon: 'sparkles' },
  { id: 'about', ar: 'حول', en: 'About', icon: 'audit' },
];

export function SettingsPage() {
  const kernel = useKernel();
  useKernelVersion();
  const settings = useSettings();
  const language = useLanguage();
  const plugins = usePluginStatuses();
  const sync = useSyncState();
  const [tab, setTab] = useState<Tab>('general');
  const [server, setServer] = useState(syncStore.state.server);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement | null>(null);

  const t = (ar: string, en: string) => (language === 'ar' ? ar : en);

  const saveServer = async () => {
    syncStore.setServer(server);
    setBusy(true);
    const applied = await syncFromServer(kernel);
    setBusy(false);
    runtimeStore.toast(applied === null ? t('تعذّر الوصول للخادم', 'Server unreachable') : t(`تمت مزامنة ${applied} سجلاً`, `Synced ${applied} rows`), applied === null ? 'error' : 'success');
  };

  const exportData = () => {
    const payload = JSON.stringify(kernel.snapshot(), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ayatodoist-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    runtimeStore.toast(t('تم تصدير النسخة الاحتياطية', 'Backup exported'), 'success');
  };

  const importData = async (file: File | undefined) => {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as { collections?: Record<string, unknown[]> } & Record<string, unknown[]>;
      kernel.store.replaceAll((payload.collections ?? payload) as never);
      bumpKernelRevision();
      runtimeStore.toast(t('تم استيراد البيانات', 'Data imported'), 'success');
    } catch {
      runtimeStore.toast(t('ملف غير صالح', 'Invalid backup file'), 'error');
    }
  };

  const resetData = () => {
    if (!window.confirm(t('سيتم مسح كل المهام والمشاريع من هذا الجهاز. لا يمكن التراجع.', 'This removes every task and project from this device. It cannot be undone.'))) return;
    kernel.store.replaceAll({
      tasks: [],
      projects: [],
      sections: [],
      labels: [],
      filters: [],
      comments: [],
      reminders: [],
      activity: [],
    } as never);
    void kernel.execute('project.ensureInbox', {} as never);
    bumpKernelRevision();
    runtimeStore.toast(t('تم مسح البيانات', 'Data cleared'), 'success');
  };

  return (
    <div className="space-y-4">
      <SectionHeading title={t('الإعدادات', 'Settings')} subtitle={t('كل شيء محلي أولًا — وأنتِ تتحكمين بكل إضافة', 'Local-first, and every plugin is under your control')} icon="settings" tone="slate" />

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-semibold transition-colors',
              tab === item.id
                ? 'bg-[#132238] text-white shadow-sm'
                : 'border border-[#e2e8f0] bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
            )}
          >
            <Icon name={item.icon} size={13} />
            {language === 'ar' ? item.ar : item.en}
          </button>
        ))}
      </div>

      {tab === 'general' ? (
        <Card className="space-y-3 p-4">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{t('عام', 'General')}</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[240px] flex-1">
              <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">{t('عنوان الخادم', 'Server URL')}</span>
              <input
                value={server}
                onChange={(event) => setServer(event.target.value)}
                placeholder="http://127.0.0.1:8787"
                dir="ltr"
                className="h-9 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[12.5px] text-slate-800 focus:border-[#1e78ff] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <Button variant="primary" icon="refresh" disabled={busy} onClick={() => void saveServer()}>
              {busy ? t('جارٍ…', 'Working…') : t('حفظ ومزامنة', 'Save & sync')}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-[9px] bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <p className="text-[10px] text-slate-400">{t('حالة المزامنة', 'Sync status')}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                <span className={cn('h-1.5 w-1.5 rounded-full', sync.online ? 'bg-emerald-500' : 'bg-rose-400')} />
                {sync.online ? t('متصل', 'Online') : t('غير متصل', 'Offline')}
              </p>
            </div>
            <div className="rounded-[9px] bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <p className="text-[10px] text-slate-400">{t('عمليات معلّقة', 'Pending operations')}</p>
              <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{sync.pending}</p>
            </div>
            <div className="rounded-[9px] bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <p className="text-[10px] text-slate-400">{t('آخر مزامنة', 'Last sync')}</p>
              <p className="mt-0.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">{sync.lastSync ? new Date(sync.lastSync).toLocaleTimeString('ar') : '—'}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'appearance' ? (
        <Card className="space-y-4 p-4">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{t('المظهر واللغة', 'Appearance & language')}</h3>
          <div>
            <span className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">{t('المظهر', 'Theme')}</span>
            <div className="flex gap-2">
              {(['light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => runtimeStore.setTheme(theme)}
                  className={cn(
                    'flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[12px] font-semibold transition-colors',
                    settings.theme === theme ? 'border-[#1e78ff] bg-blue-50 text-[#1e78ff] dark:bg-blue-500/10' : 'border-[#e2e8f0] bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                  )}
                >
                  <Icon name={theme === 'light' ? 'sun' : 'moon'} size={15} />
                  {theme === 'light' ? t('فاتح', 'Light') : t('داكن', 'Dark')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">{t('اللغة', 'Language')}</span>
            <div className="flex gap-2">
              {(['ar', 'en'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => runtimeStore.setLanguage(code)}
                  className={cn(
                    'rounded-[9px] border px-3 py-2 text-[12px] font-semibold transition-colors',
                    settings.language === code ? 'border-[#1e78ff] bg-blue-50 text-[#1e78ff] dark:bg-blue-500/10' : 'border-[#e2e8f0] bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                  )}
                >
                  {code === 'ar' ? 'العربية' : 'English'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">{t('الكثافة', 'Density')}</span>
            <div className="flex gap-2">
              {(['comfortable', 'compact'] as const).map((density) => (
                <button
                  key={density}
                  type="button"
                  onClick={() => void kernel.execute('core.settings.update', { display: { density } } as never)}
                  className={cn(
                    'rounded-[9px] border px-3 py-2 text-[12px] font-semibold transition-colors',
                    settings.display.density === density ? 'border-[#1e78ff] bg-blue-50 text-[#1e78ff] dark:bg-blue-500/10' : 'border-[#e2e8f0] bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                  )}
                >
                  {density === 'comfortable' ? t('مريح', 'Comfortable') : t('مضغوط', 'Compact')}
                </button>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'plugins' ? (
        <Card className="divide-y divide-[#eef2f7] dark:divide-slate-800">
          {plugins.map((plugin) => (
            <div key={plugin.id} className="flex items-center gap-3 px-4 py-3">
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-[9px]', plugin.enabled ? 'bg-blue-50 text-[#1e78ff] dark:bg-blue-500/15 dark:text-blue-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800')}>
                <Icon name={plugin.id === 'ai-agent' ? 'sparkles' : plugin.id === 'reporting' ? 'chart' : 'board'} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[12.5px] font-bold text-slate-800 dark:text-slate-100">{language === 'ar' ? plugin.nameAr || plugin.name : plugin.name}</p>
                  <Pill tone={plugin.enabled ? 'green' : 'slate'}>{plugin.enabled ? t('مفعّلة', 'Enabled') : t('معطّلة', 'Disabled')}</Pill>
                </div>
                <p className="truncate text-[10.5px] text-slate-400">
                  {language === 'ar' ? plugin.descriptionAr || plugin.description : plugin.description}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {plugin.commandCount} {t('أمر', 'commands')} · v{plugin.version}
                </p>
              </div>
              <Toggle
                checked={plugin.enabled}
                label={plugin.name}
                onChange={(enabled) => void kernel.execute('core.plugins.setEnabled', { pluginId: plugin.id, enabled } as never)}
              />
            </div>
          ))}
        </Card>
      ) : null}

      {tab === 'data' ? (
        <Card className="space-y-3 p-4">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{t('البيانات والمزامنة', 'Data & sync')}</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" icon="save" onClick={exportData}>
              {t('تصدير نسخة احتياطية', 'Export backup')}
            </Button>
            <Button variant="soft" icon="clipboard" onClick={() => importRef.current?.click()}>
              {t('استيراد نسخة احتياطية', 'Import backup')}
            </Button>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                void importData(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <Button variant="danger" icon="trash" onClick={resetData}>
              {t('مسح كل البيانات', 'Erase all data')}
            </Button>
          </div>
          <p className="text-[11px] leading-6 text-slate-500 dark:text-slate-400">
            {t('النسخة الاحتياطية تحتوي المهام والمشاريع والإعدادات. مفاتيح النماذج تبقى على الخادم ولا تُصدَّر أبدًا.', 'The backup contains tasks, projects and settings. Model keys stay on the server and are never exported.')}
          </p>
        </Card>
      ) : null}

      {tab === 'aya' ? <AyaSettingsPanel /> : null}

      {tab === 'about' ? (
        <Card className="space-y-2 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#1e78ff] to-[#7c3aed] text-white">
              <Icon name="check" size={17} strokeWidth={3} />
            </span>
            <div>
              <p className="text-[13px] font-extrabold text-slate-800 dark:text-slate-100">__AYAtodoist</p>
              <p className="text-[10.5px] text-slate-400">v0.1.0 · AGPL-3.0</p>
            </div>
          </div>
          <p className="text-[11.5px] leading-6 text-slate-500 dark:text-slate-400">
            {t('منصة مهام وملاحظات مفتوحة المصدر، تعمل أولًا على الجهاز، وكل ميزة فيها إضافة.', 'An open-source, local-first task platform where every feature is a plugin.')}
          </p>
          <p className="text-[10.5px] text-slate-400">{t('مفاتيح النماذج تبقى محليًا ولا تُزامَن أبدًا.', 'Model keys stay local and are never synced.')}</p>
        </Card>
      ) : null}
    </div>
  );
}
