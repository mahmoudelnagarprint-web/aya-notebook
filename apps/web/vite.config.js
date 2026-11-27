import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
const r = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: [
            { find: '@ayatodoist/plugin-tasks-core/ui', replacement: r('plugins/plugin-tasks-core/src/ui/index.ts') },
            { find: '@ayatodoist/plugin-tasks-core/shared', replacement: r('plugins/plugin-tasks-core/src/shared.ts') },
            { find: '@ayatodoist/plugin-tasks-core', replacement: r('plugins/plugin-tasks-core/src/index.ts') },
            { find: '@ayatodoist/plugin-quick-add-nlp/parser', replacement: r('plugins/plugin-quick-add-nlp/src/parser.ts') },
            { find: '@ayatodoist/plugin-quick-add-nlp/ui', replacement: r('plugins/plugin-quick-add-nlp/src/ui.tsx') },
            { find: '@ayatodoist/plugin-quick-add-nlp', replacement: r('plugins/plugin-quick-add-nlp/src/index.ts') },
            { find: '@ayatodoist/plugin-views-layouts/ui', replacement: r('plugins/plugin-views-layouts/src/ui.tsx') },
            { find: '@ayatodoist/plugin-views-layouts', replacement: r('plugins/plugin-views-layouts/src/index.ts') },
            { find: '@ayatodoist/plugin-filters-labels/ui', replacement: r('plugins/plugin-filters-labels/src/ui.tsx') },
            { find: '@ayatodoist/plugin-filters-labels', replacement: r('plugins/plugin-filters-labels/src/index.ts') },
            { find: '@ayatodoist/plugin-reporting/ui', replacement: r('plugins/plugin-reporting/src/ui.tsx') },
            { find: '@ayatodoist/plugin-reporting', replacement: r('plugins/plugin-reporting/src/index.ts') },
            { find: '@ayatodoist/plugin-ai-agent/ui', replacement: r('plugins/plugin-ai-agent/src/ui.tsx') },
            { find: '@ayatodoist/plugin-ai-agent/engine', replacement: r('plugins/plugin-ai-agent/src/engine.ts') },
            { find: '@ayatodoist/plugin-ai-agent', replacement: r('plugins/plugin-ai-agent/src/index.ts') },
            { find: '@ayatodoist/plugin-checklists-media/ui', replacement: r('plugins/plugin-checklists-media/src/ui.tsx') },
            { find: '@ayatodoist/plugin-checklists-media', replacement: r('plugins/plugin-checklists-media/src/index.ts') },
            { find: '@ayatodoist/plugin-sdk/react', replacement: r('packages/plugin-sdk/src/react.tsx') },
            { find: '@ayatodoist/plugin-sdk/ui', replacement: r('packages/plugin-sdk/src/ui.tsx') },
            { find: '@ayatodoist/plugin-sdk', replacement: r('packages/plugin-sdk/src/index.ts') },
            { find: '@ayatodoist/core-kernel', replacement: r('packages/core-kernel/src/index.ts') },
            { find: '@ayatodoist/shared-types', replacement: r('packages/shared-types/src/index.ts') },
            { find: '@ayatodoist/database', replacement: r('packages/database/src/index.ts') },
        ],
    },
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
        },
    },
    build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
