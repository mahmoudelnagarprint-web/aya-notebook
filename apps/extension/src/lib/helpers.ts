/**
 * Pure helpers — no chrome APIs here, so they're easy to unit-test.
 */

/** Split selection lines into checklist items (trim, drop blanks, dedupe empty). */
export function splitLinesToChecklist(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const items: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Support bullets/numbers in the title: strip leading "- ", "* ", "• ", "1. ", "1)"
    const cleaned = trimmed.replace(/^[\s•\-*\d]+[\.\)]\s*/i, '').trim();
    if (cleaned) items.push(cleaned);
  }
  // De-duplicate consecutive duplicates while preserving order
  const deduped: string[] = [];
  for (const item of items) {
    if (deduped[deduped.length - 1] !== item) deduped.push(item);
  }
  return deduped;
}

/** Minimal page text extractor stub used by the content script when page context is enabled. */
export function extractPageText(document: Document, trim: number): string {
  // Try the most likely body text sources in priority order.
  const parts: string[] = [];
  const pushIf = (v: unknown) => { if (typeof v === 'string' && v.trim()) parts.push(v); };

  // Prefer the main content element if any.
  const main = document.querySelector('main, article, [role="main"], #content, .content, .main-content, .text-content, .post, .story');
  if (main) {
    // Strip scripts/styles.
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, noscript, svg, nav, footer, header, .ads, .ad-container, .sidebar, .comments, .comments-section, .reaction, .share').forEach((e: Element) => (e as HTMLElement).remove());
    pushIf(clone.textContent?.trim());
  }

  if (parts.length === 0 || parts[0]!.length < 50) {
    // Fallback to body text.
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, noscript, svg, nav, footer, header, .ads, .ad-container, .sidebar').forEach((e: Element) => (e as HTMLElement).remove());
    pushIf(clone.textContent?.trim());
  }

  if (parts.length === 0) return '';
  let text = parts[0]!.trim().replace(/\s+/g, ' ').slice(0, trim);
  // Strip excessive whitespace and repeated separators.
  text = text.replace(/(•|-|\*\*){3,}\s*/g, ' ').replace(/\s{3,}/g, ' ').trim();
  return text || '';
}

/** Build a readable context block for the current tab (title + url + trimmed text). */
export function pageContextBlock(title: string, url: string, text: string, maxChars = 4000): string {
  const head = `[الصفحة: ${title || url}]\n${url}\n\n`;
  const available = Math.max(0, maxChars - head.length);
  const body = text.slice(0, available);
  return (head + body).trim();
}

/** Compute a stable unread badge delta from the server inbox activity. */
export function unreadDelta(serverActivity: { activity?: Array<{ actor?: string }> }, cached: number): number {
  if (!serverActivity?.activity) return 0;
  const recent = serverActivity.activity.filter((entry: { actor?: string }) => entry.actor === 'ai');
  // Simple: treat each recent AI activity item as one unread. In practice you'd
  // compare last-read timestamp stored in chrome.storage. Here we just surface
  // the count for the badge; the popup can refine with a last-read pointer.
  return Math.min(recent.length, 99);
}

/** Generate a stable operation id for the offline queue. */
export function nextOperationId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
