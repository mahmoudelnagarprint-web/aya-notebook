/**
 * Extension settings page.
 * All writes go to chrome.storage.local so the background worker and content
 * script pick them up next tick.
 */

import { useEffect, useState } from 'react';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../lib/core';

export default function SettingsPage() {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (r: any) => {
      setS(r[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS);
    });
  }, []);

  const save = async (patch: any) => {
    const next = { ...s, ...patch };
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
    setS(next);
    // Notify background to rebuild context menus (image menus respect selection pill)
    chrome.runtime.sendMessage({ type: 'aya-settings-changed' }).catch(() => {});
  };

  const handleSides = [
    { value: 'right', label: 'يمين' },
    { value: 'left', label: 'شمال' },
    { value: 'hidden', label: 'مخفي' },
  ] as const;

  const priorities = [
    { value: 4, label: 'P4 عادي' },
    { value: 3, label: 'P3 مهم' },
    { value: 2, label: 'P2 عاجل' },
    { value: 1, label: 'P1 ضروري' },
  ];

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', background: '#242424', color: '#fbfbfb', padding: 24, borderRadius: 16, fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Tahoma, sans-serif' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>إعدادات الآية · __AYAtodoist</h2>

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 6, letterSpacing: '.4px' }}>الخادم</h3>
                  <label style={{ display: 'block', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#9a9a9a', display: 'block', marginBottom: 2 }}>خادم الأساس</span>
          <input
            value={s?.serverBaseUrl || ''}
            onChange={(e) => save({ serverBaseUrl: e.target.value })}
            style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '7px 9px', fontSize: 12 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: '#9a9a9a', display: 'block', marginBottom: 2 }}>API Key (اختياري — لو مش بتستخدم الافتراضي)</span>
          <input
            type="password"
            value={s?.apiKey || ''}
            onChange={(e) => save({ apiKey: e.target.value })}
            placeholder="ZVcSKqjW9ptxesWXxUOmYDEWXYv1xQGUT1Aw4cKJ"
            style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '7px 9px', fontSize: 12 }}
          />
        </label>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 6, letterSpacing: '.4px' }}>الواجهة المطفوحة</h3>
        <label style={{ display: 'block', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#9a9a9a', display: 'block', marginBottom: 2 }}>لسان الحافة الجانبية</span>
          <select
            value={s?.handleSide || 'right'}
            onChange={(e) => save({ handleSide: e.target.value as any })}
            style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '7px 9px', fontSize: 12 }}
          >
            {handleSides.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: '#9a9a9a', display: 'block', marginBottom: 2 }}>إظهار شريط التحديد الطائر</span>
          <input
            type="checkbox"
            checked={s?.selectionPillEnabled !== false}
            onChange={(e) => save({ selectionPillEnabled: e.target.checked })}
            style={{ accentColor: '#de4c4a', width: 16, height: 16 }}
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 11, color: '#9a9a9a', display: 'block', marginBottom: 2 }}>تفعيل قراءة الصفحة المفتوحة مع رسائل آية</span>
          <input
            type="checkbox"
            checked={s?.pageContextEnabled !== false}
            onChange={(e) => save({ pageContextEnabled: e.target.checked })}
            style={{ accentColor: '#de4c4a', width: 16, height: 16 }}
          />
        </label>
        <label style={{ display: 'block', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#9a9a9a', display: 'block', marginBottom: 2 }}>حد نص الصفحة المرفق (حروف)</span>
          <input
            type="number"
            min={500}
            max={10000}
            value={s?.pageContextTrim ?? 4000}
            onChange={(e) => save({ pageContextTrim: Math.max(500, parseInt(e.target.value, 10) || 4000) })}
            style={{ width: 120, background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '5px 7px', fontSize: 12 }}
          />
        </label>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 6, letterSpacing: '.4px' }}>مهمة سريعة</h3>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 11, color: '#9a9a9a', display: 'block', marginBottom: 2 }}>الأولوية الافتراضية</span>
          <select
            value={s?.quickAddDefaultPriority ?? 3}
            onChange={(e) => save({ quickAddDefaultPriority: parseInt(e.target.value, 10) as 0 | 1 | 2 | 3 })}
            style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '7px 9px', fontSize: 12 }}
          >
            {priorities.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 6, letterSpacing: '.4px' }}>توقيف المواقع (عندما يكون الشريط الطائر مزعجًا)</h3>
        <textarea
          value={(() => { try { return JSON.stringify(s?.disableSites || []); } catch { return '[]'; } })()}
          onChange={(e) => {
            try { const v = JSON.parse(e.target.value) as string[]; save({ disableSites: v }); } catch { save({ disableSites: [] }); }
          }}
          placeholder='["https://example.com"]'
          style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '7px 9px', fontSize: 12, minHeight: 60 }}
        />
        <div style={{ fontSize: 10, color: '#9a9a9a', marginTop: 4 }}>أصل كل site، مثال: https://docs.google.com</div>
      </section>

      <div style={{ borderTop: '1px solid #323232', paddingTop: 12, fontSize: 11, color: '#9a9a9a', display: 'flex', justifyContent: 'space-between' }}>
        <span>تم حفظ الإعدادات تلقائيًا.</span>
        <button
          style={{ background: '#1e1e1e', color: '#de4c4a', border: '1px solid #de4c4a', borderRadius: 8, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
          onClick={async () => {
            await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
            setS(DEFAULT_SETTINGS);
            chrome.runtime.sendMessage({ type: 'aya-settings-changed' }).catch(() => {});
          }}
        >
          استعادة الإفتراضات
        </button>
      </div>
    </div>
  );
}
