import { useCallback, useEffect, useState } from 'react';
import type { AyaChannelRecord, AyaMemory, AyaMemoryCategory, AyaModel, AyaProvider, AyaPublicConfig, AyaRole, AyaRouting, AyaSettings } from '@ayatodoist/shared-types';
import { AYA_MEMORY_CATEGORIES, AYA_MEMORY_CATEGORY_LABELS, AYA_ROLES, AYA_ROLE_LABELS } from '@ayatodoist/shared-types';
import { useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Button, Card, Icon, Pill, Select, TextArea, TextField, Toggle, cn } from '@ayatodoist/plugin-sdk/ui';
import { AyaApiError, ayaApi } from '../aya-client';

const PRESETS = [
  { id: 'gemini', label: 'Google Gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'openai', label: 'OpenAI', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'ollama', label: 'Ollama (محلي)', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { id: 'anthropic', label: 'Anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
] as const;

function message(cause: unknown): string {
  return cause instanceof AyaApiError ? cause.message : (cause as Error).message;
}

function Block({ title, subtitle, icon, children, action }: { title: string; subtitle?: string; icon: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <Icon name={icon} size={15} />
          </span>
          <div>
            <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{title}</h3>
            {subtitle ? <p className="text-[10.5px] text-slate-400">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/* ------------------------------------------------------------- providers */

function ProviderForm({ onCreated, onError }: { onCreated: () => void; onError: (value: string) => void }) {
  const language = useLanguage();
  const [preset, setPreset] = useState<string>('gemini');
  const [name, setName] = useState('Google Gemini');
  const [baseUrl, setBaseUrl] = useState<string>(PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = (id: string) => {
    setPreset(id);
    const found = PRESETS.find((item) => item.id === id);
    if (found) {
      setName(found.name);
      setBaseUrl(found.baseUrl);
    }
  };

  const submit = async () => {
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim()) return;
    setBusy(true);
    try {
      const created = await ayaApi.addProvider({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      setApiKey('');
      try {
        await ayaApi.fetchModels(created.provider.id);
      } catch (cause) {
        onError(message(cause));
      }
      onCreated();
    } catch (cause) {
      onError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[10px] border border-dashed border-[#cbd5e1] bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select label={language === 'ar' ? 'إعداد سريع' : 'Quick preset'} value={preset} onChange={(event) => choose(event.target.value)}>
          {PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
        <TextField label={language === 'ar' ? 'الاسم' : 'Name'} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        <TextField label="Base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} dir="ltr" autoComplete="off" spellCheck={false} />
        <TextField
          label={language === 'ar' ? 'مفتاح API' : 'API key'}
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          dir="ltr"
          autoComplete="new-password"
          spellCheck={false}
          placeholder="sk-…"
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[10.5px] text-slate-400">{language === 'ar' ? 'يُخزَّن المفتاح على الخادم فقط ولا يُرسل للواجهة.' : 'The key is stored server-side only and never returned to the UI.'}</p>
        <Button variant="primary" icon="plus" disabled={busy || !apiKey.trim()} onClick={() => void submit()}>
          {language === 'ar' ? 'إضافة المزوّد' : 'Add provider'}
        </Button>
      </div>
    </div>
  );
}

function ModelRow({ model, onChanged, onError }: { model: AyaModel; onChanged: () => void; onError: (value: string) => void }) {
  const language = useLanguage();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (cause) {
      onError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 border-t border-[#eef2f7] py-1.5 first:border-t-0 dark:border-slate-800">
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', model.status === 'ok' ? 'bg-emerald-500' : model.status === 'failed' ? 'bg-rose-500' : 'bg-slate-300')}
        title={model.lastError ?? model.status}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-slate-700 dark:text-slate-200">{model.label}</p>
        <p className="truncate text-[10px] text-slate-400" dir="ltr">
          {model.modelId}
          {model.latencyMs ? ` · ${model.latencyMs}ms` : ''}
        </p>
        {model.status === 'failed' && model.lastError ? <p className="truncate text-[10px] text-rose-500" title={model.lastError}>{model.lastError}</p> : null}
      </div>
      <label className="flex items-center gap-1 text-[10px] text-slate-500">
        <Toggle checked={model.failover} label="failover" onChange={(value) => void run(() => ayaApi.updateModel(model.id, { failover: value }))} />
        {language === 'ar' ? 'تبديل' : 'failover'}
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => ayaApi.testModel(model.id))}
        className="rounded-[6px] border border-[#e2e8f0] px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-[#1e78ff] hover:text-[#1e78ff] dark:border-slate-700 dark:text-slate-300"
      >
        {busy ? '…' : language === 'ar' ? 'اختبار' : 'Test'}
      </button>
      <button
        type="button"
        aria-label="رفع الأولوية"
        onClick={() => void run(() => ayaApi.updateModel(model.id, { priority: Math.max(0, model.priority - 1) }))}
        className="text-slate-400 hover:text-slate-700"
      >
        ▲
      </button>
      <button
        type="button"
        aria-label="خفض الأولوية"
        onClick={() => void run(() => ayaApi.updateModel(model.id, { priority: model.priority + 1 }))}
        className="text-slate-400 hover:text-slate-700"
      >
        ▼
      </button>
      <button
        type="button"
        aria-label="حذف النموذج"
        onClick={() => void run(() => ayaApi.deleteModel(model.id))}
        className="text-slate-300 hover:text-rose-500"
      >
        <Icon name="trash" size={12} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

export function AyaSettingsPanel() {
  const language = useLanguage();
  const [config, setConfig] = useState<AyaPublicConfig | null>(null);
  const [routing, setRouting] = useState<AyaRouting | null>(null);
  const [settings, setSettings] = useState<AyaSettings | null>(null);
  const [memories, setMemories] = useState<AyaMemory[]>([]);
  const [channels, setChannels] = useState<AyaChannelRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newMemory, setNewMemory] = useState('');
  const [newCategory, setNewCategory] = useState<AyaMemoryCategory>('preferences');
  const [channelDraft, setChannelDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await ayaApi.config();
      setConfig(next);
      setRouting(next.routing);
      setSettings(next.settings);
      setChannels(next.channels);
      const [memoryResult, channelResult] = await Promise.allSettled([ayaApi.memories(), ayaApi.channels()]);
      if (memoryResult.status === 'fulfilled') setMemories(memoryResult.value.memories);
      if (channelResult.status === 'fulfilled') {
        setChannels(channelResult.value.channels);
        const draft: Record<string, string> = {};
        for (const channel of channelResult.value.channels) {
          for (const [key, value] of Object.entries(channel.config ?? {})) draft[`${channel.id}.${key}`] = String(value);
        }
        setChannelDraft(draft);
      }
      setError(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (patch: Partial<AyaSettings>) => {
    setSaving(true);
    try {
      const result = await ayaApi.updateSettings(patch);
      setSettings(result.settings);
      setError(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };

  const setRole = async (role: AyaRole, value: string) => {
    if (!routing) return;
    const next = { ...routing, [role]: value || null };
    setRouting(next);
    try {
      const result = await ayaApi.setRouting({ [role]: value || null });
      setRouting(result.routing);
    } catch (cause) {
      setError(message(cause));
    }
  };

  const models = config?.providers.flatMap((provider) => provider.models) ?? [];
  const totalModels = models.length;
  const onlineModels = models.filter((model) => model.status === 'ok').length;

  if (loading) {
    return <Card className="p-8 text-center text-[12px] text-slate-400">{language === 'ar' ? 'جارٍ تحميل غرفة تحكم آية…' : 'Loading Aya control room…'}</Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 border-none bg-[#132238] p-4 text-white">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-white/10">
            <Icon name="sparkles" size={19} />
          </span>
          <div>
            <p className="text-[14px] font-bold">{language === 'ar' ? 'غرفة تحكم آية' : 'Aya control room'}</p>
            <p className="text-[11px] text-white/60">
              {totalModels} {language === 'ar' ? 'نموذج' : 'models'} · {onlineModels} {language === 'ar' ? 'متصل' : 'online'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="soft" icon="refresh" className="h-8 border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => void load()}>
            {language === 'ar' ? 'تحديث' : 'Refresh'}
          </Button>
          <Button variant="primary" icon="wand" className="h-8" onClick={() => void ayaApi.smartRouting().then((result) => setRouting(result.routing)).catch((cause) => setError(message(cause)))}>
            {language === 'ar' ? 'توزيع تلقائي ذكي' : 'Smart auto-routing'}
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11.5px] leading-6 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          <Icon name="alert" size={14} className="mt-1 shrink-0" />
          <div>
            <p className="font-bold">{language === 'ar' ? 'تعذّر الاتصال بخادم آية' : 'Aya server unreachable'}</p>
            <p className="opacity-80">{error}</p>
            <p className="mt-1 text-[10.5px] opacity-70">{language === 'ar' ? 'شغّلي bun run dev:server ثم أضيفي مزوّدًا.' : 'Run bun run dev:server, then add a provider.'}</p>
          </div>
        </div>
      ) : null}

      <Block
        title={language === 'ar' ? 'المزوّدون والنماذج' : 'Providers & models'}
        subtitle={language === 'ar' ? 'مفاتيح مشفّرة على الخادم · ترتيب التبديل التلقائي' : 'Keys stay server-side · failover order'}
        icon="planet"
      >
        <div className="space-y-3">
          {config?.providers.length === 0 ? (
            <p className="rounded-[8px] bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              {language === 'ar' ? 'لا مزوّدين بعد. ابدئي بـ Google Gemini أو OpenAI من الإعداد السريع.' : 'No providers yet. Start with Google Gemini or OpenAI from the quick preset.'}
            </p>
          ) : null}

          {config?.providers.map((provider: AyaProvider & { models: AyaModel[] }) => (
            <div key={provider.id} className="rounded-[10px] border border-[#e2e8f0] p-3 dark:border-slate-700">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#132238] text-white">
                    <Icon name="planet" size={13} />
                  </span>
                  <div>
                    <p className="text-[12.5px] font-bold text-slate-800 dark:text-slate-100">{provider.name}</p>
                    <p className="text-[10px] text-slate-400" dir="ltr">
                      {provider.baseUrl}
                    </p>
                  </div>
                  <Pill tone={provider.hasKey ? 'green' : 'rose'}>{provider.hasKey ? (language === 'ar' ? 'مفتاح محفوظ' : 'key set') : language === 'ar' ? 'بلا مفتاح' : 'no key'}</Pill>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void ayaApi.fetchModels(provider.id).then(() => load()).catch((cause) => setError(message(cause)))}
                    className="rounded-[6px] border border-[#e2e8f0] px-2 py-1 text-[10.5px] font-semibold text-slate-600 hover:border-[#1e78ff] hover:text-[#1e78ff] dark:border-slate-700 dark:text-slate-300"
                  >
                    {language === 'ar' ? 'جلب واختبار' : 'Fetch & test'}
                  </button>
                  <button
                    type="button"
                    aria-label="حذف المزوّد"
                    onClick={() => void ayaApi.deleteProvider(provider.id).then(() => load()).catch((cause) => setError(message(cause)))}
                    className="text-slate-300 hover:text-rose-500"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
              <div className="mt-1.5">
                {provider.models.length === 0 ? (
                  <p className="py-1 text-[10.5px] text-slate-400">{language === 'ar' ? 'اضغطي «جلب واختبار» لاستيراد النماذج.' : 'Press “Fetch & test” to import models.'}</p>
                ) : (
                  provider.models
                    .slice()
                    .sort((a, b) => a.priority - b.priority)
                    .map((model) => <ModelRow key={model.id} model={model} onChanged={() => void load()} onError={setError} />)
                )}
              </div>
            </div>
          ))}

          <ProviderForm onCreated={() => void load()} onError={setError} />
        </div>
      </Block>

      <Block title={language === 'ar' ? 'التوزيع التلقائي بأربعة أدوار' : 'Smart 4-role routing'} subtitle={language === 'ar' ? 'لكل دور نموذجه المناسب' : 'One model per role'} icon="board">
        <div className="grid gap-2 sm:grid-cols-2">
          {AYA_ROLES.map((role) => (
            <div key={role}>
              <span className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">{language === 'ar' ? AYA_ROLE_LABELS[role].ar : AYA_ROLE_LABELS[role].en}</span>
              <Select value={routing?.[role] ?? ''} onChange={(event) => void setRole(role, event.target.value)} aria-label={role}>
                <option value="">{language === 'ar' ? 'بدون تخصيص' : 'Unassigned'}</option>
                {models.map((model) => (
                  <option key={`${role}-${model.id}`} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </Block>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title={language === 'ar' ? 'الاستقلالية والأدوات' : 'Autonomy & tools'} icon="audit">
          <div className="space-y-2">
            {(
              [
                { value: 'full_undo', ar: 'تنفيذ كامل مع تراجع جماعي', en: 'Full execution with batch undo' },
                { value: 'confirm_delete', ar: 'تأكيد قبل الحذف فقط', en: 'Confirm deletions only' },
                { value: 'read_only', ar: 'قراءة فقط', en: 'Read only' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => void saveSettings({ autonomy: option.value })}
                disabled={saving}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[8px] border px-2.5 py-2 text-left text-[11.5px] font-semibold transition-colors',
                  settings?.autonomy === option.value
                    ? 'border-[#1e78ff] bg-blue-50 text-[#1e78ff] dark:bg-blue-500/10'
                    : 'border-[#e2e8f0] bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                )}
              >
                <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-full border', settings?.autonomy === option.value ? 'border-[#1e78ff]' : 'border-slate-300')}>
                  {settings?.autonomy === option.value ? <span className="h-2 w-2 rounded-full bg-[#1e78ff]" /> : null}
                </span>
                {language === 'ar' ? option.ar : option.en}
              </button>
            ))}
            <div className="flex items-center justify-between rounded-[8px] bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
              <span className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">{language === 'ar' ? 'العمل الخلفي 24/7' : '24/7 background daemon'}</span>
              <Toggle checked={settings?.daemonEnabled ?? false} label="daemon" onChange={(value) => void saveSettings({ daemonEnabled: value })} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">{language === 'ar' ? 'كل كم دقيقة؟' : 'Heartbeat minutes'}</span>
              <TextField
                type="number"
                min={5}
                max={240}
                value={settings?.heartbeatMinutes ?? 20}
                onChange={(event) => void saveSettings({ heartbeatMinutes: Number(event.target.value) })}
                className="h-7 w-20"
              />
            </div>
            <p className="text-[10.5px] text-slate-400">
              {config?.tools.length ?? 0} {language === 'ar' ? 'أداة متاحة لآية' : 'tools available to Aya'}
            </p>
          </div>
        </Block>

        <Block title={language === 'ar' ? 'الشخصية' : 'Persona'} icon="sparkles" action={<Button variant="soft" className="h-7 px-2 text-[10.5px]" onClick={() => void saveSettings({ personaAr: settings?.personaAr ?? '', personaEn: settings?.personaEn ?? '' })}>{language === 'ar' ? 'حفظ' : 'Save'}</Button>}>
          <div className="space-y-2">
            <TextArea label="بالعربية" rows={3} value={settings?.personaAr ?? ''} onChange={(event) => setSettings((current) => (current ? { ...current, personaAr: event.target.value } : current))} />
            <TextArea label="English" rows={2} value={settings?.personaEn ?? ''} onChange={(event) => setSettings((current) => (current ? { ...current, personaEn: event.target.value } : current))} />
          </div>
        </Block>
      </div>

      <Block title={language === 'ar' ? 'الذاكرة طويلة المدى' : 'Long-term memory'} icon="clipboard">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <TextField value={newMemory} onChange={(event) => setNewMemory(event.target.value)} placeholder={language === 'ar' ? 'أضيفي تفضيلًا أو قاعدة…' : 'Add a preference or rule…'} className="min-w-[180px] flex-1" />
          <Select value={newCategory} onChange={(event) => setNewCategory(event.target.value as AyaMemoryCategory)} className="h-9 w-32">
            {AYA_MEMORY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {language === 'ar' ? AYA_MEMORY_CATEGORY_LABELS[category].ar : AYA_MEMORY_CATEGORY_LABELS[category].en}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            icon="plus"
            disabled={!newMemory.trim()}
            onClick={() =>
              void ayaApi
                .addMemory({ content: newMemory.trim(), category: newCategory })
                .then((result) => {
                  setMemories((current) => [result.memory, ...current]);
                  setNewMemory('');
                })
                .catch((cause) => setError(message(cause)))
            }
          >
            {language === 'ar' ? 'إضافة' : 'Add'}
          </Button>
        </div>
        <div className="space-y-1">
          {memories.length === 0 ? <p className="py-1 text-[11px] text-slate-400">{language === 'ar' ? 'لا ذكريات محفوظة بعد.' : 'No memories saved yet.'}</p> : null}
          {memories.slice(0, 8).map((memory) => (
            <div key={memory.id} className="group flex items-center gap-2 rounded-[7px] px-1.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <Pill tone="purple">{language === 'ar' ? AYA_MEMORY_CATEGORY_LABELS[memory.category].ar : AYA_MEMORY_CATEGORY_LABELS[memory.category].en}</Pill>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-600 dark:text-slate-300">{memory.content}</span>
              <button
                type="button"
                aria-label="حذف الذكرى"
                onClick={() => void ayaApi.deleteMemory(memory.id).then(() => setMemories((current) => current.filter((item) => item.id !== memory.id))).catch((cause) => setError(message(cause)))}
                className="text-slate-300 opacity-0 hover:text-rose-500 group-hover:opacity-100"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
        </div>
      </Block>

      <Block title={language === 'ar' ? 'القنوات' : 'Channels'} icon="message">
        <div className="space-y-2">
          {['telegram', 'whatsapp'].map((channelId) => {
            const channel = channels.find((item) => item.id === channelId);
            const enabled = channel?.enabled ?? false;
            return (
              <div key={channelId} className="rounded-[9px] border border-[#e2e8f0] p-2.5 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                    <Icon name={channelId === 'telegram' ? 'send' : 'message'} size={14} />
                    {channelId === 'telegram' ? 'Telegram' : 'WhatsApp'}
                  </span>
                  <Toggle
                    checked={enabled}
                    label={channelId}
                    onChange={(value) =>
                      void ayaApi
                        .updateChannel(channelId as 'telegram' | 'whatsapp', { enabled: value })
                        .then((result) => setChannels((current) => [...current.filter((item) => item.id !== channelId), result.channel]))
                        .catch((cause) => setError(message(cause)))
                    }
                  />
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <TextField
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={channelDraft[`${channelId}.token`] ?? ''}
                    onChange={(event) => setChannelDraft((current) => ({ ...current, [`${channelId}.token`]: event.target.value }))}
                    placeholder={channelId === 'telegram' ? 'Bot token' : 'Cloud API token'}
                    className="h-8"
                  />
                  <Button
                    variant="soft"
                    className="h-8 px-2 text-[10.5px]"
                    onClick={() =>
                      void ayaApi
                        .updateChannel(channelId as 'telegram' | 'whatsapp', { config: { token: channelDraft[`${channelId}.token`] ?? '' } })
                        .then((result) => setChannels((current) => [...current.filter((item) => item.id !== channelId), result.channel]))
                        .catch((cause) => setError(message(cause)))
                    }
                  >
                    {language === 'ar' ? 'حفظ' : 'Save'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Block>
    </div>
  );
}
