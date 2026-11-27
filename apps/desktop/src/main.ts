import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const isDev = process.env.AYATODOIST_DEV === '1';
const DEV_URL = process.env.AYATODOIST_URL ?? 'http://localhost:5173';
const PROTOCOL = 'ayatodoist';

let mainWindow: BrowserWindow | null = null;
let quickAddWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function readState(): { width: number; height: number; x?: number; y?: number } {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { width: 1200, height: 800 };
  }
}

function saveState(window: BrowserWindow): void {
  try {
    if (window.isMinimized() || window.isMaximized()) return;
    const bounds = window.getBounds();
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(bounds));
  } catch {
    /* best effort */
  }
}

function webEntry(): { kind: 'url'; url: string } | { kind: 'file'; file: string } {
  if (isDev) return { kind: 'url', url: DEV_URL };
  return { kind: 'file', file: path.join(__dirname, '../../web/dist/index.html') };
}

function load(window: BrowserWindow, query?: Record<string, string>): void {
  const entry = webEntry();
  if (entry.kind === 'url') {
    const url = new URL(entry.url);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(entry.file, { query });
  }
}

/* A tiny original PNG encoder so the tray has a real icon without binary assets. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function trayIcon(): Electron.NativeImage {
  const size = 22;
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size / 2 - 1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const distance = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5);
      const inside = distance <= radius;
      const check = (Math.abs(x - y) < 3.2 && x > 6 && x < 12) || (Math.abs(x + y - size) < 3.2 && x >= 11 && x < 18);
      rgba[index] = check ? 255 : 220;
      rgba[index + 1] = check ? 255 : 76;
      rgba[index + 2] = check ? 255 : 62;
      rgba[index + 3] = inside ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function createMainWindow(): BrowserWindow {
  const state = readState();
  const window = new BrowserWindow({
    width: state.width ?? 1200,
    height: state.height ?? 800,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#1e1e1e',
    title: '__AYAtodoist',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  load(window);
  window.once('ready-to-show', () => window.show());
  window.on('resize', () => saveState(window));
  window.on('move', () => saveState(window));
  window.on('closed', () => {
    mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  return window;
}

function showMain(): void {
  if (!mainWindow) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createQuickAdd(): BrowserWindow {
  const window = new BrowserWindow({
    width: 700,
    height: 640,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#282828',
    title: 'Quick add',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  load(window, { mode: 'quickadd' });
  window.once('ready-to-show', () => window.show());
  window.on('blur', () => window.hide());
  window.on('closed', () => {
    quickAddWindow = null;
  });
  return window;
}

function toggleQuickAdd(): void {
  if (!quickAddWindow) quickAddWindow = createQuickAdd();
  if (quickAddWindow.isVisible()) quickAddWindow.hide();
  else {
    quickAddWindow.show();
    quickAddWindow.focus();
  }
}

function buildTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('__AYAtodoist');
  const menu = Menu.buildFromTemplate([
    { label: 'Show __AYAtodoist', click: () => showMain() },
    { label: 'Quick add', accelerator: 'CommandOrControl+Space', click: () => toggleQuickAdd() },
    { type: 'separator' },
    {
      label: 'Open settings',
      click: () => {
        showMain();
        mainWindow?.webContents.send('app:open-settings');
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMain());
}

function handleProtocol(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return;
  const target = url.replace(`${PROTOCOL}://`, '').replace(/\/$/, '');
  if (target === 'quickadd' || target === 'quick-add') {
    if (!quickAddWindow) quickAddWindow = createQuickAdd();
    quickAddWindow.show();
    return;
  }
  showMain();
  if (target === 'settings') mainWindow?.webContents.send('app:open-settings');
  if (target.startsWith('task/')) {
    const taskId = target.slice('task/'.length);
    mainWindow?.webContents.send('app:open-task', taskId);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const protocolUrl = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (protocolUrl) handleProtocol(protocolUrl);
    else showMain();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocol(url);
  });

  void app.whenReady().then(() => {
    app.setAsDefaultProtocolClient(PROTOCOL);
    mainWindow = createMainWindow();
    buildTray();

    globalShortcut.register('CommandOrControl+Space', () => toggleQuickAdd());
    globalShortcut.register('Super+Alt+S', () => showMain());
    globalShortcut.register('Alt+Shift+R', () => toggleQuickAdd());

    ipcMain.on('quick-add:close', () => quickAddWindow?.hide());
    ipcMain.on('quick-add:resize', (_event, height: number) => {
      if (!quickAddWindow) return;
      const bounds = quickAddWindow.getBounds();
      quickAddWindow.setBounds({ ...bounds, height: Math.max(240, Math.min(640, Math.round(height))) });
    });
    ipcMain.on('app:show-main', () => showMain());
    ipcMain.on('app:open-settings', () => {
      showMain();
      mainWindow?.webContents.send('app:open-settings');
    });

    app.on('activate', () => showMain());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  const protocolArg = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (protocolArg) app.on('ready', () => handleProtocol(protocolArg));
}
