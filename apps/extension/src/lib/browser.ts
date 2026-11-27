/** Thin promise wrappers over the chrome.* callback APIs the extension uses. */

export interface ActiveTab {
  id?: number;
  url?: string;
  title?: string;
  windowId?: number;
}

export function getActiveTab(): Promise<ActiveTab | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs: ActiveTab[]) => resolve(tabs?.[0] ?? null));
    } catch {
      resolve(null);
    }
  });
}

export function sendToTab<T = any>(tabId: number, message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response: T) => {
        if (chrome.runtime?.lastError) resolve(null);
        else resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export async function sendToActiveTab<T = any>(message: unknown): Promise<T | null> {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  return sendToTab<T>(tab.id, message);
}

export function openSidePanel(): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.windows.getLastFocused({}, (win: any) => {
        try {
          chrome.sidePanel.open({ windowId: win?.id });
        } catch {
          /* older browser */
        }
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

/** PNG data URL of the visible tab area. */
export function captureVisibleTab(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.captureVisibleTab(undefined as any, { format: 'png' }, (dataUrl: string) => {
        if (chrome.runtime?.lastError) resolve(null);
        else resolve(dataUrl ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export function openWebApp(hash = ''): void {
  chrome.tabs.create({ url: `http://127.0.0.1:5173/${hash}` });
}

export async function dataUrlToFile(dataUrl: string, name = 'screenshot.png'): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}
