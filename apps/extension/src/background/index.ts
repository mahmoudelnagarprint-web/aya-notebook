/**
 * Background service worker (Manifest V3).
 *
 * Owns the hierarchical right-click menu, cross-origin calls to the local
 * server (content scripts cannot fetch it directly), the toolbar badge, the
 * offline queue and the streaming chat proxy used by the in-page drawer.
 */

import { ayaServer } from '../lib/server';
import { ensureStorage, STORAGE_KEYS, DEFAULT_SETTINGS } from '../lib/core';
import { enqueueOperation, flushQueue } from '../lib/queue';
import { pushPendingPrompt } from '../lib/pending';
import { splitLinesToChecklist } from '../lib/helpers';

const ROOT = 'aya-root';
const MENU = {
  addTask: 'aya-selection-task',
  note: 'aya-selection-note',
  checklist: 'aya-selection-checklist',
  ask: 'aya-selection-ask',
  imageAnalyze: 'aya-image-analyze',
  imageTask: 'aya-image-task',
  savePage: 'aya-page-save',
  summarize: 'aya-page-summarize',
} as const;

/* ------------------------------------------------------------- bootstrap */

// No top-level await: MV3 service workers reject it. Listeners below still
// register synchronously, and bootstrap finishes on its own microtask.
void (async () => {
  await ensureStorage();
  buildContextMenus();
  startupAlarms();
  await refreshBadge();
})();

/* ---------------------------------------------------------- context menus */

function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ROOT,
      title: '__AYAtodoist · آية',
      contexts: ['selection', 'image', 'page', 'link'],
    });

    const items: Array<{ id: string; title: string; contexts: string[] }> = [
      { id: MENU.addTask, title: '➕ إضافة كمهمة في النوتبوك', contexts: ['selection'] },
      { id: MENU.note, title: '📝 حفظ كملاحظة / مرجع', contexts: ['selection'] },
      { id: MENU.checklist, title: '☑️ تحويل إلى قائمة تشيك بوكس', contexts: ['selection'] },
      { id: MENU.ask, title: '✨ اسألي / عالجي النص مع آية', contexts: ['selection'] },
      { id: MENU.imageAnalyze, title: '🖼️ تحليل الصورة واستخراج مهام مع آية', contexts: ['image'] },
      { id: MENU.imageTask, title: '📌 حفظ الصورة داخل مهمة', contexts: ['image'] },
      { id: MENU.savePage, title: '🔖 حفظ الصفحة / الرابط للمراجعة', contexts: ['page', 'link'] },
      { id: MENU.summarize, title: '🧠 لخّصي الصفحة دي يا آية', contexts: ['page'] },
    ];
    for (const item of items) {
      chrome.contextMenus.create({ ...item, parentId: ROOT });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  buildContextMenus();
  void refreshBadge();
});
chrome.runtime.onStartup.addListener(() => {
  buildContextMenus();
  void refreshBadge();
});

chrome.contextMenus.onClicked.addListener((info: any, tab: any) => {
  void handleMenuClick(String(info.menuItemId), info, tab);
});

async function handleMenuClick(id: string, info: any, tab: any) {
  const tabId: number | undefined = tab?.id;
  const pageUrl: string = info.pageUrl || tab?.url || '';
  const pageTitle: string = tab?.title || '';

  if (id === MENU.addTask) {
    const selection = String(info.selectionText ?? '').trim();
    if (!selection) return toastTab(tabId, 'لا يوجد نص مختار');
    const title = firstLine(selection);
    const input = {
      content: title,
      description: `${selection}\n\nالمصدر: ${pageTitle || pageUrl} (${pageUrl})`,
      labelNames: undefined as string[] | undefined,
    };
    const outcome = await createWithOffline(input);
    toastTab(tabId, outcome === 'sent' ? '✓ تمت إضافة المهمة إلى الوارد' : '📥 أوفلاين — هتتبعت أول ما الاتصال يرجع');
    return;
  }

  if (id === MENU.note) {
    const selection = String(info.selectionText ?? '').trim();
    if (!selection) return toastTab(tabId, 'لا يوجد نص مختار');
    const title = firstLine(selection);
    const input = {
      content: `📝 ${title}`,
      description: `${selection}\n\nالمصدر: ${pageTitle || pageUrl} (${pageUrl})`,
      labelNames: ['ملاحظة'],
    };
    const outcome = await createWithOffline(input);
    toastTab(tabId, outcome === 'sent' ? '📝 تم حفظ الملاحظة في النوتبوك' : '📥 أوفلاين — الملاحظة في الطابور');
    return;
  }

  if (id === MENU.checklist) {
    const selection = String(info.selectionText ?? '').trim();
    if (!selection) return toastTab(tabId, 'لا يوجد نص مختار');
    const items = splitLinesToChecklist(selection);
    if (!items.length) return toastTab(tabId, 'لم أجد بنوداً في النص المختار');
    try {
      const created = await ayaServer.command<{ id: string }>('task.create', {
        content: `☑️ قائمة تشيك بوكس (${items.length})`,
        description: `المصدر: ${pageTitle || pageUrl} (${pageUrl})`,
      });
      await ayaServer.command('task.update', {
        id: created.id,
        checklist: items.map((text, index) => ({ id: `chk-${Date.now()}-${index}`, text, checked: false, image: null })),
      });
      toastTab(tabId, `☑️ تم إنشاء القائمة بـ ${items.length} بند`);
    } catch {
      toastTab(tabId, 'تعذر إنشاء القائمة — تأكد أن الخادم يعمل');
    }
    return;
  }

  if (id === MENU.ask) {
    const selection = String(info.selectionText ?? '').trim();
    if (!selection) return toastTab(tabId, 'لا يوجد نص مختار');
    await openAyaWithText(
      tabId,
      `اسألي عن النص المحدد ده:\n«${selection}»\n\nالمصدر: ${pageTitle || pageUrl}\n${pageUrl}`,
    );
    return;
  }

  if (id === MENU.imageAnalyze || id === MENU.imageTask) {
    const srcUrl: string = info.srcUrl || '';
    if (!srcUrl) return toastTab(tabId, 'الصورة غير متاحة');
    const upload = await uploadRemoteImage(srcUrl, tabId);
    if (!upload) return;
    if (id === MENU.imageTask) {
      const outcome = await createWithOffline({
        content: `🖼️ صورة: ${pageTitle || 'من الصفحة'}`,
        description: `الصورة: ${upload.absoluteUrl}\nالصفحة: ${pageTitle || pageUrl}\n${pageUrl}`,
        labelNames: ['صورة'],
      });
      toastTab(tabId, outcome === 'sent' ? '✓ تم حفظ الصورة داخل مهمة جديدة' : '📥 أوفلاين — الصورة في الطابور');
    } else {
      await openAyaWithText(tabId, 'حلّلي الصورة دي واستخرجي المهام أو الأفكار المهمة منها.', upload.absoluteUrl, upload.dataUrl);
      toastTab(tabId, '🖼️ الصورة اترفعت لآية');
    }
    return;
  }

  if (id === MENU.savePage) {
    const targetUrl: string = info.linkUrl || pageUrl;
    const title: string = info.linkText || pageTitle || targetUrl;
    const outcome = await createWithOffline({
      content: `🔖 ${title}`.slice(0, 180),
      description: `الرابط: ${targetUrl}\n${pageTitle && info.linkUrl ? `الصفحة: ${pageTitle}` : ''}`,
      labelNames: ['مراجعة'],
    });
    toastTab(tabId, outcome === 'sent' ? '✓ تم حفظ الصفحة للمراجعة' : '📥 أوفلاين — الصفحة في الطابور');
    return;
  }

  if (id === MENU.summarize) {
    const context = await requestPageText(tabId);
    const prompt = [
      `لخّصي الصفحة دي واستخرجي المهام والأفكار المهمة:`,
      `العنوان: ${context?.title || pageTitle}`,
      `الرابط: ${context?.url || pageUrl}`,
      context?.text ? `\nالنص:\n${context.text}` : '',
    ].join('\n');
    await openAyaWithText(tabId, prompt);
    return;
  }
}

/* ------------------------------------------------------------- helpers */

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).map((row) => row.trim()).find(Boolean) ?? 'مهمة جديدة';
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

function toastTab(tabId: number | undefined, message: string): void {
  if (tabId) {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'aya-toast', message }, () => {
        if (chrome.runtime?.lastError) notify(message);
      });
      return;
    } catch {
      /* fall through */
    }
  }
  notify(message);
}

function notify(message: string): void {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'آية · __AYAtodoist',
      message,
    });
  } catch {
    /* notifications may be disabled */
  }
}

async function createWithOffline(input: Record<string, unknown>): Promise<'sent' | 'queued'> {
  try {
    await ayaServer.command('task.create', input);
    return 'sent';
  } catch {
    await enqueueOperation({ name: 'task.create', input, actor: 'user', confirmed: true });
    await refreshBadge();
    return 'queued';
  }
}

async function openAyaWithText(tabId: number | undefined, text: string, imageUrl?: string, imagePreview?: string) {
  if (tabId) {
    try {
      const response: any = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: 'aya-open-drawer-with-text', text, imageUrl, imagePreview }, resolve);
      });
      if (response?.ok !== false) return;
    } catch {
      /* content script unavailable */
    }
  }
  await pushPendingPrompt({ text, imageUrl });
  await openSidePanel();
}

async function openSidePanel() {
  try {
    const win = await new Promise<any>((resolve) => chrome.windows.getLastFocused({}, resolve));
    chrome.sidePanel.open({ windowId: win?.id });
  } catch {
    notify('افتحي اللوحة الجانبية من أيقونة الإضافة');
  }
}

async function requestPageText(tabId: number | undefined): Promise<{ text: string; title: string; url: string } | null> {
  if (!tabId) return null;
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'aya-get-page-text' }, (response: any) => {
        if (chrome.runtime?.lastError) resolve(null);
        else resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * A data URL is decoded locally: `fetch(dataUrl)` violates the extension's
 * `connect-src` CSP and throws in the service worker.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(dataUrl ?? ''));
  if (!match) throw new Error('صيغة الملف غير صالحة');
  const type = match[1] || 'application/octet-stream';
  const raw = match[2] ? atob(match[3] ?? '') : decodeURIComponent(match[3] ?? '');
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function uploadRemoteImage(srcUrl: string, tabId: number | undefined) {
  try {
    const response = await fetch(srcUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const name = srcUrl.split('/').pop()?.split('?')[0] || 'image.png';
    const file = new File([blob], name, { type: blob.type || 'image/png' });
    const upload = await ayaServer.upload(file, name);
    let dataUrl: string | undefined;
    if (blob.size < 2_500_000) {
      dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      }) ?? undefined;
    }
    return { ...upload, dataUrl };
  } catch (err) {
    toastTab(tabId, `تعذر رفع الصورة: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/* --------------------------------------------------------------- alarms */

function startupAlarms() {
  chrome.alarms.create('aya-badge', { periodInMinutes: 1 });
  chrome.alarms.create('aya-queue', { periodInMinutes: 2 });
  chrome.alarms.onAlarm.addListener((alarm: any) => {
    if (alarm.name === 'aya-badge') void refreshBadge();
    if (alarm.name === 'aya-queue') void flushQueue().then(() => refreshBadge());
  });
}

async function refreshBadge(): Promise<void> {
  try {
    const [snapshot, inbox] = await Promise.all([ayaServer.snapshot(), ayaServer.inbox()]);
    const tasks = (snapshot?.collections?.tasks ?? []).filter((task: any) => !task.deletedAt && !task.isCompleted);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayCount = tasks.filter((task: any) => task.dueDate === today).length;
    const unread = inbox.items.filter((item) => (item.status ?? 'unread') === 'unread').length;

    await chrome.storage.local.set({
      [STORAGE_KEYS.UNREAD]: unread,
      [STORAGE_KEYS.LAST_CONNECTED]: new Date().toISOString(),
      'aya:todayCount': todayCount,
    });

    if (unread > 0) {
      chrome.action.setBadgeText({ text: unread > 99 ? '99+' : String(unread) });
      chrome.action.setBadgeBackgroundColor({ color: '#de4c4a' });
    } else if (todayCount > 0) {
      chrome.action.setBadgeText({ text: String(todayCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#1e78ff' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_CONNECTED]: null });
    chrome.action.setBadgeText({ text: '' });
    void flushQueue();
  }
}

/* -------------------------------------------------------------- commands */

chrome.commands.onCommand.addListener(async (command: string) => {
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (command === 'aya-chat') {
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'aya-toggle-drawer' });
        return;
      } catch {
        /* no content script */
      }
    }
    await openSidePanel();
  } else if (command === 'quick-add') {
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'aya-toggle-quick-add' });
        return;
      } catch {
        /* no content script */
      }
    }
    await openSidePanel();
  } else if (command === '_execute_side_panel') {
    await openSidePanel();
  }
});

/* --------------------------------------------------- chat streaming proxy */

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name !== 'aya-chat') return;
  const controller = new AbortController();
  let started = false;

  port.onMessage.addListener((message: any) => {
    if (message?.type !== 'start' || started) return;
    started = true;
    void (async () => {
      try {
        await ayaServer.streamChat(message.payload ?? {}, {
          signal: controller.signal,
          onEvent: (event) => port.postMessage({ type: 'event', event: event.event, data: event.data }),
        });
        port.postMessage({ type: 'end' });
      } catch (err) {
        if (!controller.signal.aborted) {
          port.postMessage({ type: 'stream-error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
  });

  port.onDisconnect.addListener(() => controller.abort());
});

/* -------------------------------------------------------------- messages */

chrome.runtime.onMessage.addListener((msg: any, _sender: any, sendResponse: (value?: any) => void) => {
  if (!msg?.type) return false;

  if (msg.type === 'aya-get-unread') {
    chrome.storage.local.get([STORAGE_KEYS.UNREAD], (res: any) => sendResponse({ unread: res?.[STORAGE_KEYS.UNREAD] ?? 0 }));
    return true;
  }

  if (msg.type === 'aya-get-settings') {
    chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (res: any) => sendResponse(res?.[STORAGE_KEYS.SETTINGS] ?? DEFAULT_SETTINGS));
    return true;
  }

  if (msg.type === 'aya-flush-queue') {
    flushQueue().then((result) => sendResponse(result)).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (msg.type === 'aya-settings-changed') {
    buildContextMenus();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'aya-open-sidepanel') {
    void openSidePanel();
    sendResponse({ ok: true });
    return true;
  }

  /**
   * One brain click = open, a second = close. Chrome has no `sidePanel.close`,
   * so an already-open panel is handed the `CLOSE_SIDE_PANEL` message which the
   * content script uses to dismiss the floating bar.
   */
  if (msg.type === 'TOGGLE_SIDE_PANEL') {
    void (async () => {
      try {
        const stored = (await chrome.storage.local.get(['aya:sidePanelOpen'])) as Record<string, unknown>;
        const open = Boolean(stored['aya:sidePanelOpen']);
        if (open) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            try {
              chrome.tabs.sendMessage(tab.id, { type: 'CLOSE_SIDE_PANEL' }, () => void chrome.runtime?.lastError);
            } catch {
              /* no content script */
            }
          }
          await chrome.storage.local.set({ 'aya:sidePanelOpen': false });
          sendResponse({ ok: true, open: false });
        } else {
          await openSidePanel();
          await chrome.storage.local.set({ 'aya:sidePanelOpen': true });
          sendResponse({ ok: true, open: true });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  /** Side panel → background: capture the visible tab, upload it, return both URLs. */
  if (msg.type === 'CAPTURE_VISIBLE_TAB') {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const dataUrl = await new Promise<string>((resolve, reject) => {
          chrome.tabs.captureVisibleTab(tab?.windowId, { format: 'png' }, (url: string) => {
            if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message ?? 'capture failed'));
            else resolve(url);
          });
        });
        const blob = dataUrlToBlob(dataUrl);
        const file = new File([blob], 'screenshot.png', { type: blob.type || 'image/png' });
        const upload = await ayaServer.upload(file, 'screenshot.png');
        sendResponse({ ok: true, id: upload.filename, url: upload.absoluteUrl, dataUrl });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  /** Side panel → background: extract { title, url, text } from the active tab. */
  if (msg.type === 'READ_ACTIVE_PAGE') {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('لا توجد صفحة نشطة');
        const results = await new Promise<any[]>((resolve, reject) => {
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id as number },
              func: () => {
                const text = String(document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 5000);
                return { title: document.title, url: location.href, text };
              },
            },
            (rows: any[]) => {
              if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message ?? 'read failed'));
              else resolve(rows ?? []);
            },
          );
        });
        const page = results?.[0]?.result;
        if (!page?.text) throw new Error('تعذر قراءة نص هذه الصفحة');
        sendResponse({ ok: true, title: page.title, url: page.url, text: page.text });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (msg.type === 'aya-selection-action') {
    void (async () => {
      const kind = msg.kind;
      const text = String(msg.text ?? '').trim();
      const source = `\n\nالمصدر: ${msg.title || msg.url || ''} (${msg.url || ''})`;
      try {
        if (kind === 'task') {
          const outcome = await createWithOffline({ content: firstLine(text), description: `${text}${source}` });
          sendResponse({ ok: true, message: outcome === 'sent' ? '✓ تمت إضافة المهمة إلى الوارد' : '📥 أوفلاين — اتخزنت في الطابور' });
        } else if (kind === 'note') {
          const outcome = await createWithOffline({
            content: `📝 ${firstLine(text)}`,
            description: `${text}${source}`,
            labelNames: ['ملاحظة'],
          });
          sendResponse({ ok: true, message: outcome === 'sent' ? '📝 تم حفظ الملاحظة في النوتبوك' : '📥 أوفلاين — الملاحظة في الطابور' });
        } else if (kind === 'checklist') {
          const items = splitLinesToChecklist(text);
          const created = await ayaServer.command<{ id: string }>('task.create', {
            content: `☑️ قائمة تشيك بوكس (${items.length})`,
            description: source.trim(),
          });
          await ayaServer.command('task.update', {
            id: created.id,
            checklist: items.map((item, index) => ({ id: `chk-${Date.now()}-${index}`, text: item, checked: false, image: null })),
          });
          sendResponse({ ok: true, message: `☑️ اتضاف ${items.length} بند تشيك بوكس` });
        } else {
          sendResponse({ ok: true });
        }
      } catch (err) {
        sendResponse({ ok: false, message: `تعذر التنفيذ: ${err instanceof Error ? err.message : String(err)}` });
      }
    })();
    return true;
  }

  if (msg.type === 'aya-create-task') {
    void (async () => {
      const raw = (msg.input ?? {}) as Record<string, unknown>;
      const items = Array.isArray(raw.checklistItems) ? (raw.checklistItems as string[]) : [];
      const input = { ...raw };
      delete input.checklistItems;
      try {
        const created = await ayaServer.command<{ id: string }>('task.create', input);
        if (items.length) {
          await ayaServer.command('task.update', {
            id: created.id,
            checklist: items.map((text, index) => ({ id: `chk-${Date.now()}-${index}`, text, checked: false, image: null })),
          });
        }
        void refreshBadge();
        sendResponse({ ok: true });
      } catch {
        await enqueueOperation({ name: 'task.create', input, actor: 'user', confirmed: true });
        sendResponse({ ok: true, queued: true });
      }
    })();
    return true;
  }

  if (msg.type === 'aya-upload-dataurl') {
    void (async () => {
      try {
        const blob = dataUrlToBlob(String(msg.dataUrl));
        const file = new File([blob], String(msg.name || 'image.png'), { type: blob.type || 'image/png' });
        const upload = await ayaServer.upload(file, file.name);
        sendResponse({ ok: true, url: upload.absoluteUrl, kind: upload.kind });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (msg.type === 'aya-config') {
    void ayaServer
      .ayaConfig()
      .then((config) => {
        const models = config.providers.flatMap((provider) =>
          provider.models
            .filter((model) => model.enabled !== false)
            .map((model) => ({
              id: model.id,
              label: model.label || model.modelId,
              status: model.status,
              latencyMs: model.latencyMs,
            })),
        );
        sendResponse({ ok: true, models });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'aya-undo') {
    void ayaServer
      .undo(String(msg.batchId ?? ''))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'aya-command') {
    void ayaServer
      .command(String(msg.name ?? ''), msg.input ?? {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'aya-snapshot') {
    void ayaServer
      .snapshot()
      .then((snapshot) =>
        sendResponse({
          ok: true,
          projects: (snapshot?.collections?.projects ?? []).filter((project: any) => !project.isArchived),
        }),
      )
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
