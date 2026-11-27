/**
 * Content script — mounted once per tab inside a Shadow DOM root so the host page
 * CSS can never leak in and our styles can never leak out. All real work (server
 * calls, context menus, alarms, queue) is delegated to the background worker via
 * `chrome.runtime` messages. This file owns the floating UI only.
 */

import './main.css';
import { extractPageText, pageContextBlock } from '../lib/helpers';
import { ayaServer } from '../lib/server';
import { setPendingImage, toggleQuickAdd } from './messages';
import type {} from './messages';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { ayaExtension?: any; }
}

// ---------- singletons ----------
let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let drawerOpen = false;
let quickAddOpen = false;
let pendingImage: File | null = null;

// ---------- mount ----------
export function mountAyaExtension(container?: HTMLElement) {
  const root = container ?? document.body;
  if (document.getElementById('aya-shadow-host')) return;
  const host = document.createElement('div');
  host.id = 'aya-shadow-host';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  root.appendChild(host);
  // Modal host: a fixed overlay that can appear above the page.
  const overlay = document.createElement('div');
  overlay.id = 'aya-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:none;';
  root.appendChild(overlay);
  hostEl = host;
  shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      /* Reset inside shadow so no page styles apply. */
      :host { all: initial; display: block; }
      .kaya-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.32); display: flex; align-items: flex-start; justify-content: flex-end; z-index: 2147483646; pointer-events: none; }
      .kaya-host { position: relative; pointer-events: auto; }
      /* Keep styles isolated: import main.css inside shadow too. */
    </style>
  `;

  // Bring in the shared CSS inside the shadow so the UI looks right.
  import('../content/main.css').then(() => {
    // re-apply after CSS is loaded (no-op, but makes styles available).
  });

  // Render the floating handle + quick-add overlay host.
  renderHandle(shadow!);
  renderOverlay(overlay, shadow!);

  // Wire hotkeys per tab.
  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const mod = e.altKey && !e.ctrlKey && !e.metaKey;
    if ((e.key === 'a' || e.key === 'A') && mod && !isInsideInput()) {
      e.preventDefault();
      toggleDrawer();
    } else if ((e.key === 'q' || e.key === 'Q') && mod) {
      e.preventDefault();
      toggleQuickAdd();
    } else if (e.key === 'Escape') {
      if (drawerOpen) closeDrawer();
      else if (quickAddOpen) closeQuickAdd();
    }
  });
}

function isInsideInput() {
  const el = document.activeElement;
  if (!el) return false;
  return (el as HTMLElement).tagName === 'INPUT' || (el as HTMLElement).tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

// ---------- handle ----------
function renderHandle(shadowRoot: ShadowRoot) {
  const wrap = document.createElement('div');
  wrap.className = 'kaya-handle-host';
  wrap.style.cssText = 'position:fixed;pointer-events:auto;z-index:2147483645;';
  const bar = document.createElement('div');
  bar.className = 'kaya-handle';
  bar.style.cssText = 'position:absolute;width:32px;height:220px;border-radius:16px 16px 16px 16px;background:linear-gradient(180deg,#3a3a3a,#1e1e1e);border:1px solid #3a3a3a;box-shadow:0 8px 22px rgba(0,0,0,.5);display:flex;flex-direction:column;align-items:center;padding:8px 0;cursor:pointer;user-select:none;';
  bar.innerHTML = `
    <div class="kaya-handle-grip" style="width:4px;height:40px;border-radius:4px;background:#5a5a5a;margin-bottom:8px;"></div>
    <div class="kaya-handle-label" style="font-size:9px;color:#9a9a9a;letter-spacing:.5px;white-space:nowrap;">آية</div>
    <div class="kaya-handle-plus" style="margin-top:auto;width:22px;height:22px;border-radius:50%;background:#de4c4a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;box-shadow:0 4px 10px rgba(222,76,74,.4);">+</div>
  `;
  const plus = bar.querySelector('.kaya-handle-plus') as HTMLElement;
  plus.addEventListener('click', (e) => { e.stopPropagation(); toggleQuickAdd(); });
  bar.addEventListener('click', () => toggleDrawer());

  shadowRoot.appendChild(wrap);
  wrap.appendChild(bar);

  // Vertical drag for handle position.
  let dragging = false, startY = 0, startTop = 0;
  bar.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).classList.contains('kaya-handle-plus')) return;
    dragging = true;
    startY = e.clientY;
    startTop = bar.offsetTop + bar.offsetHeight / 2;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = e.clientY - startY;
    const top = Math.max(20, Math.min(window.innerHeight - 240, startTop + delta));
    bar.style.top = (top - bar.offsetHeight / 2) + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  // initial position
  bar.style.top = '20px';
  bar.style.right = '10px';
  bar.style.left = 'auto';
}

// ---------- overlay (quick-add + drawer host) ----------
function renderOverlay(overlay: HTMLElement, shadowRoot: ShadowRoot) {
  shadowRoot.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'aya-overlay') {
      closeDrawer();
      closeQuickAdd();
    }
  });
}

// ---------- drawer ----------
async function toggleDrawer() {
  if (drawerOpen) closeDrawer();
  else openDrawer();
}

async function openDrawer() {
  if (drawerOpen) return;
  drawerOpen = true;
  showOverlay();
  const host = document.createElement('div');
  host.className = 'kaya-host kaya-drawer-host';
  shadow!.appendChild(host);
  renderDrawer(host);
  // read settings to know about page context
  const settings = await readSettings();
  if (settings.pageContextEnabled && settings.pageContextTrim) {
    const text = extractPageText(document, settings.pageContextTrim);
    if (text) {
      const block = pageContextBlock(document.title, location.href, text, settings.pageContextTrim);
      // prepend a collapsible context note
      showContextNote(host, block);
    }
  }
  // Focus composer
  setTimeout(() => {
    const inp = host.querySelector('#aya-composer') as HTMLTextAreaElement;
    if (inp) inp.focus();
  }, 60);
}

async function closeDrawer() {
  drawerOpen = false;
  const host = shadow!.querySelector('.kaya-drawer-host') as HTMLElement | null;
  if (host) host.remove();
  hideOverlayWhenNoDrawer();
}

// ---------- quick-add ----------
async function toggleQuickAdd() {
  if (quickAddOpen) closeQuickAdd();
  else openQuickAdd();
}

async function openQuickAdd() {
  if (quickAddOpen) return;
  quickAddOpen = true;
  showOverlay();
  const modal = document.createElement('div');
  modal.className = 'kaya-overlay';
  modal.id = 'aya-quick-add-overlay';
  const inner = document.createElement('div');
  inner.className = 'kaya-host';
  inner.style.cssText = 'align-items:center;justify-content:center;';
  modal.appendChild(inner);
  shadow!.appendChild(modal);
  renderQuickAdd(inner);
}

async function closeQuickAdd() {
  quickAddOpen = false;
  const m = shadow!.querySelector('#aya-quick-add-overlay') as HTMLElement | null;
  if (m) m.remove();
  hideOverlayWhenNoDrawer();
}

function showOverlay() {
  const o = shadow!.querySelector('.kaya-overlay') as HTMLElement;
  o.style.display = 'flex';
  // ensure a single overlay
  const existing = shadow!.querySelectorAll('.kaya-overlay').length;
  if (existing > 1) {
    // remove extras
    const nodes = shadow!.querySelectorAll('.kaya-overlay');
    for (let i = nodes.length - 1; i > 0; i--) nodes[i]!.remove();
  }
}

function hideOverlayWhenNoDrawer() {
  const o = shadow!.querySelector('.kaya-overlay') as HTMLElement | null;
  if (o && !shadow!.querySelector('.kaya-drawer-host') && !shadow!.querySelector('#aya-quick-add-overlay')) {
    o.style.display = 'none';
  }
}

async function readSettings() {
  return new Promise<any>((resolve) => {
    chrome.storage.local.get(['aya:settings'], (r: any) => resolve(r['aya:settings'] || null));
  });
}

function showContextNote(host: HTMLElement, block: string) {
  const note = document.createElement('div');
  note.style.cssText = 'padding:8px 12px;background:#2a2a2a;border-bottom:1px solid #323232;color:#9a9a9a;font-size:11px;border-radius:12px 12px 0 0;cursor:text;max-height:80px;overflow:auto;user-select:none;';
  note.textContent = '📄 الصفحة المفتوحة — اضغط للنسخ / إخفاء';
  note.addEventListener('click', () => {
    clipboardWrite(block).catch(() => {});
  });
  host.appendChild(note);
}

async function clipboardWrite(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// ---------- drawer render ----------
function renderDrawer(host: HTMLElement) {
  host.style.cssText = 'width:360px;max-width:90vw;height:78vh;max-height:calc(100vh - 40px);background:#242424;border:1px solid #323232;border-radius:16px 0 0 16px;box-shadow:0 12px 36px rgba(0,0,0,.5);display:flex;flex-direction:column;position:relative;justify-content:space-between;';
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    host.style.background = '#2c2c2c';
  }

  // Header
  const head = document.createElement('div');
  head.style.cssText = 'padding:12px 14px;border-bottom:1px solid #323232;display:flex;align-items:center;justify-content:space-between;gap:8px;';
  head.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#de4c4a,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px;">آ</div>
      <div>
        <div style="font-size:13px;color:#fbfbfb;font-weight:600;">آية ✨</div>
        <div style="font-size:10px;color:#9a9a9a;">تلقائي</div>
      </div>
    </div>
    <div style="display:flex;gap:4px;">
      <button class="k-btn k-btn-ghost" id="aya-page-context-toggle" style="padding:4px 8px;border-radius:8px;font-size:11px;">📄 الصفحة</button>
      <button class="k-btn k-btn-ghost" id="aya-stop" style="padding:4px 8px;border-radius:8px;font-size:11px;color:#ff8a82;">🛑 إيقاف</button>
      <button class="k-btn k-btn-ghost" id="aya-close-drawer" style="padding:4px 8px;border-radius:8px;font-size:11px;">✕</button>
    </div>
  `;
  host.appendChild(head);

  // Model switcher row
  const modelRow = document.createElement('div');
  modelRow.style.cssText = 'padding:8px 14px;border-bottom:1px solid #2a2a2a;display:flex;align-items:center;gap:8px;';
  modelRow.innerHTML = `
    <span class="k-label" style="font-size:10px;color:#9a9a9a;">الموديل</span>
    <select id="aya-model" style="flex:1;background:#1e1e1e;color:#fbfbfb;border:1px solid #323232;border-radius:8px;padding:5px 8px;font-size:12px;"></select>
  `;
  host.appendChild(modelRow);

  // Composer
  const composer = document.createElement('div');
  composer.style.cssText = 'padding:10px 14px;display:flex;flex-direction:column;gap:8px;';
  composer.innerHTML = `
    <div style="display:flex;gap:8px;align-items:flex-start;">
      <div style="position:relative;flex:1;">
        <textarea id="aya-composer" class="k-input" rows="2" placeholder="اكتبي رسالة لآية…" style="resize:vertical;min-height:40px;"></textarea>
        <div id="aya-attach-preview" style="position:absolute;right:-2px;top:-2px;width:36px;height:36px;border-radius:8px;background:#3a3a3a;display:none;align-items:center;justify-content:center;border:1px solid #4a4a4a;">
          <span style="color:#fbfbfb;font-size:16px;">🖼️</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <button class="k-btn k-btn-ghost" id="aya-image-btn" style="padding:6px;width:36px;height:36px;border-radius:10px;font-size:16px;" title="رفع صورة">🖼️</button>
        <button class="k-btn k-btn-ghost k-accent" id="aya-send" style="padding:6px 14px;border-radius:10px;font-size:12px;font-weight:600;">إرسال</button>
      </div>
    </div>
  `;
  host.appendChild(composer);

  // Tool chips + stream text area
  const stream = document.createElement('div');
  stream.style.cssText = 'padding:0 14px 10px;display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;overflow:auto;';
  stream.id = 'aya-stream';
  stream.innerHTML = `<div id="aya-stream-text" style="font-size:13px;color:#fbfbfb;line-height:1.55;white-space:pre-wrap;word-break:break-word;"></div>`;
  host.appendChild(stream);

  // Footer toolbar
  const foot = document.createElement('div');
  foot.style.cssText = 'padding:8px 14px;border-top:1px solid #323232;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
  host.appendChild(foot);

  // Wire buttons
  const send = host.querySelector('#aya-send') as HTMLButtonElement;
  const composerText = host.querySelector('#aya-composer') as HTMLTextAreaElement;
  const stopBtn = host.querySelector('#aya-stop') as HTMLButtonElement;
  const closeBtn = host.querySelector('#aya-close-drawer') as HTMLButtonElement;
  const modelSelect = host.querySelector('#aya-model') as HTMLSelectElement;
  const pageToggle = host.querySelector('#aya-page-context-toggle') as HTMLButtonElement;
  const imageBtn = host.querySelector('#aya-image-btn') as HTMLButtonElement;
  const attachPreview = host.querySelector('#aya-attach-preview') as HTMLElement;

  send.addEventListener('click', async () => {
    await sendMessage(host, composerText, modelSelect.value, !!pageToggle.dataset.on);
  });
  composerText.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await sendMessage(host, composerText, modelSelect.value, !!pageToggle.dataset.on);
    }
  });
  stopBtn.addEventListener('click', () => stopStream(host));
  closeBtn.addEventListener('click', () => closeDrawer());
  pageToggle.addEventListener('click', async () => {
    const on = !pageToggle.dataset.on;
    pageToggle.dataset.on = String(on);
    pageToggle.style.opacity = on ? '1' : '.4';
    pageToggle.textContent = on ? '📄 الصفحة ✓' : '📄 الصفحة';
    // if drawer open, re-render context note
    const existing = host.querySelector('[data-aya-context]') as HTMLElement | null;
    if (existing) existing.remove();
    if (on) {
      const settings = await readSettings();
      const text = extractPageText(document, settings?.pageContextTrim || 4000);
      if (text) {
        const block = pageContextBlock(document.title, location.href, text, settings?.pageContextTrim || 4000);
        showContextNote(host, block);
        const cur = host.appendChild ? host : host;
        const n = document.createElement('div');
        n.setAttribute('data-aya-context', '1');
        n.style.cssText = 'padding:8px 12px;background:#2a2a2a;border-bottom:1px solid #323232;color:#9a9a9a;font-size:11px;border-radius:12px 12px 0 0;cursor:text;max-height:80px;overflow:auto;user-select:none;';
        n.textContent = '📄 الصفحة المفتوحة — اضغط للنسخ';
        n.addEventListener('click', () => clipboardWrite(block).catch(()=>{}));
        host.insertBefore(n, host.firstChild);
      }
    }
  });
  imageBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.click();
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      pendingImage = file;
      attachPreview.style.display = 'flex';
      attachPreview.textContent = '🖼️';
      // update placeholder text
      composerText.placeholder = 'أرفعي صورة ثم اكتبي رسالة…';
    });
  });
  // Allow paste of images
  composerText.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        e.preventDefault();
        const blob = it.getAsFile();
        if (blob) {
          pendingImage = blob;
          attachPreview.style.display = 'flex';
          composerText.placeholder = 'أرفعي صورة ثم اكتبي رسالة…';
        }
        break;
      }
    }
  });
}

// Populate model list from server health/config on first open
async function populateModelSelect(select: HTMLSelectElement) {
  try {
    const health = await ayaServer.health();
    // We don't expose full model list cheaply from health; show a graceful default.
  } catch {}
  select.value = 'auto';
  const opt = document.createElement('option');
  opt.value = 'auto';
  opt.textContent = 'تلقائي';
  select.appendChild(opt);
}

let streamController: ReadableStreamDefaultController<any> | null = null;

async function sendMessage(host: HTMLElement, textarea: HTMLTextAreaElement, modelId: string, withPageContext: boolean) {
  const text = textarea.value.trim();
  if (!text && !pendingImage) return;
  // Build payload similar to the app's ayaApi.chatStream shape
  const payload = {
    conversationId: null,
    text,
    language: 'ar',
    modelId,
    attachments: pendingImage ? [{ kind: 'image', file: pendingImage }] : [],
    pageContext: withPageContext ? undefined : null,
  };
  textarea.value = '';
  pendingImage = null;
  const preview = host.querySelector('#aya-attach-preview') as HTMLElement | null;
  if (preview) preview.style.display = 'none';

  // Stream
  startStream(host, payload);
}

function startStream(host: HTMLElement, payload: any) {
  const textEl = host.querySelector('#aya-stream-text') as HTMLElement | null;
  const chipsEl = document.createElement('div');
  chipsEl.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:0 0 4px 0;';
  chipsEl.id = 'aya-chips';
  const streamEl = host.querySelector('#aya-stream') as HTMLElement;
  streamEl.insertBefore(chipsEl, streamEl.firstChild);
  if (textEl) textEl.textContent = '⏳ جاري التفكير…';

  const stream = ayaServer.chatStream(payload);
  const reader = stream.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const { event, data } = value;
        if (event === 'meta') {
          // possibly update conversation id
        } else if (event === 'delta') {
          if (textEl && data?.text) {
            textEl.textContent = (textEl.textContent || '') + data.text;
          }
        } else if (event === 'tool_start') {
          addChip(chipsEl, data.name, 'running');
        } else if (event === 'tool_result') {
          const chip = chipsEl.querySelector(`[data-chip="${data.name}"]`) as HTMLElement | null;
          if (chip) {
            chip.className = `k-chip ${data.ok ? 'done' : 'fail'}`;
            chip.textContent = data.ok ? `✅ ${data.name}` : `❌ ${data.name}`;
            if (data.summary) {
              const note = document.createElement('div');
              note.style.cssText = 'font-size:11px;color:#9a9a9a;background:#2a2a2a;padding:4px 8px;border-radius:8px;margin-top:4px;line-height:1.4;';
              note.textContent = data.summary;
              chipsEl.appendChild(note);
            }
          }
        } else if (event === 'done') {
          if (textEl) textEl.textContent = (textEl.textContent || '') + (data?.text || '');
          // enable undo if batchId
          if (data?.batchId) {
            const undo = document.createElement('button');
            undo.className = 'k-btn k-btn-ghost k-aya';
            undo.style.cssText = 'padding:4px 8px;border-radius:8px;font-size:11px;';
            undo.textContent = '↩ Established batch (undo)';
            undo.addEventListener('click', async () => {
              undo.textContent = '⏳ جاري التراجع…';
              try {
                const res = await ayaServer.command({ name: 'batch.undo', input: { batchId: data.batchId }, actor: 'user', confirmed: true });
                if (res.ok) undo.textContent = '↩ تم التراجع';
                else undo.textContent = `تراجع فشل: ${res.error?.message || res.error}`;
              } catch {
                undo.textContent = 'تراجع فشل';
              }
            });
            chipsEl.appendChild(undo);
          }
        } else if (event === 'error') {
          if (textEl) textEl.textContent = `خطأ: ${data?.message || 'غير متوقع'}`;
        }
      }
    } catch (err) {
      if (textEl) textEl.textContent = `اتصال فشل: ${err}`;
    }
  })();
}

function addChip(container: HTMLElement, name: string, state: 'running' | 'done' | 'fail') {
  const chip = document.createElement('span');
  chip.className = `k-chip ${state}`;
  chip.dataset.chip = name;
  chip.textContent = state === 'running' ? `⏳ ${name}` : (state === 'done' ? `✅ ${name}` : `❌ ${name}`);
  container.appendChild(chip);
}

function stopStream(host: HTMLElement) {
  streamController?.close();
  streamController = null;
}

// ---------- quick-add ----------
function renderQuickAdd(host: HTMLElement) {
  const modal = document.createElement('div');
  modal.className = 'kaya-overlay';
  modal.id = 'aya-quick-add-overlay';
  host.innerHTML = '';
  host.appendChild(modal);
  const inner = document.createElement('div');
  inner.className = 'kaya-host';
  inner.style.cssText = 'align-items:center;justify-content:center;';
  modal.appendChild(inner);
  const card = document.createElement('div');
  card.style.cssText = 'width:340px;max-width:calc(100vw - 40px);background:#242424;border:1px solid #323232;border-radius:16px;padding:16px;box-shadow:0 12px 36px rgba(0,0,0,.5);';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="font-size:13px;color:#fbfbfb;font-weight:600;">مهمة سريعة</div>
      <button class="k-btn k-btn-ghost" id="aya-qa-close" style="padding:4px 8px;border-radius:8px;color:#9a9a9a;">✕</button>
    </div>
    <div style="margin-bottom:8px;">
      <label class="k-label">عنوان المهمة</label>
      <input id="aya-qa-title" class="k-input" placeholder="مهمة جديدة…" style="margin-bottom:4px;">
    </div>
    <div style="margin-bottom:8px;">
      <label class="k-label">وصف (اختياري)</label>
      <textarea id="aya-qa-desc" class="k-input" rows="2" placeholder="وصف أو ملاحظات…" style="resize:vertical;min-height:40px;"></textarea>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
      <label class="k-label" style="margin-bottom:0;">ربط الصفحة الحالية</label>
      <input id="aya-qa-link" type="checkbox" class="k-checkbox" checked style="accent-color:#de4c4a;width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;">
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
      <label class="k-label" style="margin-bottom:0;">الأولوية</label>
      <select id="aya-qa-priority" style="flex:1;background:#1e1e1e;color:#fbfbfb;border:1px solid #323232;border-radius:8px;padding:5px 8px;font-size:12px;">
        <option value="4">P4 عادي</option>
        <option value="3">P3 مهم</option>
        <option value="2">P2 عاجل</option>
        <option value="1">P1 ضروري</option>
      </select>
    </div>
    <button class="k-btn k-btn-primary" id="aya-qa-confirm" style="width:100%;padding:8px;border-radius:10px;font-weight:600;font-size:13px;">إضافة المهمة ✓</button>
  `;
  inner.appendChild(card);

  const titleInput = card.querySelector('#aya-qa-title') as HTMLInputElement;
  const descInput = card.querySelector('#aya-qa-desc') as HTMLTextAreaElement;
  const linkCheck = card.querySelector('#aya-qa-link') as HTMLInputElement;
  const prioritySelect = card.querySelector('#aya-qa-priority') as HTMLSelectElement;
  const confirmBtn = card.querySelector('#aya-qa-confirm') as HTMLButtonElement;
  const closeBtn = card.querySelector('#aya-qa-close') as HTMLButtonElement;

  // pre-fill title with page title?
  if (document.title) {
    const trimmed = document.title.replace(/\s*[-–—]\s*.{0,40}$/i, '').trim();
    if (trimmed && trimmed.length < 120) titleInput.value = trimmed;
  }

  confirmBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    const desc = descInput.value.trim();
    const link = linkCheck.checked;
    const priority = parseInt(prioritySelect.value, 10) as 0 | 1 | 2 | 3;
    confirmBtn.textContent = 'جاري الإضافة…';
    confirmBtn.disabled = true;
    try {
      const input: any = { content: title };
      if (desc) input.description = desc;
      if (priority !== 4) input.priority = priority;
      if (link) {
        input.description = [input.description, `الصفحة: ${document.title || location.href}`, location.href].filter(Boolean).join('\n\n');
      }
      const res = await ayaServer.command({ name: 'task.create', input, actor: 'user', confirmed: true });
      if (res.ok) {
        showToast('✅ تمت إضافة المهمة');
        closeQuickAdd();
      } else {
        showToast('فشل إضافة المهمة: ' + (res.error?.message || res.error));
      }
    } catch (err) {
      // offline: enqueue
      const id = await enqueueOffline({ name: 'task.create', input: { content: title, description: desc, priority }, actor: 'user', confirmed: true });
      showToast('تم حفظ المهمة للمراسلة لاحقًا ✓');
      closeQuickAdd();
    } finally {
      confirmBtn.textContent = 'إضافة المهمة ✓';
      confirmBtn.disabled = false;
    }
  });
  closeBtn.addEventListener('click', () => closeQuickAdd());
  // Enter in title -> confirm
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); } });
  descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); } });
}

async function enqueueOffline(op: { name: string; input: any; actor: 'user' | 'ai' | 'system'; confirmed: boolean }) {
  const { enqueueOperation } = await import('../lib/queue');
  return enqueueOperation(op);
}

function showToast(msg: string) {
  const existing = document.querySelector('.k-toast') as HTMLElement | null;
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'k-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// expose for popup / sidepanel to toggle drawer without creating a new one
export function showDrawer() { openDrawer(); }
export function hideDrawer() { closeDrawer(); }

// ---------- bootstrap per tab ----------
// Chrome fires the content script on every page. We mount once and persist handle position.
let bootstrapped = false;
(async () => {
  if (bootstrapped) return;
  bootstrapped = true;
  await mountAyaExtension();
  // restore handle Y
  const y = await new Promise<number>((resolve) => {
    chrome.storage.local.get(['aya:handleY'], (r: any) => resolve(r['aya:handleY'] ?? 120));
  });
  const bar = document.querySelector('.kaya-handle') as HTMLElement | null;
  if (bar) bar.style.top = y + 'px';
})();
