/**
 * Background service worker (Manifest V3).
 */

import { ayaServer } from '../lib/server';
import { ensureStorage, STORAGE_KEYS } from '../lib/core';
import { enqueueOperation, flushQueue } from '../lib/queue';

// ---------- bootstrap ----------
await ensureStorage();
buildContextMenus();
startupAlarms();

// ---------- context menus ----------
const MENU_PREFIX = 'aya-';

function buildContextMenus() {
  chrome.contextMenus.removeAll();

  const baseMenus = [
    { id: `${MENU_PREFIX}ask`, title: 'اسألي / عالجي النص مع آية ✨', contexts: ['selection'] },
    { id: `${MENU_PREFIX}add-task`, title: 'إضافة كمهمة جديدة', contexts: ['selection'] },
    { id: `${MENU_PREFIX}checklist`, title: 'تحويل إلى قائمة تشيك بوكس', contexts: ['selection'] },
    { id: `${MENU_PREFIX}page-task`, title: 'حفظ الصفحة كمهمة للمراجعة', contexts: ['page'] },
    { id: `${MENU_PREFIX}summarize`, title: 'لخّصي الصفحة دي يا آية', contexts: ['page'] },
  ];

  chrome.storage.local.get(['aya:settings'], (r: any) => {
    const settings = r['aya:settings'];
    const pillsEnabled = settings?.selectionPillEnabled !== false;
    const imageMenus: any[] = pillsEnabled ? [
      { id: `${MENU_PREFIX}send-image`, title: 'إرسال الصورة لآية (تحليل / استخراج)', contexts: ['image'] },
      { id: `${MENU_PREFIX}image-task`, title: 'حفظ الصورة داخل مهمة جديدة', contexts: ['image'] },
    ] : [];
    for (const m of [...baseMenus, ...imageMenus]) chrome.contextMenus.create(m);
  });
}

chrome.runtime.onInstalled.addListener(buildContextMenus);
chrome.storage.onChanged.addListener(buildContextMenus);

// ---------- context menu clicks ----------
chrome.contextMenus.onClicked.addListener(async (info: any, tab: any) => {
  const { id, selectionText, imageDataURL, pageUrl, pageTitle } = info;
  if (id === `${MENU_PREFIX}ask`) {
    if (!selectionText) { toast('لا يوجد نص مختار'); return; }
    await openDrawerWithTextInTab(tab?.id ?? null, selectionText);
    return;
  }
  if (id === `${MENU_PREFIX}add-task`) {
    if (!selectionText) { toast('لا يوجد نص مختار'); return; }
    await createTaskFromSelection(selectionText, tab);
    return;
  }
  if (id === `${MENU_PREFIX}checklist`) {
    if (!selectionText) { toast('لا يوجد نص مختار'); return; }
    await createTaskFromChecklist(selectionText, tab);
    return;
  }
  if (id === `${MENU_PREFIX}send-image`) {
    if (!imageDataURL) { toast('الصورة غير متاحة'); return; }
    await sendImageToAya(imageDataURL, tab?.id ?? null);
    return;
  }
  if (id === `${MENU_PREFIX}image-task`) {
    if (!imageDataURL) { toast('الصورة غير متاحة'); return; }
    await createTaskWithImage(imageDataURL, tab);
    return;
  }
  if (id === `${MENU_PREFIX}page-task`) {
    await createPageTask(tab);
    return;
  }
  if (id === `${MENU_PREFIX}summarize`) {
    const prompt = `لخّصي الصفحة دي يا آية:\nالعنوان: ${pageTitle || ''}\nالرابط: ${pageUrl || ''}`;
    await openDrawerWithTextInTab(tab?.id ?? null, prompt);
    return;
  }
});

async function createTaskFromSelection(text: string, tab?: chrome.tabs.Tab) {
  const input: any = { content: text };
  if (tab?.url) input.description = `الصفحة: ${tab.url} · مختارة من: ${tab.title || tab.url}`;
  const ok = await tryCommand({ name: 'task.create', input, actor: 'user', confirmed: true });
  if (ok) toast('✅ تمت إضافة المهمة من النص المختار');
  else { await enqueueOffline('task.create', input); toast('تم حفظ المهمة للمراسلة لاحقًا ✓'); }
}

async function createTaskFromChecklist(text: string, tab?: chrome.tabs.Tab) {
  const items = splitChecklist(text);
  const input: any = { content: 'قائمة تشيك بوكس من تحديدك', checklist: items };
  if (tab?.url) input.description = `الصفحة: ${tab.url} · ${items.length} عنصر من النص المختار`;
  const ok = await tryCommand({ name: 'task.create', input, actor: 'user', confirmed: true });
  if (ok) toast(`✅ تمت إضافة المهمة مع ${items.length} عنصر تشيك بوكس`);
  else { await enqueueOffline('task.create', input); toast('تم حفظ المهمة للمراسلة لاحقًا ✓'); }
}

function splitChecklist(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const items: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/^[\s•\-*\d]+[\.\)]\s*/i, '').trim();
    if (cleaned) items.push(cleaned);
  }
  const deduped: string[] = [];
  for (const item of items) {
    if (deduped[deduped.length - 1] !== item) deduped.push(item);
  }
  return deduped;
}

async function createTaskWithImage(imageDataURL: string, tab?: chrome.tabs.Tab) {
  const blob = await (await fetch(imageDataURL)).blob();
  const file = new File([blob], 'selection.png', { type: blob.type || 'image/png' });
  try {
    const upload = await ayaServer.upload(file);
    const input: any = { content: 'صورة مرفوعة من التحديد', attachments: [upload.id] };
    if (tab?.url) input.description = `الصفحة: ${tab.url}`;
    const ok = await tryCommand({ name: 'task.create', input, actor: 'user', confirmed: true });
    if (ok) toast('✅ تم حفظ الصورة داخل مهمة جديدة');
    else throw new Error('create failed');
  } catch {
    toast('فشل رفع الصورة أو إنشاء المهمة');
  }
}

async function sendImageToAya(imageDataURL: string, tabId: number | null) {
  const blob = await (await fetch(imageDataURL)).blob();
  const file = new File([blob], 'selection.png', { type: blob.type || 'image/png' });
  // Open drawer and attach image on active tab.
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'aya-toggle-drawer' });
      // Then attach the file
      await chrome.tabs.sendMessage(tabId, { type: 'aya-attach-image', file });
    } catch {
      // Content script may not be loaded — fallback to opening popup.
      await chrome.action.openPopup?.();
    }
  } else {
    await chrome.action.openPopup?.();
  }
  toast('✅ رفعت الصورة لآية — افتحي بار آية للرد');
}

async function createPageTask(tab?: chrome.tabs.Tab) {
  const title = tab?.title || document.title || 'الصفحة';
  const url = tab?.url || location.href;
  const input: any = { content: title, description: `الرابط: ${url}` };
  const ok = await tryCommand({ name: 'task.create', input, actor: 'user', confirmed: true });
  if (ok) toast('✅ تم حفظ الصفحة كمهمة للمراجعة');
  else { await enqueueOffline('task.create', input); toast('تم حفظ المهمة للمراسلة لاحقًا ✓'); }
}

async function openDrawerWithTextInTab(tabId: number | null, text: string) {
  if (!tabId) { await chrome.action.openPopup?.(); return; }
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'aya-open-drawer-with-text', text });
  } catch {
    await chrome.action.openPopup?.();
  }
}

async function tryCommand(body: any): Promise<boolean> {
  try {
    const res = await ayaServer.command(body);
    return res.ok === true;
  } catch {
    return false;
  }
}

async function enqueueOffline(name: string, input: any) {
  await enqueueOperation({ name, input, actor: 'user', confirmed: true });
}

function toast(msg: string) {
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: 'icons/icon128.svg',
    title: 'آية · __AYAtodoist',
    message: msg,
    priority: 2,
  }).catch(() => {});
}

// ---------- alarms + health ----------
function startupAlarms() {
  chrome.alarms.create('aya-queue-flush', { periodInMinutes: 2 });
  chrome.alarms.onAlarm.addListener(async (alarm: any) => {
    if (alarm.name === 'aya-queue-flush') await flushQueue();
  });
  setInterval(pollHealth, 30_000);
  pollHealth();
}

async function pollHealth() {
  try {
    const h = await ayaServer.health();
    const inbox = await ayaServer.inboxUnread();
    const unread = inbox?.items?.length || 0;
    await chrome.storage.local.set({
      [STORAGE_KEYS.UNREAD]: unread,
      [STORAGE_KEYS.LAST_CONNECTED]: new Date().toISOString(),
    });
    if (unread > 0) {
      chrome.action.setBadgeText({ text: String(unread) });
      chrome.action.setBadgeBackgroundColor({ color: '#de4c4a' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
    return;
  } catch {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_CONNECTED]: null });
    chrome.action.setBadgeText({ text: '' });
    // Try flushing queue when we might be coming back online.
    await flushQueue();
  }
}

// ---------- commands ----------
chrome.commands.onCommand.addListener(async (command: string) => {
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (command === 'aya-chat') {
    if (tab?.id) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'aya-toggle-drawer' }); } catch { await chrome.action.openPopup?.(); }
    } else { await chrome.action.openPopup?.(); }
  } else if (command === 'quick-add') {
    if (tab?.id) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'aya-toggle-quick-add' }); } catch { await chrome.action.openPopup?.(); }
    } else { await chrome.action.openPopup?.(); }
  } else if (command === '_execute_side_panel') {
    const w = await chrome.windows.getLastFocused({});
    await chrome.sidePanel.open({ windowId: w.id });
  }
});

// ---------- message routing ----------
chrome.runtime.onMessage.addListener((msg: any, _sender: any, sendResponse: any) => {
  if (msg.type === 'aya-get-unread') {
    chrome.storage.local.get([STORAGE_KEYS.UNREAD], (r: any) => sendResponse!({ unread: r[STORAGE_KEYS.UNREAD] || 0 }));
    return true;
  }
  if (msg.type === 'aya-flush-queue') {
    flushQueue().then((res) => sendResponse!(res)).catch((e) => sendResponse!({ error: String(e) }));
    return true;
  }
  if (msg.type === 'aya-settings-changed') {
    buildContextMenus();
    return true;
  }
  return false;
});
