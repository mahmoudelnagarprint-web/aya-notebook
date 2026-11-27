import { defineConfig } from 'vite';
import { join } from 'path';
import { fileURLToPath, URL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Content scripts are injected as classic scripts, so `content.js` must be one
 * self-contained IIFE: a shared chunk or an `import` statement would fail at
 * injection time. It therefore gets its own single-entry build, appending to
 * the `dist/` produced by the main config.
 */
export default defineConfig({
  build: {
    outDir: join(__dirname, 'dist'),
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: join(__dirname, 'src/content/index.tsx'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'content.js',
        assetFileNames: (asset: { names?: string[]; name?: string }) => {
          const name = asset.names?.[0] ?? asset.name ?? '';
          return name.endsWith('.css') ? 'content.css' : 'assets/[name][extname]';
        },
      },
    },
  },
});
