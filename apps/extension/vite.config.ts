import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';
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

const iconSizes = [16, 32, 48, 128];
for (const s of iconSizes) {
  ensureIconSvg(`icon${s}.svg`, ICON_SVG.replace('<svg ', `<svg width="${s}" height="${s}" `));
}
ensureIconSvg('icon.svg', ICON_SVG);
ensureIconSvg('icon128.svg', ICON_SVG.replace('<svg ', '<svg width="128" height="128" '));

/* --------------------------------------------------------------------------
 * PNG icons.
 *
 * MV3 refuses SVG toolbar icons (“Could not load icon”), so the mark above is
 * rasterised at build time into 16/32/48/128 px RGBA PNGs. Pure Node: a tiny
 * supersampling rasteriser plus a hand-rolled PNG encoder (zlib for IDAT), so
 * the build keeps working without an image dependency.
 * ------------------------------------------------------------------------ */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(size: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle centred in a unit square. */
function roundedRectDistance(u: number, v: number, halfW: number, halfH: number, radius: number): number {
  const qx = Math.abs(u - 0.5) - (halfW - radius);
  const qy = Math.abs(v - 0.5) - (halfH - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function iconSample(u: number, v: number): [number, number, number, number] {
  // Transparent outside the rounded app tile.
  if (roundedRectDistance(u, v, 0.5, 0.5, 0.18) > 0) return [0, 0, 0, 0];

  // Dark graphite base, slightly lighter at the top.
  const shade = 0x1e + (0x24 - 0x1e) * (1 - (u + v) / 2);
  let r = shade;
  let g = shade;
  let b = shade;

  // Red → violet chip outline, stroked along the rounded rectangle.
  const ring = Math.abs(roundedRectDistance(u, v, 0.281, 0.25, 0.11));
  if (ring < 0.0275) {
    const t = Math.min(1, Math.max(0, (u + v) / 2));
    r = 0xde + (0x8b - 0xde) * t;
    g = 0x4c + (0x5c - 0x4c) * t;
    b = 0x4a + (0xf6 - 0x4a) * t;
  }

  // Three dots of the Aya mark.
  for (const cx of [0.352, 0.539, 0.727]) {
    if (Math.hypot(u - cx, v - 0.5) < 0.0547) {
      r = 255;
      g = 255;
      b = 255;
    }
  }

  return [r, g, b, 255];
}

function renderIconPng(size: number): Buffer {
  const samples = 3;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const [sr, sg, sb, sa] = iconSample((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
          pr += (sr * sa) / 255;
          pg += (sg * sa) / 255;
          pb += (sb * sa) / 255;
          pa += sa;
        }
      }
      const count = samples * samples;
      const alpha = pa / count;
      const offset = (y * size + x) * 4;
      rgba[offset] = alpha > 0 ? Math.round((pr / count) * (255 / alpha)) : 0;
      rgba[offset + 1] = alpha > 0 ? Math.round((pg / count) * (255 / alpha)) : 0;
      rgba[offset + 2] = alpha > 0 ? Math.round((pb / count) * (255 / alpha)) : 0;
      rgba[offset + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, rgba);
}

const manifest = {
  manifest_version: 3,
  name: '__AYAtodoist · آية',
  version: '0.1.0.0',
  description: 'Right-click tasks, floating Aya chat, quick-add and offline sync',
  action: {
    default_title: 'آية · __AYAtodoist',
    default_icon: {
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    default_popup: 'html/popup.html',
  },
  side_panel: {
    default_path: 'html/sidepanel.html',
  },
  icons: {
    '16': 'icons/icon16.png',
    '32': 'icons/icon32.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  },
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
    'https://aya-notebook-web.netlify.app/*',
    'http://127.0.0.1:8787/*',
    'http://localhost:8787/*',
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
      resources: ['content.js', 'icons/*'],
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; media-src 'self'; connect-src 'self' http://127.0.0.1:8787 http://localhost:8787 https://127.0.0.1:8787 https://localhost:8787 https://aya-notebook-web.netlify.app",
  },
  commands: {
    '_execute_action': { suggested_key: { default: 'Alt+A' } },
    '_execute_side_panel': { suggested_key: { default: 'Alt+S' }, description: 'open side panel' },
    'aya-chat': { suggested_key: { default: 'Alt+Shift+A' }, description: 'toggle floating Aya chat drawer' },
    'quick-add': { suggested_key: { default: 'Alt+Q' }, description: 'quick-add task from the current page' },
  },
  options_page: 'html/settings.html',
};

// Page CSS is imported by each entry, so Vite emits and injects it itself.
function shell(entryJs: string) {
  const parts: string[] = [
    '<!DOCTYPE html>',
    '<html lang="ar" dir="rtl">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>آية · __AYAtodoist</title>',
  ];
  parts.push('</head>');
  parts.push('<body>');
  parts.push('<div id="root"></div>');
  parts.push(`<script type="module" src="${entryJs}"></script>`);
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('');
}

const popupHtml = shell('popup.js');
const sidepanelHtml = shell('sidepanel.js');
const settingsHtml = shell('settings.js');

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
          writeFileSync(join(outDir, 'icons', `icon${s}.png`), renderIconPng(s));
          const src = join(iconRoot, `icon${s}.svg`);
          if (existsSync(src)) copyFileSync(src, join(outDir, 'icons', `icon${s}.svg`));
        }
        copyFileSync(join(iconRoot, 'icon.svg'), join(outDir, 'icons', 'icon.svg'));
        copyFileSync(join(iconRoot, 'icon128.svg'), join(outDir, 'icons', 'icon128.svg'));
        const contentHtml = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>آية · __AYAtodoist</title></head><body><div id="root"></div><script type="module" src="content.js"></script></body></html>`;
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
        background: join(srcRoot, 'background/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo: any) => {
          if (chunkInfo.name === 'background') return 'background.js';
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
