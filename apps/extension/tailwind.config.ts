import type { Config } from 'tailwindcss';
import tailwind from 'tailwindcss';

export default {
  content: [
    './src/**/*.{ts,tsx,html}',
    '../../plugins/plugin-tasks-core/src/ui/*.tsx',
    '../../packages/plugin-sdk/src/ui.tsx',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#1e1e1e',
        panel: '#242424',
        line: '#323232',
        hover: '#3a3a3a',
        inkSubtle: '#9a9a9a',
        task: '#de4c4a',
        aya: '#8b5cf6',
      },
    },
    corePlugins: { preflight: false },
  },
  plugins: [],
} as Config;
