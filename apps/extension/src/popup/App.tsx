/**
 * Toolbar popup for the extension.
 * Lightweight React shell using the existing app's CSS design tokens via Tailwind
 * config + the same color palette (ink/panel/line/hover/task/aya).
 */

import { useEffect, useState } from 'react';
import { ayaServer } from '../lib/server';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../lib/core';

export default function Popup() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [unread, setUnread] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [settings, setSettings] = useState<any>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const refresh = async () => {
    const h = await ayaServer.health().catch(() => null);
    setStatus(h ? 'online' : 'offline');
    const qq = (await import('../lib/queue')).queueStatus();
    qq.then((q) => setQueueCount(q.count));

    await new Promise<void>((r) => setTimeout(r, 0));
    const unreadLocal = await new Promise<number>((r) => chrome.storage.local.get([STORAGE_KEYS.UNREAD], (res: any) => { const v = res?.[STORAGE_KEYS.UNREAD] ?? 0; r(v); }));
    const acts = await ayaServer.inboxUnread().catch(() => ({ items: [] } as any));
    const delta = Math.min((acts?.items?.length ?? 0), 99);
    setUnread(delta > 0 ? delta : unreadLocal);
        const ss = await new Promise<any>((r) => chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (res: any) => { const v = res?.[STORAGE_KEYS.SETTINGS] ?? DEFAULT_SETTINGS; r(v); }));
    setSettings(ss);
  };


  useEffect(() => { refresh(); }, []);

  const saveSettings = async (patch: any) => {
    const merged = { ...settings, ...patch };
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
    setSettings(merged);
    // invalidate cached config in background so next requests use new URL
    await chrome.runtime.sendMessage({ type: 'aya-invalidate-config' }).catch(() => {});
  };

  const testConnection = async () => {
    setTestResult('جاري الاختبار…');
    try {
      const h = await ayaServer.health();
      setTestResult(`✅ متصل · ${h.name} · أداة آية: ${h.aya?.enabled ? 'مفعّلة' : 'غير مفعلة'} · ${h.tools} أداة`);
    } catch (e: any) {
      setTestResult(`❌ غير متصل: ${e?.status || e}`);
    }
  };

  const handleSideOptions = [
    { value: 'right', label: 'يمين' },
    { value: 'left', label: 'شمال' },
    { value: 'hidden', label: 'مخفي' },
  ] as const;

  return (
    <div style={{ width: 320, background: '#242424', color: '#fbfbfb', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Tahoma, sans-serif', minHeight: 380 }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #323232', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#de4c4a,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11 }}>آ</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>آية ✨</div>
        </div>
        <span style={{ fontSize: 10, color: status === 'online' ? '#8b5cf6' : '#ff8a82', fontWeight: 600 }}>
          {status === 'online' ? 'متصل' : status === 'checking' ? 'جارٍ الفحص' : 'غير متصل'}
        </span>
      </div>

      {/* Status row */}
      <div style={{ padding: '10px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#9a9a9a' }}>
          {(() => {
            if (!settings) return 'جارٍ التحميل…';
            const url = settings.serverBaseUrl;
            const token = settings.bearerToken ? ' مع token' : '';
            return `خادم·${url}${token}`;
          })()}
        </span>
        {unread > 0 && (
          <span style={{ fontSize: 11, color: '#de4c4a', fontWeight: 600 }}>
            رسائل آية الجديدة: {unread}
          </span>
        )}
        {queueCount > 0 && (
          <span style={{ fontSize: 11, color: '#8b5cf6', fontWeight: 600 }}>
            في قائمة الانتظار: {queueCount}
          </span>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ padding: '8px 12px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          style={quickBtnStyle()}
          onClick={() => {               chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => { const t: any = tabs[0]; if (t?.id) chrome.tabs.sendMessage(t.id, { type: 'aya-toggle-drawer' }).catch(() => chrome.action.openPopup?.()); else chrome.action.openPopup?.(); }); }}
        >
          فتح بار آية
        </button>
        <button
          style={quickBtnStyle()}
          onClick={() => {               chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => { const t: any = tabs[0]; if (t?.id) chrome.tabs.sendMessage(t.id, { type: 'aya-toggle-quick-add' }).catch(() => chrome.action.openPopup?.()); else chrome.action.openPopup?.(); }); }}
        >
          مهمة سريعة
        </button>
        <button
            style={quickBtnStyle()}
            onClick={() => {
              chrome.windows.getLastFocused({}, (w: any) => {
                chrome.sidePanel.open({ windowId: (w as any)?.id });
              });
            }}
          >
            اللوحة الجانبية
          </button>
        <button style={quickBtnStyle()} onClick={() => chrome.tabs.create({ url: 'http://127.0.0.1:5173/#/inbox' })}>
          فتح النوتبوك
        </button>
      </div>

      {/* Offline queue flush */}
      {queueCount > 0 && (
        <div style={{ padding: '0 12px 8px' }}>
          <button
            style={{ background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 11, cursor: 'pointer' }}
            onClick={async () => {
              const res = await (await import('../lib/queue')).flushQueue();
              if (res.failed === 0) setQueueCount(0);
              else setQueueCount(res.failed);
            }}
          >
            مزامنة الآن ({queueCount})
          </button>
        </div>
      )}

      {/* Settings */}
      <div style={{ borderTop: '1px solid #323232', padding: '10px 12px' }}>
        <div style={{ fontSize: 10, color: '#9a9a9a', marginBottom: 6, letterSpacing: '.4px' }}>الإعدادات</div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 10, color: '#9a9a9a', marginBottom: 3 }}>خادم الأساس</label>
          <input
            value={settings?.serverBaseUrl || ''}
            onChange={(e) => saveSettings({ serverBaseUrl: e.target.value })}
            style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '5px 7px', fontSize: 11 }}
          />
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 10, color: '#9a9a9a', marginBottom: 3 }}>
            Bearer Token (اختياري لبورصات السحاب)
          </label>
          <input
            type="password"
            value={settings?.bearerToken || ''}
            onChange={(e) => saveSettings({ bearerToken: e.target.value })}
            placeholder="مثال: sk-…"
            style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '5px 7px', fontSize: 11 }}
          />
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 10, color: '#9a9a9a', marginBottom: 3 }}>اللسان الجانبي</label>
          <select
            value={settings?.handleSide || 'right'}
            onChange={(e) => saveSettings({ handleSide: e.target.value as any })}
            style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '5px 7px', fontSize: 11 }}
          >
            {handleSideOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#fbfbfb' }}>شريط التحديد الطائر</span>
          <input
            type="checkbox"
            checked={settings?.selectionPillEnabled !== false}
            onChange={(e) => saveSettings({ selectionPillEnabled: e.target.checked })}
            style={{ accentColor: '#de4c4a' }}
          />
        </div>

        <button
          style={{ width: '100%', background: '#1e1e1e', color: '#de4c4a', border: '1px solid #de4c4a', borderRadius: 8, padding: '6px 8px', fontSize: 11, cursor: 'pointer' }}
          onClick={testConnection}
        >
          اختبار الاتصال
        </button>

        {testResult && (
          <div style={{ marginTop: 6, fontSize: 11, color: testResult.startsWith('✅') ? '#8b5cf6' : testResult.startsWith('❌') ? '#ff8a82' : '#9a9a9a' }}>
            {testResult}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '6px 12px', borderTop: '1px solid #323232', fontSize: 10, color: '#9a9a9a', textAlign: 'center' }}>
        Ipv6-ready · Alt+A بار آية · Alt+Q مهمة سريعة
      </div>
    </div>
  );
}

function quickBtnStyle() {
  return {
    background: '#de4c4a',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    flex: '1 1 auto',
    minWidth: 80,
  };
}
