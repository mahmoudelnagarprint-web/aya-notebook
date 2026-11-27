export const checklistsPlugin = 0;
export const checklistsUi = 0;
export function noteToChecklist(text: string): any[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const items: any[] = [];
  let idCounter = 1;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let text2 = trimmed;
    let checked = false;
    let image: any = null;
    const m = trimmed.match(/^- \[([ x])\]\s+(.*)$/s);
    if (m) { checked = m[1] === 'x'; text2 = m[2].trim(); }
    else { text2 = trimmed.replace(/^[•\-\*]+\s*/i, '').replace(/^[\d\u0660-\u0669]+[.)]\s*/i, '').trim(); }
    const img = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) image = img[2];
    const url = trimmed.match(/https?:\/\/[^\s]+/);
    if (url && !image) image = url[0];
    if (text2) items.push({ id: `chk-${idCounter++}`, text: text2, checked, image });
  }
  return items;
}
export function checklistToNote(items: any[]): string { return items.map((it: any) => `${it.checked ? '- [x]' : '- [ ]'} ${it.text}`).join('\n'); }
export function checklistsInput(input: any): void {}
export function checklistsCtx(ctx: any): void {}
