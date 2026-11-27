/**
 * Light/Dark theme for every extension surface.
 * Stored in `chrome.storage.local` so the side panel, popup and the in-page
 * Shadow DOM drawer all switch together.
 */

export type Theme = 'light' | 'dark';

const THEME_KEY = 'aya:theme';

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

export async function loadTheme(): Promise<Theme> {
  try {
    const stored = await chrome.storage.local.get([THEME_KEY]);
    const value = (stored as Record<string, unknown>)[THEME_KEY];
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* storage unavailable */
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export async function saveTheme(theme: Theme): Promise<void> {
  await chrome.storage.local.set({ [THEME_KEY]: theme });
}

export function watchTheme(callback: (theme: Theme) => void): void {
  chrome.storage.onChanged.addListener((changes: Record<string, any>, area: string) => {
    if (area !== 'local') return;
    const value = changes[THEME_KEY]?.newValue;
    if (value === 'light' || value === 'dark') callback(value);
  });
}
