/** Hand-off between context-menu actions and the side panel / drawer composer. */

export interface PendingPrompt {
  text: string;
  imageUrl?: string;
  ts: number;
}

const PENDING_KEY = 'aya:pending';

export async function pushPendingPrompt(prompt: Omit<PendingPrompt, 'ts'>): Promise<void> {
  await chrome.storage.local.set({ [PENDING_KEY]: { ...prompt, ts: Date.now() } });
}

export async function takePendingPrompt(): Promise<PendingPrompt | null> {
  const stored = (await chrome.storage.local.get([PENDING_KEY])) as Record<string, any>;
  const value = stored?.[PENDING_KEY];
  if (!value || typeof value.text !== 'string') return null;
  await chrome.storage.local.remove([PENDING_KEY]);
  return value as PendingPrompt;
}

export function watchPendingPrompt(callback: (prompt: PendingPrompt) => void): void {
  chrome.storage.onChanged.addListener(async (changes: Record<string, any>, area: string) => {
    if (area !== 'local' || !changes[PENDING_KEY]?.newValue) return;
    await chrome.storage.local.remove([PENDING_KEY]);
    callback(changes[PENDING_KEY].newValue as PendingPrompt);
  });
}
