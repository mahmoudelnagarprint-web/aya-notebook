/**
 * Full Aya side panel: Tasks & notes, streaming AI workspace, proactive inbox
 * and settings/offline queue. Shares its data layer with the popup and the
 * in-page drawer.
 */

import { useCallback, useEffect, useState } from 'react';
import './sidepanel.css';
import { ayaServer } from '../lib/server';
import { filterCounts, loadData, type KernelData } from '../lib/tasks';
import { applyTheme, loadTheme, saveTheme, watchTheme, type Theme } from '../lib/theme';
import { openWebApp } from '../lib/browser';
import { takePendingPrompt, watchPendingPrompt, type PendingPrompt } from '../lib/pending';
import TasksTab from './TasksTab';
import AyaTab from './AyaTab';
import InboxTab from './InboxTab';
import SettingsTab from './SettingsTab';

type TabKey = 'tasks' | 'aya' | 'inbox' | 'settings';

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'tasks', label: 'مهامي وملاحظاتي', icon: '📋' },
  { key: 'aya', label: 'آية ✨', icon: '🤖' },
  { key: 'inbox', label: 'رسائل آية', icon: '🔔' },
  { key: 'settings', label: 'الإعدادات والطابور', icon: '⚙️' },
];

export default function SidePanel() {
  const [tab, setTab] = useState<TabKey>('tasks');
  const [theme, setTheme] = useState<Theme>('light');
  const [online, setOnline] = useState<boolean | null>(null);
  const [counts, setCounts] = useState({ all: 0, today: 0, inbox: 0, notes: 0, projects: 0 });
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const data: KernelData = await loadData();
      const next = filterCounts(data);
      setCounts(next);
      setOnline(true);
    } catch {
      setOnline(false);
    }
    try {
      const inbox = await ayaServer.inbox();
      setUnread(inbox.items.filter((item) => (item.status ?? 'unread') === 'unread').length);
    } catch {
      /* keep the previous count */
    }
  }, []);

  useEffect(() => {
    loadTheme().then((value) => {
      setTheme(value);
      applyTheme(value);
    });
    watchTheme((value) => {
      setTheme(value);
      applyTheme(value);
    });
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    takePendingPrompt().then((prompt) => {
      if (prompt) {
        setPending(prompt);
        setTab('aya');
      }
    });
    watchPendingPrompt((prompt) => {
      setPending(prompt);
      setTab('aya');
    });
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  };

  const handleChanged = useCallback(() => {
    setTick((value) => value + 1);
    refresh();
  }, [refresh]);

  return (
    <div className="sp-app">
      <header className="sp-header">
        <div className="sp-brand">
          <div className="brand-mark">آ</div>
          <div>
            <div className="brand-title">آية · __AYAtodoist</div>
            <div className="brand-sub">
              <span className={`dot ${online === false ? 'dot-red' : online ? 'dot-green' : 'dot-gray'}`} />
              {online === false ? 'أوفلاين' : online ? 'متصل' : 'جارٍ الاتصال'}
              {unread > 0 && <span>· {unread} رسالة جديدة</span>}
            </div>
          </div>
        </div>
        <div className="sp-header-actions">
          <button className="hdr-btn" title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'} onClick={toggleTheme}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="hdr-btn" title="فتح تطبيق الويب" onClick={() => openWebApp()}>
            ↗
          </button>
          <button className="hdr-btn" title="تحديث" onClick={handleChanged}>
            ⟳
          </button>
        </div>
      </header>

      <nav className="sp-tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            className={`sp-tab ${tab === item.key ? 'active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            <span className="sp-tab-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.key === 'inbox' && unread > 0 && <span className="sp-tab-count">{unread > 99 ? '99+' : unread}</span>}
            {item.key === 'tasks' && counts.today > 0 && <span className="sp-tab-count" style={{ background: 'var(--blue)' }}>{counts.today}</span>}
          </button>
        ))}
      </nav>

      <main className="sp-main">
        {tab === 'tasks' && <TasksTab refreshKey={tick} onChanged={handleChanged} counts={counts} />}
        {tab === 'aya' && (
          <AyaTab
            pending={pending}
            onPendingConsumed={() => setPending(null)}
            onActivity={handleChanged}
          />
        )}
        {tab === 'inbox' && <InboxTab refreshKey={tick} onChanged={handleChanged} />}
        {tab === 'settings' && <SettingsTab onChanged={handleChanged} />}
      </main>
    </div>
  );
}
