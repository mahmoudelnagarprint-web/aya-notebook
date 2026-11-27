/**
 * In-page content script.
 *
 * Everything lives inside a closed Shadow DOM so page CSS can never leak in:
 * success toasts, the floating selection toolbar, the draggable edge handle, the
 * Aya drawer (streaming via the background worker) and the quick-add modal.
 * Server access is delegated to the background service worker.
 */

import styles from './main.css?inline';
import { extractPageText, pageContextBlock } from '../lib/helpers';
import { loadTheme, watchTheme, saveTheme, type Theme } from '../lib/theme';

const HOST_ID = 'aya-shadow-host';

interface Settings {
  selectionPillEnabled?: boolean;
  pageContextEnabled?: boolean;
  pageContextTrim?: number;
  handleSide?: 'right' | 'left' | 'hidden';
  handleY?: number;
  quickAddDefaultPriority?: number;
  serverBaseUrl?: string;
}

interface ChatBubble {
  role: 'user' | 'assistant';
  text: string;
  chips: Array<{ name: string; state: 'running' | 'done' | 'fail' }>;
  error?: boolean;
}

let shadow: ShadowRoot | null = null;
let rootEl: HTMLElement | null = null;
let handleEl: HTMLElement | null = null;
let toolbarEl: HTMLElement | null = null;
let drawerEl: HTMLElement | null = null;
let quickEl: HTMLElement | null = null;
let toastHost: HTMLElement | null = null;

let settings: Settings = {};
let theme: Theme = 'light';
let selectionText = '';
let pageContext: { title: string; url: string; text: string } | null = null;
let attachment: { url: string; preview?: string; name: string } | null = null;
let conversationId = '';
let streamPort: any = null;
let streaming = false;
let drawerOpen = false;
let quickOpen = false;
let batchId: string | null = null;
let modelsLoaded = false;

/* ------------------------------------------------------------------ boot */

async function boot() {
  if (document.getElementById(HOST_ID)) return;

  try {
    const stored = (await chrome.storage.local.get(['aya:settings'])) as Record<string, any>;
    settings = stored['aya:settings'] ?? {};
  } catch {
    settings = {};
  }
  theme = await loadTheme();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const mount = document.body ?? document.documentElement;
  mount.appendChild(host);

  shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = styles;
  rootEl = document.createElement('div');
  rootEl.className = 'kaya-root';
  rootEl.dir = 'rtl';
  rootEl.dataset.theme = theme;
  rootEl.dataset.handle = settings.handleSide ?? 'right';
  shadow.append(style, rootEl);

  toastHost = document.createElement('div');
  toastHost.className = 'k-toast-host';
  rootEl.appendChild(toastHost);

  toolbarEl = document.createElement('div');
  toolbarEl.className = 'k-toolbar';
  toolbarEl.style.display = 'none';
  rootEl.appendChild(toolbarEl);
  renderToolbar();

  renderHandle();
  applyHandle();

  document.addEventListener('mouseup', scheduleSelectionCheck, true);
  document.addEventListener('keyup', scheduleSelectionCheck, true);
  // Clicks inside the closed shadow tree are retargeted to the host, so the page
  // listener must ignore them and the shadow listener decides per element.
  document.addEventListener(
    'mousedown',
    (event) => {
      if (event.composedPath()[0] === host) return;
      hideToolbar();
    },
    true,
  );
  shadow.addEventListener(
    'mousedown',
    (event) => {
      if (toolbarEl && !event.composedPath().includes(toolbarEl)) hideToolbar();
    },
    true,
  );
  window.addEventListener('scroll', hideToolbar, true);
  window.addEventListener('resize', () => applyHandle(), true);

  window.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.altKey && event.shiftKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      toggleDrawer();
    } else if (event.altKey && !event.shiftKey && (event.key === 'q' || event.key === 'Q')) {
      event.preventDefault();
      toggleQuickAdd();
    } else if (event.key === 'Escape') {
      if (quickOpen) closeQuickAdd();
      else if (drawerOpen) closeDrawer();
    }
  });

  chrome.runtime.onMessage.addListener((msg: any, _sender: any, sendResponse: (value?: any) => void) => {
    if (msg?.type === 'aya-toggle-drawer') {
      toggleDrawer();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'CLOSE_SIDE_PANEL') {
      closeDrawer();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'aya-open-drawer-with-text') {
      openDrawer(String(msg.text ?? ''), msg.imageUrl, msg.imagePreview);
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'aya-toggle-quick-add') {
      toggleQuickAdd();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'aya-toast') {
      showToast(String(msg.message ?? ''));
      return true;
    }
    if (msg?.type === 'aya-get-page-text') {
      const text = extractPageText(document, Math.max(2000, Number(settings.pageContextTrim) || 6000));
      sendResponse({ text, title: document.title, url: location.href });
      return true;
    }
    if (msg?.type === 'CAPTURE_IMAGE_FROM_DOM') {
      void captureImageFromDom(String(msg.srcUrl ?? '')).then((result) => sendResponse(result));
      return true;
    }
    if (msg?.type === 'aya-attach-image' && msg.url) {
      attachment = { url: String(msg.url), preview: msg.preview, name: 'صورة' };
      if (drawerOpen) renderAttachment();
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes: Record<string, any>, area: string) => {
    if (area !== 'local') return;
    if (changes['aya:settings']) {
      settings = changes['aya:settings'].newValue ?? {};
      applyHandle();
    }
    if (changes['aya:theme']?.newValue === 'light' || changes['aya:theme']?.newValue === 'dark') {
      theme = changes['aya:theme'].newValue;
      if (rootEl) rootEl.dataset.theme = theme;
    }
  });

  return undefined;
}

/* --------------------------------------------------------------- helpers */

function showToast(
  message: string,
  options: { state?: 'ok' | 'err'; actionLabel?: string; onAction?: () => void } = {},
): void {
  if (!toastHost) return;
  const toast = document.createElement('div');
  toast.className = `k-toast ${options.state === 'err' ? 'err' : ''}`;

  const icon = document.createElement('span');
  icon.className = 'k-toast-icon';
  icon.textContent = options.state === 'err' ? '⚠️' : '✓';
  const text = document.createElement('span');
  text.className = 'k-toast-text';
  text.textContent = message;

  toast.append(icon, text);

  const action = document.createElement('button');
  action.className = 'k-toast-action';
  action.textContent = options.actionLabel ?? 'فتح اللوحة';
  action.addEventListener('click', () => {
    if (options.onAction) options.onAction();
    else void sendMessage({ type: 'aya-open-sidepanel' });
    toast.remove();
  });
  toast.appendChild(action);

  toastHost.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

const RELOAD_HINT = 'تم تحديث الإضافة — أعد تحميل الصفحة (F5) لتفعيلها';

let invalidatedNotified = false;

/** After an extension reload/update the orphaned content script has no runtime. */
function extensionAlive(): boolean {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function isInvalidatedError(error: unknown): boolean {
  const text =
    typeof error === 'string' ? error : `${(error as any)?.message ?? ''} ${String(error ?? '')}`;
  return /extension context invalidated|context invalidated/i.test(text) || !extensionAlive();
}

function warnInvalidated(): void {
  if (invalidatedNotified) return;
  invalidatedNotified = true;
  showToast(RELOAD_HINT, { state: 'err' });
}

/**
 * Every worker call goes through here: an orphaned content script throws
 * `Extension context invalidated` instead of rejecting, which used to surface
 * as an uncaught error — now it resolves `null` and shows a reload toast.
 */
function sendMessage<T = any>(message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      if (!extensionAlive()) {
        warnInvalidated();
        finish(null);
        return;
      }
      chrome.runtime.sendMessage(message, (response: T) => {
        const error = chrome.runtime?.lastError?.message;
        if (error) {
          if (isInvalidatedError(error)) warnInvalidated();
          finish(null);
          return;
        }
        finish(response ?? null);
      });
    } catch (err) {
      if (isInvalidatedError(err)) warnInvalidated();
      finish(null);
    }
  });
}

/* ------------------------------------------------ in-page image capture */

interface CapturedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

/** The `<img>` the user right-clicked, matched by src, currentSrc or file name. */
function findPageImage(srcUrl: string): HTMLImageElement | null {
  const target = absoluteUrl(srcUrl);
  const images = Array.from(document.images);
  const exact = images.find(
    (img) =>
      img.currentSrc === target ||
      img.src === target ||
      absoluteUrl(img.getAttribute('src') ?? '') === target,
  );
  if (exact) return exact;

  const file = (() => {
    try {
      return decodeURIComponent(target.split('/').pop() ?? '');
    } catch {
      return target.split('/').pop() ?? '';
    }
  })();
  if (file.length > 6) {
    const byName = images.filter((img) => (img.currentSrc || img.src || '').includes(file));
    if (byName.length === 1) return byName[0]!;
  }

  const visible = images
    .filter((img) => {
      const rect = img.getBoundingClientRect();
      return (
        rect.width >= 64 &&
        rect.height >= 64 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth
      );
    })
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
  return visible[0] ?? null;
}

function rectOf(img: HTMLImageElement): CapturedRect {
  const rect = img.getBoundingClientRect();
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  return {
    x,
    y,
    width: Math.max(0, Math.min(rect.width, window.innerWidth - x)),
    height: Math.max(0, Math.min(rect.height, window.innerHeight - y)),
    dpr: window.devicePixelRatio || 1,
  };
}

/**
 * Draws the element into an offscreen canvas. A CORS-enabled clone is tried
 * first so hotlink-protected CDNs can still be read; a tainted canvas throws
 * `SecurityError`, which is reported so the worker can crop a screenshot.
 */
async function imageToDataUrl(img: HTMLImageElement): Promise<string | null> {
  const candidates: HTMLImageElement[] = [img];
  try {
    const clone = new Image();
    clone.crossOrigin = 'anonymous';
    clone.src = img.currentSrc || img.src;
    await clone.decode();
    candidates.unshift(clone);
  } catch {
    /* clone not readable — the original may still work */
  }

  for (const candidate of candidates) {
    try {
      const width = candidate.naturalWidth || img.naturalWidth || img.width;
      const height = candidate.naturalHeight || img.naturalHeight || img.height;
      if (!width || !height) continue;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(candidate, 0, 0, width, height);
      return canvas.toDataURL('image/png');
    } catch {
      /* tainted canvas — try the next candidate */
    }
  }
  return null;
}

async function captureImageFromDom(srcUrl: string): Promise<{
  ok: boolean;
  dataUrl?: string;
  rect?: CapturedRect;
  reason?: string;
  error?: string;
}> {
  const img = findPageImage(srcUrl);
  if (!img) return { ok: false, error: 'الصورة غير موجودة في الصفحة' };

  const dataUrl = await imageToDataUrl(img);
  if (dataUrl) return { ok: true, dataUrl, rect: rectOf(img) };

  // Tainted image: scroll it fully into view so the worker can crop it.
  img.scrollIntoView({ block: 'center', inline: 'center' });
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  return { ok: false, reason: 'tainted', rect: rectOf(img) };
}

/* ---------------------------------------------------------------- handle */

function renderHandle() {
  if (!rootEl || handleEl) return;
  handleEl = document.createElement('div');
  handleEl.className = 'k-handle';
  handleEl.setAttribute('role', 'button');
  handleEl.setAttribute('tabindex', '0');
  handleEl.setAttribute('aria-label', 'فتح / إغلاق بار آية');
  handleEl.dataset.tip = 'فتح / إغلاق بار آية';
  handleEl.innerHTML = `
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="k-brain-a" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#de4c4a" />
          <stop offset=".55" stop-color="#8b5cf6" />
          <stop offset="1" stop-color="#1e78ff" />
        </linearGradient>
        <linearGradient id="k-brain-b" x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ff8a5b" />
          <stop offset="1" stop-color="#c026d3" />
        </linearGradient>
      </defs>
      <path fill="url(#k-brain-a)" d="M24 9c3.3-3 8.6-2.4 10.9 1.6 3.9.4 6.2 4.3 4.9 7.9 2.9 2.8 2.2 7.6-1.3 9.5.6 4.3-3.5 7.7-7.6 6.5-1.6 2.8-5.3 3.4-7.7 1.2-2.4 2.2-6.1 1.6-7.7-1.2-4.1 1.2-8.2-2.2-7.6-6.5-3.5-1.9-4.2-6.7-1.3-9.5-1.3-3.6 1-7.5 4.9-7.9C15.4 6.6 20.7 6 24 9Z" />
      <path fill="url(#k-brain-b)" opacity=".92" d="M24 11.4c2.2 2.6 6.1 2.9 8.7.8 1.9 1.9 2 5 .2 7 1.5 2.4.7 5.6-1.8 7-1.1 2.4-4.2 3.2-6.3 1.6-2.1 1.6-5.2.8-6.3-1.6-2.5-1.4-3.3-4.6-1.8-7-1.8-2-1.7-5.1.2-7 2.6 2.1 6.5 1.8 8.7-.8Z" />
      <path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="1.7" opacity=".9" d="M24 13.5v19M24 20c-2.2 0-3.7-1-4.6-2.6M24 20c2.2 0 3.7-1 4.6-2.6M24 27c-2.2 0-3.7 1-4.6 2.6M24 27c2.2 0 3.7 1 4.6 2.6" />
    </svg>
  `;
  rootEl.appendChild(handleEl);

  // No page context menu over the floating handle. `chrome.sidePanel.open()` is
  // rejected for content-script messages (no extension user gesture), so the
  // handle only ever drives the in-page drawer.
  handleEl.addEventListener('contextmenu', (event) => event.preventDefault());
  handleEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleDrawer();
    }
  });

  let dragging = false;
  let moved = false;
  let startY = 0;
  let startTop = 0;

  handleEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.k-handle-plus')) return;
    dragging = true;
    moved = false;
    startY = event.clientY;
    startTop = handleEl!.getBoundingClientRect().top;
    handleEl!.setPointerCapture(event.pointerId);
    handleEl!.classList.add('dragging');
  });

  handleEl.addEventListener('pointermove', (event) => {
    if (!dragging || !handleEl) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 4) moved = true;
    const top = Math.max(12, Math.min(window.innerHeight - 56, startTop + delta));
    handleEl.style.top = `${top}px`;
  });

  handleEl.addEventListener('pointerup', (event) => {
    if (!dragging || !handleEl) return;
    dragging = false;
    const primary = event.button === 0;
    handleEl.classList.remove('dragging');
    handleEl.releasePointerCapture(event.pointerId);
    const top = Math.round(handleEl.getBoundingClientRect().top);
    settings.handleY = Math.max(12, top);
    void chrome.storage.local.set({ 'aya:settings': settings, 'aya:handleY': settings.handleY });
    // One click opens the floating drawer in this page, the next click closes it.
    if (primary && !moved) toggleDrawer();
  });
}

function applyHandle() {
  if (!handleEl) return;
  const side = settings.handleSide ?? 'right';
  if (rootEl) rootEl.dataset.handle = side;
  handleEl.style.display = side === 'hidden' ? 'none' : 'flex';
  handleEl.style.top = `${Math.max(12, Number(settings.handleY) || 120)}px`;
}

/* --------------------------------------------------------- selection bar */

let selectionTimer: number | null = null;

function scheduleSelectionCheck() {
  if (selectionTimer) window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => {
    selectionTimer = null;
    maybeShowToolbar();
  }, 140);
}

function maybeShowToolbar() {
  if (!toolbarEl) return;
  if (settings.selectionPillEnabled === false) return hideToolbar();
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return hideToolbar();
  const text = selection.toString().trim();
  if (text.length < 2 || text.length > 2000) return hideToolbar();
  const active = document.activeElement as HTMLElement | null;
  if (active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable)) return hideToolbar();

  let rect: DOMRect;
  try {
    rect = selection.getRangeAt(0).getBoundingClientRect();
  } catch {
    return;
  }
  if (!rect.width && !rect.height) return hideToolbar();

  selectionText = text;
  toolbarEl.style.display = 'flex';
  toolbarEl.style.top = `${Math.max(8, rect.top - 46)}px`;
  toolbarEl.style.left = `${Math.min(window.innerWidth - 250, Math.max(8, rect.left + rect.width / 2 - 120))}px`;
}

function hideToolbar() {
  if (toolbarEl) toolbarEl.style.display = 'none';
}

/**
 * Runs a mini-toolbar action from the captured selection. The text is read
 * before any blur happens, so the page selection is never needed afterwards.
 */
function runSelectionAction(kind: string, text: string): void {
  const value = String(text ?? '').trim();
  hideToolbar();
  window.getSelection()?.removeAllRanges();
  if (!value) return;

  if (kind === 'ask') {
    openDrawer(`اسألي عن النص المحدد:\n«${value}»\n\nالمصدر: ${document.title} (${location.href})`);
    return;
  }

  showToast('⏳ جاري الحفظ...');
  void sendMessage<{ ok: boolean; message?: string }>({
    type: 'aya-selection-action',
    kind,
    text: value,
    title: document.title,
    url: location.href,
  }).then((response) => {
    if (!response) return; // an invalidated context already showed its toast
    showToast(response.message ?? (response.ok ? '✓ تم الحفظ' : 'تعذر تنفيذ الإجراء'), {
      state: response.ok === false ? 'err' : 'ok',
    });
  });
}

function renderToolbar() {
  if (!toolbarEl) return;
  const buttons: Array<{ kind: string; label: string; cls: string }> = [
    { kind: 'task', label: 'مهمة +', cls: 'primary' },
    { kind: 'note', label: 'ملاحظة 📝', cls: '' },
    { kind: 'checklist', label: 'تشيك بوكس ☑️', cls: '' },
    { kind: 'ask', label: 'آية ✨', cls: 'aya' },
  ];
  toolbarEl.innerHTML = '';
  for (const button of buttons) {
    const el = document.createElement('button');
    el.className = `k-tool ${button.cls}`;
    el.type = 'button';
    el.textContent = button.label;
    // `click` never fires once mousedown blurs the page selection, so the action
    // runs on mousedown with the selection captured up front.
    el.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      runSelectionAction(button.kind, selectionText);
    });
    el.addEventListener('click', (event) => event.preventDefault());
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      runSelectionAction(button.kind, selectionText);
    });
    toolbarEl.appendChild(el);
  }
}

/* ---------------------------------------------------------------- drawer */

function ensureDrawer(): HTMLElement {
  if (drawerEl) return drawerEl;
  drawerEl = document.createElement('aside');
  drawerEl.className = 'k-drawer';
  drawerEl.innerHTML = `
    <header class="k-drawer-head">
      <div class="k-brand">
        <div class="k-brand-mark">آ</div>
        <div>
          <div class="k-brand-title">آية ✨</div>
          <div class="k-brand-sub">مساحة عمل سريعة فوق أي صفحة</div>
        </div>
      </div>
      <div class="k-head-actions">
        <button class="k-icon-btn" data-act="theme" title="الوضع الليلي">🌙</button>
        <button class="k-icon-btn" data-act="sidepanel" title="فتح اللوحة الجانبية">⇥</button>
        <button class="k-icon-btn" data-act="close" title="إغلاق">✕</button>
      </div>
    </header>
    <div class="k-drawer-bar">
      <select class="k-select" data-role="model"><option value="auto">تلقائي ⚡</option></select>
      <button class="k-chipbtn" data-act="new-chat">+ محادثة</button>
      <button class="k-chipbtn" data-act="read-page">📄 الصفحة</button>
    </div>
    <div class="k-context" data-role="context" hidden></div>
    <div class="k-messages" data-role="messages">
      <div class="k-empty">اسألي آية، أو اختاري نصاً في الصفحة واستخدمي شريط التحديد الطائر.</div>
    </div>
    <div class="k-attachment" data-role="attachment" hidden></div>
    <div class="k-composer">
      <textarea class="k-textarea" data-role="input" rows="2" placeholder="اكتبي رسالة لآية… (Ctrl+V للصق صورة)"></textarea>
      <div class="k-composer-actions">
        <button class="k-icon-btn" data-act="image" title="رفع صورة">🖼️</button>
        <button class="k-icon-btn" data-act="undo" title="تراجع عن دفعة آية" hidden>↩</button>
        <button class="k-send" data-act="send">إرسال</button>
      </div>
    </div>
  `;
  rootEl!.appendChild(drawerEl);

  drawerEl.querySelector('[data-act="close"]')!.addEventListener('click', closeDrawer);
  drawerEl.querySelector('[data-act="sidepanel"]')!.addEventListener('click', () => {
    void sendMessage({ type: 'aya-open-sidepanel' });
  });
  drawerEl.querySelector('[data-act="theme"]')!.addEventListener('click', async () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    if (rootEl) rootEl.dataset.theme = theme;
    await saveTheme(theme);
  });
  drawerEl.querySelector('[data-act="new-chat"]')!.addEventListener('click', () => {
    conversationId = '';
    batchId = null;
    clearMessages();
    showToast('محادثة جديدة ✨');
  });
  drawerEl.querySelector('[data-act="read-page"]')!.addEventListener('click', attachPageContext);
  drawerEl.querySelector('[data-act="image"]')!.addEventListener('click', pickImage);
  drawerEl.querySelector('[data-act="undo"]')!.addEventListener('click', undoBatch);
  drawerEl.querySelector('[data-act="send"]')!.addEventListener('click', () => {
    if (streaming) stopStream();
    else void sendChat();
  });

  const input = drawerEl.querySelector('[data-role="input"]') as HTMLTextAreaElement;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendChat();
    }
  });
  input.addEventListener('paste', (event) => {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      void uploadImage(file);
    }
  });

  const modelSelect = drawerEl.querySelector('[data-role="model"]') as HTMLSelectElement;
  void loadModels(modelSelect);
  return drawerEl;
}

async function loadModels(select: HTMLSelectElement) {
  if (modelsLoaded) return;
  const response = await sendMessage<{ ok: boolean; models?: Array<{ id: string; label: string; status?: string; latencyMs?: number }> }>({
    type: 'aya-config',
  });
  if (!response?.ok || !response.models) return;
  modelsLoaded = true;
  for (const model of response.models) {
    const option = document.createElement('option');
    option.value = model.id;
    const icon = model.status === 'ok' ? '🟢' : model.status === 'fail' ? '🔴' : '⚪';
    option.textContent = `${icon} ${model.label}${model.latencyMs ? ` · ${model.latencyMs}ms` : ''}`;
    select.appendChild(option);
  }
}

function openDrawer(prefill = '', imageUrl?: string, imagePreview?: string) {
  const drawer = ensureDrawer();
  drawer.classList.add('open');
  drawerOpen = true;
  if (prefill) {
    const input = drawer.querySelector('[data-role="input"]') as HTMLTextAreaElement;
    input.value = prefill;
  }
  if (imageUrl) {
    attachment = { url: imageUrl, preview: imagePreview, name: 'صورة مرفقة' };
    renderAttachment();
  }
  if (settings.pageContextEnabled !== false && !pageContext) attachPageContext(false);
  window.setTimeout(() => (drawer.querySelector('[data-role="input"]') as HTMLTextAreaElement).focus(), 80);
}

function closeDrawer() {
  drawerEl?.classList.remove('open');
  drawerOpen = false;
}

function toggleDrawer() {
  if (drawerOpen) closeDrawer();
  else openDrawer();
}

function attachPageContext(announce = true) {
  const text = extractPageText(document, Math.max(1500, Number(settings.pageContextTrim) || 4000));
  if (!text) {
    if (announce) showToast('تعذر قراءة نص الصفحة دي', { state: 'err' });
    return;
  }
  pageContext = { title: document.title || location.href, url: location.href, text };
  renderContext();
  if (announce) showToast(`📄 أرفقت الصفحة (${text.length.toLocaleString('ar-EG')} حرف)`);
}

function renderContext() {
  if (!drawerEl) return;
  const node = drawerEl.querySelector('[data-role="context"]') as HTMLElement;
  if (!pageContext) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  node.innerHTML = `<span class="k-truncate">📄 ${escapeHtml(pageContext.title)}</span><button class="k-icon-btn" data-act="clear-context">✕</button>`;
  node.querySelector('[data-act="clear-context"]')!.addEventListener('click', () => {
    pageContext = null;
    renderContext();
  });
}

function renderAttachment() {
  if (!drawerEl) return;
  const node = drawerEl.querySelector('[data-role="attachment"]') as HTMLElement;
  if (!attachment) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  node.innerHTML = `
    ${attachment.preview ? `<img class="k-thumb" src="${escapeHtml(attachment.preview)}" alt="">` : '<span>📎</span>'}
    <span class="k-truncate">${escapeHtml(attachment.name)}</span>
    <button class="k-icon-btn" data-act="clear-attachment">✕</button>
  `;
  node.querySelector('[data-act="clear-attachment"]')!.addEventListener('click', () => {
    attachment = null;
    renderAttachment();
  });
}

function pickImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void uploadImage(file);
  });
  input.click();
}

async function uploadImage(file: File) {
  const dataUrl = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  if (!dataUrl) return showToast('تعذر قراءة الصورة', { state: 'err' });
  showToast('⏳ جاري رفع الصورة…');
  const response = await sendMessage<{ ok: boolean; url?: string; error?: string }>({
    type: 'aya-upload-dataurl',
    dataUrl,
    name: file.name,
  });
  if (response?.ok && response.url) {
    attachment = { url: response.url, preview: dataUrl, name: file.name };
    renderAttachment();
    showToast('🖼️ الصورة جاهزة للإرسال');
  } else {
    showToast(`تعذر الرفع: ${response?.error ?? 'الخادم غير متاح'}`, { state: 'err' });
  }
}

function clearMessages() {
  const area = drawerEl?.querySelector('[data-role="messages"]') as HTMLElement | null;
  if (area) area.innerHTML = '<div class="k-empty">محادثة جديدة — اكتبي أول رسالة.</div>';
}

function appendBubble(bubble: ChatBubble): HTMLElement | null {
  const area = drawerEl?.querySelector('[data-role="messages"]') as HTMLElement | null;
  if (!area) return null;
  area.querySelector('.k-empty')?.remove();
  const el = document.createElement('div');
  el.className = `k-msg ${bubble.role}${bubble.error ? ' error' : ''}`;
  el.innerHTML = `
    <div class="k-msg-role">${bubble.role === 'user' ? 'أنت' : 'آية ✨'}</div>
    <div class="k-msg-text"></div>
    <div class="k-msg-chips"></div>
  `;
  (el.querySelector('.k-msg-text') as HTMLElement).textContent = bubble.text;
  area.appendChild(el);
  area.scrollTop = area.scrollHeight;
  return el;
}

function updateBubbleText(el: HTMLElement | null, text: string) {
  if (!el) return;
  (el.querySelector('.k-msg-text') as HTMLElement).textContent = text;
  const area = el.parentElement;
  if (area) area.scrollTop = area.scrollHeight;
}

function addChip(el: HTMLElement | null, name: string, state: 'running' | 'done' | 'fail') {
  if (!el) return;
  const chips = el.querySelector('.k-msg-chips') as HTMLElement;
  let chip = chips.querySelector(`[data-name="${CSS.escape(name)}"]`) as HTMLElement | null;
  if (!chip) {
    chip = document.createElement('span');
    chip.dataset.name = name;
    chips.appendChild(chip);
  }
  chip.className = `k-chip ${state}`;
  chip.textContent = `${state === 'running' ? '⏳' : state === 'done' ? '✅' : '❌'} ${name}`;
}

async function sendChat() {
  if (!drawerEl || streaming) return;
  const input = drawerEl.querySelector('[data-role="input"]') as HTMLTextAreaElement;
  const modelSelect = drawerEl.querySelector('[data-role="model"]') as HTMLSelectElement;
  const text = input.value.trim();
  if (!text && !attachment) return;

  const parts: string[] = [];
  if (text) parts.push(text);
  if (attachment) parts.push(`🖼️ مرفق: ${attachment.url}`);
  if (pageContext) {
    parts.push(`— سياق الصفحة —\n${pageContextBlock(pageContext.title, pageContext.url, pageContext.text, settings.pageContextTrim || 4000)}`);
  }
  const payloadText = parts.join('\n\n');

  appendBubble({ role: 'user', text: text || '📎 مرفق', chips: [] });
  const assistant = appendBubble({ role: 'assistant', text: '', chips: [] });
  let assistantText = '';

  input.value = '';
  attachment = null;
  renderAttachment();
  streaming = true;
  batchId = null;
  const undoBtn = drawerEl.querySelector('[data-act="undo"]') as HTMLButtonElement;
  undoBtn.hidden = true;
  const sendBtn = drawerEl.querySelector('[data-act="send"]') as HTMLButtonElement;
  sendBtn.textContent = '⏹ إيقاف';
  sendBtn.classList.add('stop');

  const port = chrome.runtime.connect({ name: 'aya-chat' });
  streamPort = port;
  port.onMessage.addListener((message: any) => {
    if (message?.type === 'event') {
      const { event, data } = message;
      if (event === 'meta' && data?.conversationId) conversationId = data.conversationId;
      else if (event === 'delta' && typeof data?.text === 'string') {
        assistantText += data.text;
        updateBubbleText(assistant, assistantText);
      } else if (event === 'tool_start') addChip(assistant, String(data?.name ?? 'tool'), 'running');
      else if (event === 'tool_result') addChip(assistant, String(data?.name ?? 'tool'), data?.ok === false ? 'fail' : 'done');
      else if (event === 'done') {
        if (data?.batchId) {
          batchId = data.batchId;
          undoBtn.hidden = false;
        }
      } else if (event === 'error') {
        assistantText = assistantText || `خطأ: ${data?.message ?? 'غير متوقع'}`;
        assistant?.classList.add('error');
        updateBubbleText(assistant, assistantText);
      }
    } else if (message?.type === 'stream-error') {
      assistantText = `تعذر الاتصال: ${message.message}`;
      assistant?.classList.add('error');
      updateBubbleText(assistant, assistantText);
    } else if (message?.type === 'end') {
      finishStream();
    }
  });
  port.onDisconnect.addListener(() => finishStream());
  port.postMessage({
    type: 'start',
    payload: {
      text: payloadText,
      conversationId: conversationId || undefined,
      modelId: modelSelect.value === 'auto' ? undefined : modelSelect.value,
    },
  });
}

function finishStream() {
  streaming = false;
  const sendBtn = drawerEl?.querySelector('[data-act="send"]') as HTMLButtonElement | null;
  if (sendBtn) {
    sendBtn.textContent = 'إرسال';
    sendBtn.classList.remove('stop');
  }
  streamPort = null;
}

function stopStream() {
  try {
    streamPort?.disconnect();
  } catch {
    /* already closed */
  }
  finishStream();
}

async function undoBatch() {
  if (!batchId) return;
  const response = await sendMessage<{ ok: boolean; undone?: number; error?: any }>({ type: 'aya-undo', batchId });
  if (response?.ok) {
    showToast(`↩ تم التراجع عن ${response.undone ?? 0} عملية`);
    batchId = null;
    const undoBtn = drawerEl?.querySelector('[data-act="undo"]') as HTMLElement | null;
    if (undoBtn) undoBtn.hidden = true;
  } else {
    showToast('تعذر التراجع', { state: 'err' });
  }
}

/* ------------------------------------------------------------- quick add */

function toggleQuickAdd() {
  if (quickOpen) closeQuickAdd();
  else openQuickAdd();
}

function openQuickAdd() {
  if (!rootEl) return;
  if (quickOpen) return;
  quickOpen = true;
  quickEl = document.createElement('div');
  quickEl.className = 'k-overlay';
  quickEl.innerHTML = `
    <div class="k-modal" role="dialog" aria-label="مهمة سريعة">
      <div class="k-modal-head">
        <div class="k-brand-title">إضافة سريعة</div>
        <button class="k-icon-btn" data-act="close">✕</button>
      </div>
      <div class="k-modal-body">
        <input class="k-input" data-role="title" placeholder="عنوان المهمة…" />
        <textarea class="k-textarea" data-role="desc" rows="2" placeholder="وصف أو ملاحظات (اختياري)"></textarea>
        <div class="k-inline">
          <div class="k-segmented">
            <button data-mode="task" class="active">مهمة</button>
            <button data-mode="note">ملاحظة</button>
            <button data-mode="checklist">تشيك بوكس</button>
          </div>
          <select class="k-select" data-role="priority">
            <option value="4">P4 عادي</option>
            <option value="3">P3 مهم</option>
            <option value="2">P2 عاجل</option>
            <option value="1">P1 ضروري</option>
          </select>
          <select class="k-select" data-role="project"><option value="">الوارد</option></select>
        </div>
        <label class="k-check"><input type="checkbox" data-role="link" checked /> ربط الصفحة الحالية</label>
      </div>
      <div class="k-modal-foot">
        <button class="k-btn ghost" data-act="cancel">إلغاء</button>
        <button class="k-btn primary" data-act="save">إضافة ✓</button>
      </div>
    </div>
  `;
  rootEl.appendChild(quickEl);

  let mode: 'task' | 'note' | 'checklist' = 'task';
  quickEl.querySelector('[data-act="close"]')!.addEventListener('click', closeQuickAdd);
  quickEl.querySelector('[data-act="cancel"]')!.addEventListener('click', closeQuickAdd);
  quickEl.addEventListener('click', (event) => {
    if (event.target === quickEl) closeQuickAdd();
  });
  quickEl.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = (button as HTMLElement).dataset.mode;
      mode = next === 'note' ? 'note' : next === 'checklist' ? 'checklist' : 'task';
      quickEl!.querySelectorAll('[data-mode]').forEach((node) => node.classList.toggle('active', node === button));
    });
  });

  const title = quickEl.querySelector('[data-role="title"]') as HTMLInputElement;
  const desc = quickEl.querySelector('[data-role="desc"]') as HTMLTextAreaElement;
  const priority = quickEl.querySelector('[data-role="priority"]') as HTMLSelectElement;
  const project = quickEl.querySelector('[data-role="project"]') as HTMLSelectElement;
  const link = quickEl.querySelector('[data-role="link"]') as HTMLInputElement;
  priority.value = String(settings.quickAddDefaultPriority ?? 4);
  if (document.title) title.value = document.title.replace(/\s*[-–—|]\s*.{0,48}$/, '').slice(0, 120);

  void sendMessage<{ ok: boolean; projects?: Array<{ id: string; name: string; nameAr?: string; isInbox?: boolean }> }>({
    type: 'aya-snapshot',
  }).then((response) => {
    for (const row of response?.projects ?? []) {
      if (row.isInbox) continue;
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = row.nameAr || row.name;
      project.appendChild(option);
    }
  });

  const save = async () => {
    const value = title.value.trim();
    if (!value) {
      title.focus();
      return;
    }
    const descriptionParts: string[] = [];
    if (desc.value.trim()) descriptionParts.push(desc.value.trim());
    if (link.checked) descriptionParts.push(`المصدر: ${document.title} (${location.href})`);
    const checklistMode = mode === 'checklist';
    const checklistItems = checklistMode
      ? (desc.value.trim() ? desc.value.split(/\r?\n/).map((row) => row.replace(/^[\s•\-*\d]+[\.\)]?\s*/, '').trim()).filter(Boolean) : [value])
      : [];
    const input: Record<string, unknown> = {
      content: mode === 'note' ? `📝 ${value}` : checklistMode ? `☑️ ${value}` : value,
      priority: Number(priority.value),
      description: checklistMode ? descriptionParts.slice(1).join('\n\n') || undefined : descriptionParts.join('\n\n') || undefined,
      projectId: project.value || undefined,
    };
    if (mode === 'note') input.labelNames = ['ملاحظة'];
    if (checklistMode) input.checklistItems = checklistItems;
    const response = await sendMessage<{ ok: boolean; queued?: boolean }>({ type: 'aya-create-task', input });
    if (response?.ok) {
      showToast(response.queued ? '📥 أوفلاين — هتتبعت لما الاتصال يرجع' : mode === 'note' ? '📝 تم حفظ الملاحظة' : '✓ تمت إضافة المهمة');
      closeQuickAdd();
    } else {
      showToast('تعذر إضافة العنصر', { state: 'err' });
    }
  };

  quickEl.querySelector('[data-act="save"]')!.addEventListener('click', save);
  title.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  });
  window.setTimeout(() => title.focus(), 60);
}

function closeQuickAdd() {
  quickEl?.remove();
  quickEl = null;
  quickOpen = false;
}

/* ---------------------------------------------------------------- startup */

void boot();

export {};
