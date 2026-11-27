import { useSyncExternalStore } from 'react';
import type { AppSettings, Kernel, Route } from '@ayatodoist/core-kernel';
import { parseRoute, routeToHash } from './route';

export type Theme = 'light' | 'dark';
export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface RuntimeState {
  kernel: Kernel | null;
  route: Route;
  theme: Theme;
  language: 'ar' | 'en';
  toasts: Toast[];
  ayaOpen: boolean;
  ayaDraft: string;
  quickAddOpen: boolean;
  quickAddText: string;
  quickAddProjectId: string | null;
  paletteOpen: boolean;
  helpOpen: boolean;
}

const THEME_KEY = 'ayatodoist.theme';
const LANGUAGE_KEY = 'ayatodoist.language';

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') return 'dark';
  } catch {
    /* ignore */
  }
  return 'light';
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

/**
 * One tiny observable store for shell concerns (route, theme, overlays).
 * Keeping it outside React means exported helpers such as `runtimePrefill` can
 * be called from anywhere without a provider.
 */
class RuntimeStore {
  private listeners = new Set<() => void>();
  private state: RuntimeState = {
    kernel: null,
    route: typeof window === 'undefined' ? { kind: 'inbox' } : parseRoute(window.location.hash),
    theme: typeof window === 'undefined' ? 'light' : readTheme(),
    language: 'ar',
    toasts: [],
    ayaOpen: false,
    ayaDraft: '',
    quickAddOpen: false,
    quickAddText: '',
    quickAddProjectId: null,
    paletteOpen: false,
    helpOpen: false,
  };
  private toastId = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RuntimeState => this.state;

  private emit(): void {
    this.state = { ...this.state };
    for (const listener of this.listeners) listener();
  }

  init(kernel: Kernel, settings: AppSettings): void {
    // The product default is the navy + light dashboard; a saved choice always wins.
    const saved = readTheme();
    this.state = {
      ...this.state,
      kernel,
      language: settings.language,
      theme: saved,
    };
    applyTheme(this.state.theme);
    if (typeof window !== 'undefined' && !window.location.hash) {
      window.location.hash = routeToHash({ kind: 'inbox' });
    }
    this.emit();
  }

  syncRoute(): void {
    this.set({ route: parseRoute(window.location.hash) });
  }

  set(patch: Partial<RuntimeState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  navigate(route: Route): void {
    const hash = routeToHash(route);
    if (window.location.hash === hash) {
      this.set({ route: parseRoute(hash) });
      return;
    }
    window.location.hash = hash;
  }

  setTheme(theme: Theme): void {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    this.set({ theme });
    void this.state.kernel?.execute('core.settings.update', { theme } as never).catch(() => undefined);
  }

  setLanguage(language: 'ar' | 'en'): void {
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      /* ignore */
    }
    this.set({ language });
    void this.state.kernel?.execute('core.settings.update', { language } as never).catch(() => undefined);
  }

  toast(message: string, tone: ToastTone = 'info'): void {
    this.toastId += 1;
    const id = this.toastId;
    this.set({ toasts: [...this.state.toasts, { id, message, tone }] });
    window.setTimeout(() => this.set({ toasts: this.state.toasts.filter((toast) => toast.id !== id) }), 3800);
  }

  openAya(draft = ''): void {
    this.set({ ayaOpen: true, ayaDraft: draft });
  }

  closeAya(): void {
    this.set({ ayaOpen: false, ayaDraft: '' });
  }

  openQuickAdd(projectId?: string | null, text = ''): void {
    this.set({ quickAddOpen: true, quickAddProjectId: projectId ?? null, quickAddText: text });
  }
}

export const runtimeStore = new RuntimeStore();

export function useRuntime(): RuntimeState {
  return useSyncExternalStore(runtimeStore.subscribe, runtimeStore.getSnapshot, runtimeStore.getSnapshot);
}

/** Route identity for `<main key>` — forces a clean remount per collection. */
export function runtimeKey(route: Route): string {
  return `${route.kind}:${route.id ?? ''}:${route.query ?? ''}`;
}

export function runtimeValues(settings: AppSettings): { theme: Theme; language: 'ar' | 'en' } {
  return { theme: settings.theme === 'dark' ? 'dark' : 'light', language: settings.language };
}

/** Lets Aya (or the command palette) prefill Quick Add with a sentence. */
export function runtimePrefill(text: string, projectId?: string | null): void {
  runtimeStore.openQuickAdd(projectId ?? null, text);
}

/** Deep-link helper used by toasts and the inbox: #/task/<id> is not a route, so open the view. */
export function runtimeTaskId(route: Route): string | null {
  return route.kind === 'project' || route.kind === 'label' || route.kind === 'filter' ? route.id ?? null : null;
}
