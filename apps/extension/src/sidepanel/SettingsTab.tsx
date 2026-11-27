/** Tab 4 — connection settings, side handle, selection toolbar and offline queue. */

import { useCallback, useEffect, useState } from 'react';
import { ayaServer, invalidateConfig } from '../lib/server';
import { flushQueue, readQueue, type QueueState } from '../lib/queue';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../lib/core';
import { openWebApp } from '../lib/browser';

interface Props {
  onChanged: () => void;
}

type HandleSide = 'right' | 'left' | 'hidden';

export default function SettingsTab({ onChanged }: Props) {
  const [settings, setSettings] = useState<Record<string, any>>({ ...DEFAULT_SETTINGS });
  const [queue, setQueue] = useState<QueueState>({ operations: [], lastAttemptAt: null });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const stored = (await chrome.storage.local.get([STORAGE_KEYS.SETTINGS])) as Record<string, any>;
    setSettings({ ...DEFAULT_SETTINGS, ...(stored?.[STORAGE_KEYS.SETTINGS] ?? {}) });
    setQueue(await readQueue());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
    await chrome.storage.local.set({ 'aya:server': { baseUrl: next.serverBaseUrl, token: next.bearerToken } });
    invalidateConfig();
    try {
      await chrome.runtime.sendMessage({ type: 'aya-settings-changed' });
    } catch {
      /* background may be asleep */
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setResult('');
    setError('');
    try {
      invalidateConfig();
      const health = await ayaServer.health();
      const inbox = await ayaServer.inbox().catch(() => ({ items: [] }));
      setResult(`✅ متصل · ${health.at ? new Date(health.at).toLocaleTimeString('ar-EG') : ''} · ${inbox.items.length} رسالة في الوارد`);
    } catch (err) {
      setError(`❌ تعذر الاتصال: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  const syncQueue = async () => {
    setSyncing(true);
    setResult('');
    try {
      const res = await flushQueue();
      setQueue(await readQueue());
      setResult(res.flushed ? `✅ تمت مزامنة ${res.flushed} عملية.` : 'مفيش عمليات اتمدت — الخادم قد يكون أوفلاين.');
      onChanged();
    } catch (err) {
      setError(`تعذرت المزامنة: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <section className="card settings-section">
        <div className="settings-title">🔌 الاتصال بالخادم</div>
        <div>
          <label className="field-label">خادم الأساس</label>
          <input
            className="input"
            value={settings.serverBaseUrl ?? ''}
            placeholder="http://127.0.0.1:8787"
            onChange={(event) => setSettings({ ...settings, serverBaseUrl: event.target.value })}
            onBlur={(event) => save({ serverBaseUrl: event.target.value.trim() })}
          />
        </div>
        <div>
          <label className="field-label">Bearer Token (اختياري)</label>
          <input
            className="input"
            type="password"
            value={settings.bearerToken ?? ''}
            placeholder="للنشر السحابي فقط"
            onChange={(event) => setSettings({ ...settings, bearerToken: event.target.value })}
            onBlur={(event) => save({ bearerToken: event.target.value.trim() })}
          />
        </div>
        <div className="row wrap">
          <button className="btn btn-blue btn-sm" onClick={testConnection} disabled={testing}>
            {testing ? '⏳ جاري الاختبار…' : 'اختبار الاتصال'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => openWebApp()}>فتح تطبيق الويب ↗</button>
        </div>
        {result && <div className="toast-inline">{result}</div>}
        {error && <div className="toast-inline err">{error}</div>}
      </section>

      <section className="card settings-section">
        <div className="settings-title">🎛️ التجربة داخل الصفحة</div>
        <div className="setting-row">
          <div>
            <div className="label">موضع اللسان الجانبي</div>
            <div className="hint">حافة الشاشة اللي بيظهر عليها لسان آية العائم</div>
          </div>
          <select
            className="select"
            style={{ width: 110 }}
            value={settings.handleSide ?? 'right'}
            onChange={(event) => save({ handleSide: event.target.value as HandleSide })}
          >
            <option value="right">يمين</option>
            <option value="left">شمال</option>
            <option value="hidden">مخفي</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <div className="label">شريط التحديد الطائر</div>
            <div className="hint">مهمة + · ملاحظة · تشيك بوكس · آية عند تحديد نص</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.selectionPillEnabled !== false}
              onChange={(event) => save({ selectionPillEnabled: event.target.checked })}
            />
            <span className="switch-track" />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <div className="label">إرفاق نص الصفحة تلقائياً</div>
            <div className="hint">عند فتح بار آية، يتم إرسال ملخص الصفحة مع أول رسالة</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.pageContextEnabled !== false}
              onChange={(event) => save({ pageContextEnabled: event.target.checked })}
            />
            <span className="switch-track" />
          </label>
        </div>
      </section>

      <section className="card settings-section">
        <div className="row-between">
          <div className="settings-title">📥 طابور الأوفلاين ({queue.operations.length})</div>
          <button className="btn btn-purple btn-sm" onClick={syncQueue} disabled={syncing || queue.operations.length === 0}>
            {syncing ? '⏳' : 'مزامنة الآن'}
          </button>
        </div>
        {queue.lastAttemptAt && (
          <div className="text-xs muted">آخر محاولة: {new Date(queue.lastAttemptAt).toLocaleString('ar-EG')}</div>
        )}
        {queue.operations.length === 0 ? (
          <div className="empty-state">كل حاجة متزامنة ✅<br />أي مهمة تضيفيها وقت انقطاع الخادم هتتحفظ هنا وتتبعت تلقائياً.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {queue.operations.map((op) => (
              <div key={op.id} className="queue-item">
                <div className="grow">
                  <div className="queue-name">{op.name}</div>
                  <div className="truncate">{(op.input as any)?.content ?? (op.input as any)?.title ?? ''}</div>
                </div>
                <span className="queue-time">{new Date(op.createdAt).toLocaleTimeString('ar-EG')}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
