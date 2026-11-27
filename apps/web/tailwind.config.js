const config = {
    content: [
        './index.html',
        './src/**/*.{ts,tsx}',
        '../../packages/plugin-sdk/src/**/*.{ts,tsx}',
        '../../plugins/*/src/**/*.{ts,tsx}',
    ],
    darkMode: ['class'],
    theme: {
        extend: {
            colors: {
                canvas: 'rgb(var(--td-canvas) / <alpha-value>)',
                sidebar: 'rgb(var(--td-sidebar) / <alpha-value>)',
                'sidebar-active': 'rgb(var(--td-sidebar-active) / <alpha-value>)',
                modal: 'rgb(var(--td-modal) / <alpha-value>)',
                'modal-pane': 'rgb(var(--td-modal-pane) / <alpha-value>)',
                ink: {
                    DEFAULT: 'rgb(var(--td-text) / <alpha-value>)',
                    muted: 'rgb(var(--td-text-secondary) / <alpha-value>)',
                    subtle: 'rgb(var(--td-text-subtle) / <alpha-value>)',
                },
                line: {
                    DEFAULT: 'rgb(var(--td-line) / <alpha-value>)',
                    strong: 'rgb(var(--td-line-strong) / <alpha-value>)',
                },
                hover: 'rgb(var(--td-hover) / <alpha-value>)',
                accent: {
                    DEFAULT: 'rgb(var(--td-accent) / <alpha-value>)',
                    hover: 'rgb(var(--td-accent-hover) / <alpha-value>)',
                },
                danger: 'rgb(var(--td-danger) / <alpha-value>)',
            },
            fontFamily: {
                sans: ['"IBM Plex Sans Arabic"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
            },
            borderRadius: {
                badge: '4px',
                btn: '6px',
                chip: '8px',
                dialog: '10px',
                card: '12px',
                menu: '12px',
            },
            boxShadow: {
                'raised-1': 'var(--td-shadow-1)',
                'raised-2': 'var(--td-shadow-2)',
                'raised-3': 'var(--td-shadow-3)',
            },
            transitionTimingFunction: {
                standard: 'cubic-bezier(.4, 0, .2, 1)',
            },
        },
    },
    plugins: [],
};
export default config;
