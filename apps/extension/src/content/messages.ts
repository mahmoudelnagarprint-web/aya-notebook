/**
 * Message bridge from background -> content.
 * Imported and called at the bottom of content/index.tsx.
 */

export function wireContentMessages() {
  chrome.runtime.onMessage.addListener((msg: any, _sender: any, sendResponse: any) => {
    if (msg.type === 'aya-toggle-drawer') {
      import('./index').then((m) => (m as any).toggleDrawer?.()).catch(() => {});
      return true;
    }
    if (msg.type === 'aya-open-drawer-with-text') {
      import('./index').then((m) => (m as any).openDrawerWithText?.(msg.text)).catch(() => {});
      return true;
    }
    if (msg.type === 'aya-toggle-quick-add') {
      import('./index').then((m) => (m as any).toggleQuickAdd?.()).catch(() => {});
      return true;
    }
    if (msg.type === 'aya-attach-image' && msg.file) {
      import('./index').then((m) => (m as any).setPendingImage?.(msg.file)).catch(() => {});
      return true;
    }
  });
}

export function setPendingImage(file: File) {
  // exported for the background -> content message path
}

export function toggleQuickAdd() {
  // exported for the background -> content message path
}
