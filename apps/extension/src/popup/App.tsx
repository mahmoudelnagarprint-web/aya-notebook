/** Toolbar popup: live KPIs, one-line quick add and the three main entry points. */

import { useCallback, useEffect, useState } from 'react';
import { ayaServer } from '../lib/server';
import { enqueueOperation, queueStatus } from '../lib/queue';
import { filterCounts, loadData, parseQuickAdd, createTask, NOTE_LABEL } from '../lib/tasks';
import { applyTheme, loadTheme, saveTheme, watchTheme, type Theme } from '../lib/theme';
import { getActiveTab, openSidePanel, openWebApp, sendToTab } from '../lib/browser';

export default function Popup() {
  const [theme, setTheme] = useState<Theme>('light');
  const [online, setOnline] = useState<boolean | null>(null);
  const [counts, setCounts] = useState({ all: 0, today: 0, inbox: 0, notes: 0, projects: 0 });
  const [unread, setUnread] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [quick, setQuick] = useState('');
  const [mode, setMode] = useState<'task' | 'note'>('task');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    loadTheme().then((value) => {
      setTheme(value);
      applyTheme(value);
    });
    try {
      const data = await loadData();
      setCounts(filterCounts(data));
      setOnline(true);
      const inbox = await ayaServer.inbox();
      setUnread(inbox.items.filter((item) => (item.status ?? 'unread') === 'unread').length);
    } catch {
      setOnline(false);
    }
    const queue = await queueStatus();
    setQueueCount(queue.count);
  }, []);

  useEffect(() => {
    load();
    watchTheme((value) => {
      setTheme(value);
      applyTheme(value);
    });
  }, [load]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  };

  const add = async () => {
    const raw = quick.trim();
    if (!raw || saving) return;
    setSaving(true);
    setNotice('');
    setError('');
    const parsed = parseQuickAdd(raw);
    const input = {
      content: mode === 'note' ? `📝 ${parsed.content}` : parsed.content,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      labelNames: mode === 'note' ? [NOTE_LABEL] : parsed.labels,
    };
    try {
      await ayaServer.command('task.create', input);
      setQuick('');
      setNotice(mode === 'note' ? '📝 تم حفظ الملاحظة' : '✓ تمت إضافة المهمة');
      setCounts((prev) => ({ ...prev, ...(mode === 'note' ? { notes: prev.notes + 1 } : { all: prev.all + 1 }) }));
    } catch {
      await enqueueOperation({ name: 'task.create', input, actor: 'user', confirmed: true });
      setQuick('');
      setQueueCount((prev) => prev + 1);
      setNotice('📥 أوفلاين — اتخزنت في الطابور');
    } finally {
      setSaving(false);
    }
  };

  const openDrawer = async () => {
    const tab = await getActiveTab();
    if (tab?.id) {
      const response = await sendToTab(tab.id, { type: 'aya-toggle-drawer' });
      if (response) {
        window.close();
        return;
      }
    }
    await openSidePanel();
    window.close();
  };

  const openPanel = async () => {
    await openSidePanel();
    window.close();
  };

  return (
    <div className="popup">
      <header className="popup-head">
        <div className="popup-brand">
          <div className="brand-mark">آ</div>
          <div>
            <div className="popup-title">آية · __AYAtodoist</div>
            <div className="popup-sub">
              <span className={`dot ${online === false ? 'dot-red' : online ? 'dot-green' : 'dot-gray'}`} />
              {online === false ? 'أوفلاين' : online ? 'متصل' : 'جارٍ الفحص'}
              {queueCount > 0 && <span>· {queueCount} بالطابور</span>}
            </div>
          </div>
        </div>
        <button className="hdr-btn" onClick={toggleTheme} title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      <div className="popup-body">
        <div className="popup-kpis">
          <div className="popup-kpi blue">
            <div className="popup-kpi-value">{counts.today}</div>
            <div className="popup-kpi-label">مهام اليوم</div>
          </div>
          <div className="popup-kpi">
            <div className="popup-kpi-value">{counts.inbox}</div>
            <div className="popup-kpi-label">الوارد</div>
          </div>
          <div className="popup-kpi red">
            <div className="popup-kpi-value">{unread}</div>
            <div className="popup-kpi-label">رسائل آية</div>
          </div>
        </div>

        <div className="card popup-quick">
          <div className="qa-row">
            <input
              className="input grow"
              placeholder={mode === 'note' ? 'ملاحظة سريعة…' : 'مهمة سريعة… (p2 #عمل !today)'}
              value={quick}
              onChange={(event) => setQuick(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add();
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={add} disabled={saving || !quick.trim()}>
              {saving ? '…' : 'إضافة'}
            </button>
          </div>
          <div className="row">
            <div className="segmented">
              <button className={mode === 'task' ? 'active' : ''} onClick={() => setMode('task')}>مهمة</button>
              <button className={mode === 'note' ? 'active' : ''} onClick={() => setMode('note')}>ملاحظة</button>
            </div>
            <span className="text-xs muted">Enter للإضافة</span>
          </div>
        </div>

        {notice && <div className="popup-toast">{notice}</div>}
        {error && <div className="popup-toast err">{error}</div>}

        <div className="popup-actions">
          <button className="btn btn-blue" onClick={openPanel}>اللوحة الجانبية</button>
          <button className="btn btn-purple" onClick={openDrawer}>بار آية العائم</button>
          <button className="btn btn-ghost" onClick={() => openWebApp()} style={{ gridColumn: '1 / -1' }}>
            فتح تطبيق الويب ↗
          </button>
        </div>
      </div>

      <div className="popup-foot">
        <span>Alt+Shift+A بار آية · Alt+Q مهمة سريعة</span>
        <button
          className="mini-btn"
          title="الإعدادات"
          onClick={() => chrome.runtime.openOptionsPage?.()}
        >
          ⚙️
        </button>
      </div>
    </div>
  );
}
