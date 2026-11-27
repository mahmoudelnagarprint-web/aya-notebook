import { useCallback, useEffect, useState } from 'react';
import type { AyaInboxItem } from '@ayatodoist/shared-types';
import { AYA_INBOX_KIND_LABELS } from '@ayatodoist/shared-types';
import { useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Button, Card, EmptyState, Icon, Pill, SectionHeading, cn } from '@ayatodoist/plugin-sdk/ui';
import { AyaApiError, ayaApi } from '../aya-client';

const KIND_STYLE: Record<string, { tone: 'blue' | 'amber' | 'purple' | 'rose' | 'green'; icon: string }> = {
  question: { tone: 'blue', icon: 'message' },
  reminder: { tone: 'amber', icon: 'bell' },
  organization: { tone: 'purple', icon: 'folder' },
  procrastination: { tone: 'rose', icon: 'alert' },
  tip: { tone: 'green', icon: 'sparkles' },
};

/**
 * «رسائل آية» — proactive inbox. Each item can be executed, discussed in the
 * chat drawer, marked done or dismissed.
 */
export function AyaInboxView({ onDiscuss, onAddTask }: { onDiscuss?: (text: string) => void; onAddTask?: () => void }) {
  const language = useLanguage();
  const [items, setItems] = useState<AyaInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ayaApi.inbox();
      setItems(result.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof AyaApiError ? cause.message : (cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'execute' | 'done' | 'dismissed') => {
    setBusyId(id);
    try {
      if (action === 'execute') await ayaApi.executeInbox(id);
      else await ayaApi.setInboxStatus(id, action);
      setItems((current) => current.map((item) => (item.id === id ? { ...item, status: action === 'execute' ? 'done' : action } : item)));
    } catch (cause) {
      setError(cause instanceof AyaApiError ? cause.message : (cause as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const visible = items.filter((item) => item.status === 'unread' || item.status === 'read');

  return (
    <div className="space-y-4">
      <SectionHeading
        title={language === 'ar' ? 'رسائل آية' : 'Aya inbox'}
        subtitle={language === 'ar' ? 'تذكيرات ومقترحات استباقية من وكيلتك' : 'Proactive reminders and suggestions from your agent'}
        icon="bell"
        tone="purple"
        action={
          <Button variant="soft" icon="refresh" onClick={() => void load()}>
            {language === 'ar' ? 'تحديث' : 'Refresh'}
          </Button>
        }
      />

      {error ? (
        <Card className="border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
          <p className="flex items-center gap-2 text-[12px] font-bold text-amber-800 dark:text-amber-200">
            <Icon name="alert" size={15} />
            {language === 'ar' ? 'تعذّر تحميل رسائل آية' : 'Could not load Aya messages'}
          </p>
          <p className="mt-1 text-[11.5px] leading-6 text-amber-700/90 dark:text-amber-200/80">{error}</p>
          <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-200/70">
            {language === 'ar' ? 'تأكدي أن خادم آية يعمل، ثم أضيفي مزوّدًا من الإعدادات ← آية.' : 'Make sure the Aya server is running, then add a provider in Settings → Aya.'}
          </p>
        </Card>
      ) : null}

      {loading ? (
        <Card className="p-6 text-center text-[12px] text-slate-400">{language === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="bell"
            title={language === 'ar' ? 'لا رسائل جديدة' : 'No new messages'}
            body={language === 'ar' ? 'ستظهر هنا تذكيرات آية واقتراحاتها لتنظيم يومك.' : 'Aya’s reminders and suggestions will appear here.'}
            action={onAddTask ? <Button variant="soft" icon="plus" onClick={onAddTask}>{language === 'ar' ? 'أضف مهمة' : 'Add a task'}</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {visible.map((item) => {
            const style = KIND_STYLE[item.kind] ?? KIND_STYLE.tip!;
            return (
              <Card key={item.id} className="p-3.5">
                <div className="flex items-start gap-3">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', style.tone === 'blue' && 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300', style.tone === 'amber' && 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300', style.tone === 'purple' && 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300', style.tone === 'rose' && 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', style.tone === 'green' && 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300')}>
                    <Icon name={style.icon} size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{item.title}</h3>
                      <Pill tone={style.tone}>{language === 'ar' ? AYA_INBOX_KIND_LABELS[item.kind].ar : AYA_INBOX_KIND_LABELS[item.kind].en}</Pill>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-slate-600 dark:text-slate-300">{item.body}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Button variant="primary" icon="check" className="h-7 px-2 text-[11px]" disabled={busyId === item.id} onClick={() => void act(item.id, 'execute')}>
                        {language === 'ar' ? 'نفّذي ده' : 'Do it'}
                      </Button>
                      <Button variant="soft" icon="chat" className="h-7 px-2 text-[11px]" onClick={() => onDiscuss?.(`${item.title}\n${item.body}`)}>
                        {language === 'ar' ? 'ناقشيني فيه' : 'Discuss'}
                      </Button>
                      <Button variant="soft" icon="checkCircle" className="h-7 px-2 text-[11px]" disabled={busyId === item.id} onClick={() => void act(item.id, 'done')}>
                        {language === 'ar' ? 'تم' : 'Done'}
                      </Button>
                      <Button variant="ghost" icon="close" className="h-7 px-2 text-[11px]" disabled={busyId === item.id} onClick={() => void act(item.id, 'dismissed')}>
                        {language === 'ar' ? 'تجاهل' : 'Dismiss'}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
