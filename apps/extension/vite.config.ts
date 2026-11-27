import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync, rmSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath, URL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const extRoot = __dirname;
const outDir = join(extRoot, 'dist');
const iconRoot = join(extRoot, 'src/icons');
const htmlRoot = join(extRoot, 'html');
const srcRoot = join(extRoot, 'src');

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="bg" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#242424"/><stop offset="1" stop-color="#1e1e1e"/></linearGradient><linearGradient id="chip" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#de4c4a"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="256" height="256" rx="46" fill="url(#bg)"/><path d="M70 180c0-39 32-70 71-70 39 0 71 31 71 70-6 42-40 76-83 76-18 0-35-6-49-16z" fill="#000" opacity=".18"/><rect x="56" y="64" width="144" height="128" rx="28" fill="none" stroke="url(#chip)" stroke-width="14" opacity=".92"/><circle cx="90" cy="128" r="14" fill="#fff" opacity=".95"/><circle cx="138" cy="128" r="14" fill="#fff" opacity=".95"/><circle cx="186" cy="128" r="14" fill="#fff" opacity=".95"/><path d="M108 80h40l6 24h-52z" fill="#fff" opacity=".35"/></svg>`;

function ensureIconSvg(name: string, svg: string) {
  writeFileSync(join(iconRoot, name), svg, 'utf8');
}

const iconSizes = [16, 24, 32, 48, 64, 96, 128];
for (const s of iconSizes) {
  ensureIconSvg(`icon${s}.svg`, ICON_SVG.replace('<svg ', `<svg width="${s}" height="${s}" `));
}
ensureIconSvg('icon.svg', ICON_SVG);
ensureIconSvg('icon128.svg', ICON_SVG.replace('<svg ', '<svg width="128" height="128" '));

const manifest = {
  manifest_version: 3,
  name: '__AYAtodoist · آية',
  version: '0.1.0.0',
  description: 'Right-click tasks, floating Aya chat, quick-add and offline sync',
  default_locale: 'ar-AE',
  action: {
    default_icon: {
      '16': 'icons/icon16.svg',
      '24': 'icons/icon24.svg',
      '32': 'icons/icon32.svg',
      '48': 'icons/icon48.svg',
      '96': 'icons/icon96.svg',
      '128': 'icons/icon128.svg',
    },
    default_popup: 'popup.html',
  },
  side_panel: {
    default_path: 'sidepanel.html',
  },
  icons: {
    '16': 'icons/icon16.svg',
    '32': 'icons/icon32.svg',
    '48': 'icons/icon48.svg',
    '96': 'icons/icon96.svg',
    '128': 'icons/icon128.svg',
  },
  default_title: 'آية · __AYAtodoist',
  permissions: [
    'contextMenus',
    'storage',
    'activeTab',
    'scripting',
    'notifications',
    'alarms',
    'sidePanel',
  ],
  host_permissions: [
    'http://127.0.0.1:8787/*',
    'http://localhost:8787/*',
    '<all_urls>',
  ],
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['content.js'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    {
      matches: ['<all_urls>'],
      resources: ['content.css', 'content.js', 'icons/*'],
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; style-src 'self' 'unsafe-inline' 'wasm'; img-src 'self' data: https: blob:; media-src 'self'; connect-src 'self' http://127.0.0.1:8787 http://localhost:8787 https://127.0.0.1:8787 https://localhost:8787",
  },
  commands: {
    '_execute_action': { suggested_key: { default: 'Alt+A' } },
    '_execute_side_panel': { suggested_key: { default: 'Alt+S' }, description: 'open side panel' },
    'aya-chat': { suggested_key: { default: 'Alt+A' }, description: 'toggle floating Aya chat drawer' },
    'quick-add': { suggested_key: { default: 'Alt+Q' }, description: 'quick-add task from the current page' },
  },
  options_page: 'settings.html',
};

function shell(name: string, entryJs: string, entryCss?: string) {
  const parts: string[] = [
    '<!DOCTYPE html>',
    '<html lang="ar" dir="rtl">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>آية · __AYAtodoist</title>',
  ];
  if (entryCss) parts.push(`<link rel="stylesheet" href="${entryCss}" />`);
  parts.push('</head>');
  parts.push('<body>');
  parts.push('<div id="root"></div>');
  parts.push(`<script type="module" src="${entryJs}"></script>`);
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('');
}

const popupHtml = shell('popup', 'popup.js', 'popup.css');
const sidepanelHtml = shell('sidepanel', 'sidepanel.js', 'sidepanel.css');
const settingsHtml = shell('settings', 'settings.js', 'settings.css');

mkdirSync(htmlRoot, { recursive: true });
writeFileSync(join(htmlRoot, 'popup.html'), popupHtml, 'utf8');
writeFileSync(join(htmlRoot, 'sidepanel.html'), sidepanelHtml, 'utf8');
writeFileSync(join(htmlRoot, 'settings.html'), settingsHtml, 'utf8');

export default defineConfig({
  resolve: {
    alias: [
      { find: 'popup.js', replacement: join(srcRoot, 'popup/index.tsx') },
      { find: 'sidepanel.js', replacement: join(srcRoot, 'sidepanel/index.tsx') },
      { find: 'settings.js', replacement: join(srcRoot, 'settings/index.tsx') },
      { find: 'content.js', replacement: join(srcRoot, 'content/index.tsx') },
    ],
  },
  plugins: [
    react(),
    {
      name: 'aya-extension-manifest',
      writeBundle() {
        mkdirSync(outDir, { recursive: true });
        mkdirSync(join(outDir, 'icons'), { recursive: true });
        writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
        for (const s of iconSizes) {
          const src = join(iconRoot, `icon${s}.svg`);
          if (existsSync(src)) copyFileSync(src, join(outDir, 'icons', `icon${s}.svg`));
        }
        copyFileSync(join(iconRoot, 'icon.svg'), join(outDir, 'icons', 'icon.svg'));
        copyFileSync(join(iconRoot, 'icon128.svg'), join(outDir, 'icons', 'icon128.svg'));
        const contentHtml = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>آية · __AYAtodoist</title><link rel="stylesheet" href="content.css" /></head><body><div id="root"></div><script type="module" src="content.js"></script></body></html>`;
        writeFileSync(join(outDir, 'content.html'), contentHtml, 'utf8');
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: join(htmlRoot, 'popup.html'),
        sidepanel: join(htmlRoot, 'sidepanel.html'),
        settings: join(htmlRoot, 'settings.html'),
      },
      output: {
        entryFileNames: (chunkInfo: any) => {
          if (chunkInfo.name === 'content') return 'content.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    target: 'es2022',
    sourcemap: false,
  },
});
