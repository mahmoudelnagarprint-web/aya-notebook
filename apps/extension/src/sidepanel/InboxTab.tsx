/** Tab 3 — Aya's proactive inbox: execute or dismiss each card. */

import { useCallback, useEffect, useState } from 'react';
import { ayaServer, type InboxItem } from '../lib/server';

interface Props {
  refreshKey: number;
  onChanged: () => void;
}

const KIND_LABELS: Record<string, string> = {
  reminder: 'تذكير',
  suggestion: 'اقتراح',
  procrastination: 'تسويف',
  tip: 'نصيحة',
  followup: 'متابعة',
};

export default function InboxTab({ refreshKey, onChanged }: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await ayaServer.inbox();
      setItems(data.items.filter((item) => item.status !== 'dismissed'));
      setError('');
    } catch (err) {
      setError(`تعذر تحميل رسائل آية: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const act = async (item: InboxItem, action: 'execute' | 'dismiss') => {
    setBusy(item.id);
    setNotice('');
    try {
      const result = await ayaServer.inboxAction(item.id, action);
      const executed = Array.isArray(result?.executed) ? result.executed.length : 0;
      setNotice(
        action === 'dismiss'
          ? 'تم تجاهل الرسالة.'
          : executed > 0
            ? `✅ نفّذت آية ${executed} عملية.`
            : '✅ تم تنفيذ الإجراء.',
      );
      await load();
      onChanged();
    } catch (err) {
      setError(`تعذر تنفيذ الإجراء: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="row-between">
        <div>
          <div className="strong">رسائل آية الذكية</div>
          <div className="text-xs muted">تذكيرات واقتراحات مبنية على مهامك — نفّذيها بضغطة.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>⟳ تحديث</button>
      </div>

      {error && <div className="toast-inline err">{error}</div>}
      {notice && <div className="toast-inline">{notice}</div>}

      <div className="task-list">
        {loading && <div className="empty-state"><span className="spinner" /></div>}
        {!loading && items.length === 0 && (
          <div className="empty-state">مفيش رسائل جديدة دلوقتي — آية بتراقب مهامك وترجعلك أول ما تحتاج حاجة.</div>
        )}
        {items.map((item) => (
          <article key={item.id} className="card inbox-card">
            <div className="row-between">
              <span className="inbox-kind">{KIND_LABELS[item.kind] ?? 'رسالة آية'}</span>
              {item.status === 'done' && <span className="badge badge-done">تم</span>}
            </div>
            <div className="inbox-title">{item.title}</div>
            {item.body && <div className="inbox-body">{item.body}</div>}
            <div className="row wrap" style={{ marginTop: 2 }}>
              <button className="btn btn-primary btn-sm" disabled={busy === item.id} onClick={() => act(item, 'execute')}>
                {busy === item.id ? '⏳' : 'نفّذي ده'}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy === item.id} onClick={() => act(item, 'dismiss')}>
                تجاهل
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
