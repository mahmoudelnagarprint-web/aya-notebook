/** Timezone-safe date helpers. All "days" are local calendar days (YYYY-MM-DD). */

export function toDayString(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

export function addDays(day: string, amount: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + amount);
  return toDayString(date);
}

export function addMonths(day: string, amount: number): string {
  const date = parseDay(day);
  const targetDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(targetDay, daysInMonth));
  return toDayString(date);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

export function isSameDay(a: string, b: string): boolean {
  return a === b;
}

export function startOfWeek(day: string, weekStart: 0 | 6 = 6): string {
  const date = parseDay(day);
  const current = date.getDay();
  const diff = (current - weekStart + 7) % 7;
  return addDays(day, -diff);
}

export function dayName(day: string): string {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][parseDay(day).getDay()]!;
}

export function monthMatrix(anchorDay: string, weekStart: 0 | 6 = 6): string[] {
  const anchor = parseDay(anchorDay);
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(toDayString(first), weekStart);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function formatTimeLabel(time: string | null, format: '12h' | '24h'): string {
  if (!time) return '';
  const [hRaw, m] = time.split(':').map(Number);
  const h = hRaw ?? 0;
  if (format === '24h') return `${`${h}`.padStart(2, '0')}:${`${m ?? 0}`.padStart(2, '0')}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${`${m ?? 0}`.padStart(2, '0')} ${suffix}`;
}

export function minutesToLabel(minutes: number | null, language: 'ar' | 'en'): string {
  if (!minutes) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(language === 'ar' ? `${hours} س` : `${hours}h`);
  if (mins) parts.push(language === 'ar' ? `${mins} د` : `${mins}m`);
  return parts.join(' ');
}

export function nextOccurrence(day: string, rule: { unit: 'day' | 'week' | 'month' | 'year'; interval: number }): string {
  switch (rule.unit) {
    case 'day':
      return addDays(day, rule.interval);
    case 'week':
      return addDays(day, rule.interval * 7);
    case 'month':
      return addMonths(day, rule.interval);
    case 'year':
      return addMonths(day, rule.interval * 12);
  }
}
