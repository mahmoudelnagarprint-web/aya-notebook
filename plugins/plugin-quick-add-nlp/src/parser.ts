import type { Recurrence } from '@ayatodoist/shared-types';
import { addDays, addMonths, parseDay, toDayString } from '@ayatodoist/shared-types';

/**
 * Zero-network, Arabic + English natural-language parser for Quick Add.
 * Runs entirely on the client; no text ever leaves the device.
 */

export type NlpType = 'date' | 'time' | 'priority' | 'project' | 'section' | 'label' | 'deadline' | 'reminder' | 'duration' | 'recurrence';

export interface NlpSpan {
  start: number;
  end: number;
  text: string;
  type: NlpType;
  value: string;
  /** Priorities: only the last pN wins and is highlighted. */
  active?: boolean;
}

export interface NlpReminder {
  /** "30m" style offset from the due date. */
  offsetMinutes?: number;
  /** Absolute timestamp when a natural date was given. */
  at?: string;
  text: string;
}

export interface ParsedTask {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: number | null;
  projectId: string | null;
  projectName: string | null;
  sectionId: string | null;
  sectionName: string | null;
  labelNames: string[];
  labelIds: string[];
  deadline: string | null;
  durationMinutes: number | null;
  reminders: NlpReminder[];
  recurrence: Recurrence | null;
  spans: NlpSpan[];
}

export interface NlpContext {
  today: string;
  projects: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string; projectId: string }>;
  labels: Array<{ id: string; name: string }>;
  weekStart?: 0 | 6;
}

interface Candidate {
  start: number;
  end: number;
  weight: number;
  apply: () => void;
}

interface DateResult {
  date: string | null;
  time?: string | null;
  relativeDays?: number;
}

const WEEKDAYS_EN: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const WEEKDAYS_AR: Record<string, number> = {
  'الأحد': 0, 'الاحد': 0, 'الاثنين': 1, 'الإثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6,
};
const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

function pad(value: number): string {
  return `${value}`.padStart(2, '0');
}

function dayString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function resolveWeekday(target: number, today: string): string {
  const current = parseDay(today).getDay();
  const offset = (target - current + 7) % 7;
  return addDays(today, offset);
}

/* --------------------------------------------------------------- time */

interface TimeMatch {
  time: string;
  length: number;
}

function parseTimeAt(text: string): TimeMatch | null {
  const lower = text.toLowerCase();
  const english = lower.match(/^(?:\s*at\s+|\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (english) {
    let hour = Number(english[1]);
    const minute = english[2] ? Number(english[2]) : 0;
    if (english[3] === 'pm' && hour < 12) hour += 12;
    if (english[3] === 'am' && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) return { time: `${pad(hour)}:${pad(minute)}`, length: english[0].length };
  }
  const english24 = lower.match(/^\s*at\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (english24) {
    const hour = Number(english24[1]);
    const minute = english24[2] ? Number(english24[2]) : 0;
    if (hour <= 23 && minute <= 59) return { time: `${pad(hour)}:${pad(minute)}`, length: english24[0].length };
  }
  const explicit24 = lower.match(/^\s*(\d{1,2}):(\d{2})\b/);
  if (explicit24) {
    const hour = Number(explicit24[1]);
    const minute = Number(explicit24[2]);
    if (hour <= 23 && minute <= 59) return { time: `${pad(hour)}:${pad(minute)}`, length: explicit24[0].length };
  }
  const arabic = text.match(/^\s*(?:الساعة\s*)?(\d{1,2})(?::(\d{2}))?\s*(صباحا|صباحاً|صباح|مساء|مساءً|ظهرا|ظهراً|ليلا|ليلاً)?/);
  if (arabic && (arabic[3] || /الساعة/.test(arabic[0]))) {
    let hour = Number(arabic[1]);
    const minute = arabic[2] ? Number(arabic[2]) : 0;
    const suffix = arabic[3] ?? '';
    if (/مساء|ظهرا|ليلا/.test(suffix) && hour < 12) hour += 12;
    if (/صباح/.test(suffix) && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) return { time: `${pad(hour)}:${pad(minute)}`, length: arabic[0].length };
  }
  return null;
}

/* --------------------------------------------------------------- date */

export function parseDatePhrase(phrase: string, ctx: NlpContext): DateResult | null {
  const text = phrase.trim().toLowerCase();
  if (!text) return null;
  const today = ctx.today;

  const relative = text.match(/^(?:in\s+|بعد\s+)(\d+)\s*(day|days|week|weeks|month|months|year|years|يوم|أيام|ايام|يومين|أسبوع|اسبوع|أسابيع|شهر|أشهر|شهور|سنة|سنوات)$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!;
    if (/day|يوم|أيام|ايام/.test(unit)) return { date: addDays(today, amount), relativeDays: amount };
    if (/week|أسبوع|اسبوع|أسابيع/.test(unit)) return { date: addDays(today, amount * 7), relativeDays: amount * 7 };
    if (/month|شهر|أشهر|شهور/.test(unit)) return { date: addMonths(today, amount) };
    return { date: addMonths(today, amount * 12) };
  }

  const simple: Array<[RegExp, () => string]> = [
    [/^(today|اليوم)$/, () => today],
    [/^(tomorrow|غدا|غداً|بكرة)$/, () => addDays(today, 1)],
    [/^(tonight|الليلة)$/, () => today],
    [/^(yesterday|أمس|امس)$/, () => addDays(today, -1)],
    [/^(day after tomorrow|بعد غد|بعد غداً)$/, () => addDays(today, 2)],
    [/^(day after tomorrow|بعد غد)$/, () => addDays(today, 2)],
    [/^(this week|هذا الأسبوع|هذا الاسبوع)$/, () => today],
    [/^(next week|الأسبوع القادم|الاسبوع القادم|الأسبوع المقبل)$/, () => addDays(today, 7)],
    [/^(next month|الشهر القادم|الشهر المقبل)$/, () => addMonths(today, 1)],
    [/^(this weekend|نهاية الأسبوع|نهاية الاسبوع)$/, () => resolveWeekday(6, today)],
    [/^(next weekend|نهاية الأسبوع القادم|نهاية الاسبوع القادم)$/, () => addDays(resolveWeekday(6, today), 7)],
  ];
  for (const [pattern, resolve] of simple) {
    if (pattern.test(text)) {
      const date = resolve();
      return { date, time: text.includes('tonight') || text.includes('الليلة') ? '21:00' : null };
    }
  }

  if (/^(next week|الأسبوع القادم)$/.test(text)) return { date: addDays(today, 7) };

  // Weekdays with optional "next"/"on"/"this" (English) or "القادم" (Arabic)
  const nextWeekday = text.match(/^(next|on|this)\s+([a-z]+)$/);
  if (nextWeekday && WEEKDAYS_EN[nextWeekday[2]!] !== undefined) {
    const base = resolveWeekday(WEEKDAYS_EN[nextWeekday[2]!]!, today);
    return { date: nextWeekday[1] === 'next' ? addDays(base, 7) : base };
  }
  if (WEEKDAYS_EN[text] !== undefined) return { date: resolveWeekday(WEEKDAYS_EN[text]!, today) };
  const arabicDay = text.replace(/^(يوم|ال|في)\s*/, '');
  if (WEEKDAYS_AR[text] !== undefined) return { date: resolveWeekday(WEEKDAYS_AR[text]!, today) };
  if (WEEKDAYS_AR[arabicDay] !== undefined) return { date: resolveWeekday(WEEKDAYS_AR[arabicDay]!, today) };

  // ISO date
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return Number.isNaN(parseDay(date).getTime()) ? null : { date };
  }

  // 24/11 or 24/11/2027 or 24-11
  const numeric = text.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (numeric) {
    const dayNum = Number(numeric[1]);
    const monthNum = Number(numeric[2]) - 1;
    let year = numeric[3] ? Number(numeric[3]) : parseDay(today).getFullYear();
    if (year < 100) year += 2000;
    const candidate = new Date(year, monthNum, dayNum);
    if (Number.isNaN(candidate.getTime())) return null;
    let result = dayString(candidate);
    if (!numeric[3] && result < today) result = dayString(new Date(year + 1, monthNum, dayNum));
    return { date: result };
  }

  // 24 nov / nov 24 / 24 november 2027
  const dayMonth = text.match(/^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?$/);
  if (dayMonth && MONTHS[dayMonth[2]!] !== undefined) {
    const candidate = new Date(Number(dayMonth[3] ?? parseDay(today).getFullYear()), MONTHS[dayMonth[2]!]!, Number(dayMonth[1]));
    return { date: dayString(candidate) };
  }
  const monthDay = text.match(/^([a-z]{3,9})\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (monthDay && MONTHS[monthDay[1]!] !== undefined) {
    const candidate = new Date(Number(monthDay[3] ?? parseDay(today).getFullYear()), MONTHS[monthDay[1]!]!, Number(monthDay[2]));
    return { date: dayString(candidate) };
  }
  return null;
}

interface DateScanMatch {
  start: number;
  end: number;
  result: DateResult;
  text: string;
}

const DATE_PATTERN = new RegExp(
  [
    '\\b(?:in\\s+\\d+\\s+(?:days?|weeks?|months?|years?))\\b',
    '\\b(?:today|tomorrow|tonight|yesterday|day after tomorrow)\\b',
    '\\b(?:next|this)\\s+(?:week|month|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\\b',
    '\\b(?:on\\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\\b',
    '\\b\\d{4}-\\d{2}-\\d{2}\\b',
    '\\b\\d{1,2}[\\/.\\-]\\d{1,2}(?:[\\/.\\-]\\d{2,4})?\\b',
    '\\b\\d{1,2}\\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\\b(?:\\s+\\d{4})?',
    '\\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\\s+\\d{1,2}(?:\\s+\\d{4})?\\b',
    '(?:اليوم|غدا|غداً|بكرة|بعد غد|الليلة|أمس)',
    '(?:الأسبوع القادم|الاسبوع القادم|الأسبوع المقبل|الشهر القادم|الشهر المقبل|نهاية الأسبوع|نهاية الاسبوع|هذا الأسبوع)',
    'بعد\\s+\\d+\\s+(?:يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|شهر|أشهر|شهور|سنة|سنوات)',
    '(?:يوم\\s+)?(?:الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)',
  ].join('|'),
  'giu',
);

/* --------------------------------------------------------- recurrence */

export function parseRecurrencePhrase(phrase: string): Recurrence {
  const text = phrase.trim();
  const lower = text.toLowerCase();
  const strict = /every!|كل!/.test(lower);
  const weekdays: number[] = [];

  for (const [name, value] of Object.entries(WEEKDAYS_EN)) {
    if (name.length > 3 && new RegExp(`\\b${name}\\b`).test(lower) && !weekdays.includes(value)) weekdays.push(value);
  }
  for (const [name, value] of Object.entries(WEEKDAYS_AR)) {
    if (lower.includes(name) && !weekdays.includes(value)) weekdays.push(value);
  }

  const countMatch = lower.match(/(\d+)/);
  const interval = countMatch ? Math.max(1, Number(countMatch[1])) : 1;

  let unit: Recurrence['unit'] = weekdays.length ? 'week' : 'day';
  if (/\b(day|days|daily)\b|يوم/.test(lower)) unit = 'day';
  if (/\b(week|weeks|weekly)\b|أسبوع|اسبوع/.test(lower)) unit = 'week';
  if (/\b(month|months|monthly)\b|شهر/.test(lower)) unit = 'month';
  if (/\b(year|years|yearly|annually)\b|سنة|سنو/.test(lower)) unit = 'year';
  if (/every\s+last/.test(lower)) unit = 'month';

  return { text, unit, interval, weekdays, strict };
}

/* -------------------------------------------------------------- parser */

function findByName<T extends { name: string }>(items: T[], needle: string): T | undefined {
  const target = needle.trim().toLowerCase();
  return (
    items.find((item) => item.name.toLowerCase() === target) ??
    items.find((item) => item.name.toLowerCase().startsWith(target)) ??
    items.find((item) => item.name.toLowerCase().includes(target) || target.includes(item.name.toLowerCase()))
  );
}

export function parseQuickAdd(input: string, ctx: NlpContext, options: { ignore?: string[] } = {}): ParsedTask {
  const text = input;
  const masked = text.split('');

  // Escaped pills keep their text but lose all semantics.
  for (const token of options.ignore ?? []) {
    if (!token) continue;
    const start = text.indexOf(token);
    if (start === -1) continue;
    for (let index = start; index < start + token.length; index += 1) masked[index] = ' ';
  }
  const scanText = masked.join("");
  const spans: NlpSpan[] = [];
  const candidates: Candidate[] = [];

  const result: ParsedTask = {
    title: '',
    dueDate: null,
    dueTime: null,
    priority: null,
    projectId: null,
    projectName: null,
    sectionId: null,
    sectionName: null,
    labelNames: [],
    labelIds: [],
    deadline: null,
    durationMinutes: null,
    reminders: [],
    recurrence: null,
    spans,
  };

  let projectResolved: { id: string; name: string } | null = null;

  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) masked[index] = ' ';
  };

  // deadlines {…}
  for (const match of scanText.matchAll(/\{([^}]+)\}/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const inner = match[1]!.trim();
    candidates.push({
      start,
      end,
      weight: 90,
      apply: () => {
        const parsed = parseDatePhrase(inner, ctx);
        if (!parsed?.date) return;
        result.deadline = parsed.date;
        spans.push({ start, end, text: match[0], type: 'deadline', value: parsed.date });
        mask(start, end);
      },
    });
  }

  // priorities
  for (const match of scanText.matchAll(/(?:^|\s)(p[1-4])(?=\s|$)/gi)) {
    const raw = match[1]!;
    const start = (match.index ?? 0) + match[0].indexOf(raw);
    const end = start + raw.length;
    candidates.push({
      start,
      end,
      weight: 40,
      apply: () => {
        const priority = Number(raw.slice(1));
        result.priority = priority;
        spans.push({ start, end, text: raw, type: 'priority', value: String(priority), active: false });
        mask(start, end);
      },
    });
  }

  // projects #project
  for (const match of scanText.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu)) {
    const name = match[1]!;
    const start = (match.index ?? 0) + match[0].indexOf('#');
    const end = start + name.length + 1;
    candidates.push({
      start,
      end,
      weight: 60,
      apply: () => {
        const project = findByName(ctx.projects, name);
        if (!project) return;
        projectResolved = project;
        result.projectId = project.id;
        result.projectName = project.name;
        spans.push({ start, end, text: match[0].trim(), type: 'project', value: project.name });
        mask(start, end);
      },
    });
  }

  // sections /section
  for (const match of scanText.matchAll(/(?:^|\s)\/([\p{L}\p{N}_\-]+)/gu)) {
    const name = match[1]!;
    const start = (match.index ?? 0) + match[0].indexOf('/');
    const end = start + name.length + 1;
    candidates.push({
      start,
      end,
      weight: 60,
      apply: () => {
        const pool = projectResolved ? ctx.sections.filter((section) => section.projectId === projectResolved!.id) : ctx.sections;
        const section = findByName(pool, name);
        if (!section) return;
        result.sectionId = section.id;
        result.sectionName = section.name;
        spans.push({ start, end, text: match[0].trim(), type: 'section', value: section.name });
        mask(start, end);
      },
    });
  }

  // labels @label / %label
  for (const match of scanText.matchAll(/(?:^|\s)[@%]([\p{L}\p{N}_\-]+)/gu)) {
    const name = match[1]!;
    const start = (match.index ?? 0) + match[0].indexOf(match[0].trim()[0]!);
    const end = start + name.length + 1;
    candidates.push({
      start,
      end,
      weight: 60,
      apply: () => {
        const label = findByName(ctx.labels, name);
        if (label && !result.labelIds.includes(label.id)) result.labelIds.push(label.id);
        if (!result.labelNames.includes(name)) result.labelNames.push(name);
        spans.push({ start, end, text: match[0].trim(), type: 'label', value: label?.name ?? name });
        mask(start, end);
      },
    });
  }

  // durations: for 1h / for 30m / لمدة ساعة
  for (const match of scanText.matchAll(/\bfor\s+(\d+(?:[.,]\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/gi)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      start,
      end,
      weight: 80,
      apply: () => {
        const amount = Number(match[1]!.replace(',', '.'));
        const unit = match[2]!.toLowerCase();
        result.durationMinutes = Math.round(/^h|hour/.test(unit) ? amount * 60 : amount);
        spans.push({ start, end, text: match[0], type: 'duration', value: String(result.durationMinutes) });
        mask(start, end);
      },
    });
  }
  for (const match of scanText.matchAll(/لمدة\s+(\d+)?\s*(دقيقة|دقائق|ساعة|ساعات)/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      start,
      end,
      weight: 80,
      apply: () => {
        const amount = match[1] ? Number(match[1]) : 1;
        result.durationMinutes = /ساعة|ساعات/.test(match[2]!) ? amount * 60 : amount;
        spans.push({ start, end, text: match[0], type: 'duration', value: String(result.durationMinutes) });
        mask(start, end);
      },
    });
  }

  // recurrence: every … / كل …
  for (const match of scanText.matchAll(/\b(every!?\s+(?:last\s+)?(?:\d+\s+)?(?:day|days|week|weeks|month|months|year|years|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|daily|weekly|monthly|yearly)(?:\s+(?:on|at)\s+[a-z]+)?)\b/gi)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      start,
      end,
      weight: 95,
      apply: () => {
        result.recurrence = parseRecurrencePhrase(match[0]);
        spans.push({ start, end, text: match[0], type: 'recurrence', value: match[0] });
        mask(start, end);
      },
    });
  }
  for (const match of scanText.matchAll(/كل!?\s+(?:\d+\s+)?(?:يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|شهر|أشهر|شهور|سنة|سنوات|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت)(?:\s+[\p{L}]+)?/gu)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    candidates.push({
      start,
      end,
      weight: 95,
      apply: () => {
        result.recurrence = parseRecurrencePhrase(match[0]);
        spans.push({ start, end, text: match[0], type: 'recurrence', value: match[0] });
        mask(start, end);
      },
    });
  }

  // reminders !30m / !1h / !tomorrow
  for (const match of scanText.matchAll(/(?:^|\s)!([\p{L}\p{N}:]+(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)/giu)) {
    const start = (match.index ?? 0) + match[0].indexOf('!');
    const end = start + match[1]!.length + 1;
    candidates.push({
      start,
      end,
      weight: 85,
      apply: () => {
        const raw = text.slice(start + 1, end).trim();
        const offset = raw.match(/^(\d+)\s*(m|min|mins|minutes|h|hr|hours|d|days)$/i);
        if (offset) {
          const amount = Number(offset[1]);
          const unit = offset[2]!.toLowerCase();
          const minutes = /^d/.test(unit) ? amount * 1440 : /^h/.test(unit) ? amount * 60 : amount;
          result.reminders.push({ offsetMinutes: minutes, text: raw });
          spans.push({ start, end, text: `!${raw}`, type: 'reminder', value: raw });
          mask(start, end);
          return;
        }
        const parsed = parseDatePhrase(raw, ctx);
        if (parsed?.date) {
          const time = parsed.time ?? '09:00';
          result.reminders.push({ at: `${parsed.date}T${time}:00`, text: raw });
          spans.push({ start, end, text: `!${raw}`, type: 'reminder', value: raw });
          mask(start, end);
        }
      },
    });
  }

  // standalone wall-clock times: "14:30", "at 5pm", "10 صباحا"
  const timePatterns: RegExp[] = [
    /(?:^|\s)((?:at\s+|الساعة\s*)?\d{1,2}:\d{2}(?:\s*(?:am|pm))?)(?=\s|$)/gi,
    /(?:^|\s)((?:at\s+)?\d{1,2}\s*(?:am|pm))(?=\s|$)/gi,
    /(?:^|\s)((?:الساعة\s*)?\d{1,2}(?::\d{2})?\s*(?:صباحا|صباحاً|صباح|مساء|مساءً|ظهرا|ظهراً|ليلاً|ليلا))(?=\s|$)/gu,
  ];
  const seenTimeStarts = new Set<number>();
  for (const pattern of timePatterns) {
    for (const match of scanText.matchAll(pattern)) {
      const raw = match[1]!.trim();
      const start = (match.index ?? 0) + match[0].indexOf(match[1]!);
      if (seenTimeStarts.has(start)) continue;
      seenTimeStarts.add(start);
      const end = start + raw.length;
      candidates.push({
        start,
        end,
        weight: 70,
        apply: () => {
          const time = parseTimeOnly(raw);
          if (!time) return;
          if (result.dueTime === null) result.dueTime = time;
          spans.push({ start, end, text: raw, type: 'time', value: time });
          mask(start, end);
        },
      });
    }
  }

  // resolve ordered candidates, earliest first, higher weight wins overlaps
  candidates.sort((a, b) => a.start - b.start || b.weight - a.weight || b.end - a.end);
  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    if (accepted.some((other) => candidate.start < other.end && candidate.end > other.start)) continue;
    accepted.push(candidate);
  }
  for (const candidate of accepted) candidate.apply();

  // dates on the masked text
  const maskedText = masked.join('');
  const dateMatches: DateScanMatch[] = [];
  DATE_PATTERN.lastIndex = 0;
  for (const match of maskedText.matchAll(DATE_PATTERN)) {
    if (!match[0].trim()) continue;
    const parsed = parseDatePhrase(match[0], ctx);
    if (!parsed?.date) continue;
    dateMatches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, result: parsed, text: match[0] });
  }

  const chosenDates: DateScanMatch[] = [];
  for (const match of dateMatches) {
    if (chosenDates.some((other) => match.start < other.end && match.end > other.start)) continue;
    if (spans.some((span) => match.start < span.end && match.end > span.start)) continue;
    chosenDates.push(match);
  }

  for (const match of chosenDates) {
    let end = match.end;
    let time = match.result.time ?? null;
    const timeMatch = parseTimeAt(maskedText.slice(end));
    if (timeMatch && /^\s*(at|الساعة)/i.test(maskedText.slice(end, end + 8))) {
      const timeSpanEnd = end + timeMatch.length;
      const bridge = maskedText.slice(end, timeSpanEnd);
      if (!chosenDates.some((other) => other !== match && other.start < timeSpanEnd && other.end > end)) {
        time = timeMatch.time;
        end = timeSpanEnd;
        if (!bridge.trim()) end = timeSpanEnd;
      }
    }
    if (result.dueDate === null && match.result.date) {
      result.dueDate = match.result.date;
      if (time !== null) result.dueTime = time;
      spans.push({ start: match.start, end, text: text.slice(match.start, end), type: 'date', value: `${match.result.date}${time ? ` ${time}` : ''}` });
      mask(match.start, end);
    }
  }

  // Only the last priority wins visually (and semantically)
  const prioritySpans = spans.filter((span) => span.type === 'priority').sort((a, b) => a.start - b.start);
  prioritySpans.forEach((span, index) => {
    span.active = index === prioritySpans.length - 1;
  });
  if (prioritySpans.length > 0) result.priority = Number(prioritySpans.at(-1)!.value);

  // Build the title by removing every accepted span.
  const removeRanges = [...spans.map((span) => [span.start, span.end] as const)].sort((a, b) => a[0] - b[0]);
  let title = '';
  let cursor = 0;
  for (const [start, end] of removeRanges) {
    if (start < cursor) continue;
    title += text.slice(cursor, start);
    cursor = end;
  }
  title += text.slice(cursor);
  result.title = title.replace(/\s{2,}/g, ' ').trim();
  spans.sort((a, b) => a.start - b.start);
  return result;
}

export function emptyContext(today: string): NlpContext {
  return { today, projects: [], sections: [], labels: [] };
}

/** Time-only phrases such as "at 5pm" default to today. */
export function parseTimeOnly(phrase: string): string | null {
  const match =
    phrase.trim().match(/^(?:at\s+|الساعة\s*)?(\d{1,2}):(\d{2})\s*(am|pm)?$/i) ??
    phrase.trim().match(/^(?:at\s+)?(\d{1,2})\s*(am|pm)$/i) ??
    phrase.trim().match(/^(?:الساعة\s*)?(\d{1,2})(?::(\d{2}))?\s*(صباحا|صباحاً|صباح|مساء|مساءً|ظهرا|ظهراً|ليلاً|ليلا)$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = (match[3] ?? '').toLowerCase();
  if ((suffix === 'pm' || /مساء/.test(suffix)) && hour < 12) hour += 12;
  if ((suffix === 'am' || /صباح/.test(suffix)) && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`;
}
