import type { AyaMemory, AyaSettings } from '@ayatodoist/shared-types';

export interface SystemPromptOptions {
  kernel: any;
  settings?: AyaSettings | null;
  language?: string;
  memories?: AyaMemory[];
  summary?: string;
  workspace?: unknown[];
  toolCount?: number;
  pendingInbox?: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/**
 * Aya's persona + a live snapshot of the workspace. Because projects, labels,
 * counts and the clock are already in the prompt, the model is told explicitly
 * not to spend a turn calling discovery tools.
 */
export function buildAyaSystemPrompt(options: SystemPromptOptions): string {
  const { kernel, settings, language = 'ar', memories = [], summary = '', toolCount = 0, pendingInbox = 0 } = options;

  const projects = (kernel?.store?.list?.('projects') ?? []) as any[];
  const labels = (kernel?.store?.list?.('labels') ?? []) as any[];
  const tasks = ((kernel?.store?.list?.('tasks') ?? []) as any[]).filter((task) => !task.deletedAt);

  const today = todayIso();
  const now = new Date();
  const todayMs = dayNumber(today);
  const open = tasks.filter((task) => !task.isCompleted);
  const overdue = open.filter((task) => {
    const due = dayNumber(task.dueDate);
    return due !== null && todayMs !== null && due < todayMs;
  });
  const dueToday = open.filter((task) => String(task.dueDate ?? '').slice(0, 10) === today);
  const recent = [...tasks]
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, 8);

  const lines: string[] = [];
  if (language === 'en') {
    lines.push('You are Aya, the personal task agent of __AYAtodoist. You are calm, precise and never invent data.');
  } else {
    lines.push('أنتِ آية، الوكيلة الشخصية لتطبيق __AYAtodoist. أسلوبك مصري مهذب، دقيق، ولا تخترعي بيانات.');
  }

  lines.push('');
  lines.push(`الآن (now): ${now.toISOString()} — اليوم ${today}`);
  lines.push(`المهام: ${open.length} مفتوحة، ${overdue.length} متأخرة، ${dueToday.length} مستحقة اليوم.`);
  lines.push(`الأدوات المتاحة: ${toolCount}. صندوق آية: ${pendingInbox} عنصر غير مقروء.`);

  if (projects.length) {
    lines.push('');
    lines.push('المشاريع:');
    for (const project of projects.slice(0, 20)) {
      lines.push(`- ${project.name}${project.isInbox ? ' (Inbox)' : ''} [${project.id}]`);
    }
  }

  if (labels.length) {
    lines.push('');
    lines.push(`التصنيفات: ${labels.slice(0, 20).map((label) => label.name).join('، ')}`);
  }

  if (recent.length) {
    lines.push('');
    lines.push('أحدث المهام:');
    for (const task of recent) {
      const due = task.dueDate ? ` — ${task.dueDate}` : '';
      lines.push(`- ${task.content}${task.isCompleted ? ' ✓' : ''}${due}`);
    }
  }

  if (memories.length) {
    lines.push('');
    lines.push('ما تتذكرينه عن المستخدم:');
    for (const memory of memories.slice(0, 12)) lines.push(`- [${memory.category}] ${memory.content}`);
  }

  if (summary) {
    lines.push('');
    lines.push('ملخص المحادثة السابقة:');
    lines.push(summary);
  }

  if (settings?.personaAr && language !== 'en') {
    lines.push('');
    lines.push(settings.personaAr);
  }
  if (settings?.personaEn && language === 'en') {
    lines.push('');
    lines.push(settings.personaEn);
  }

  lines.push('');
  lines.push(
    'The workspace snapshot above is live. Do NOT call workspace.list, project.list, core.system.overview, or core.system.clock — the answer is already here.',
  );
  lines.push('نفّذي الأدوات مباشرة عند الحاجة، واذكري ما تم تنفيذه بإيجاز.');
  lines.push(
    'بعد تنفيذ أي أداة اقرئي نتيجتها واشرحيها للمستخدم بالتفصيل المفيد (الأسماء والأرقام والحالة). ممنوع تمامًا الرد بـ«تم.» أو أي تأكيد فارغ عندما يسأل المستخدم عن نتيجة أو محتوى.',
  );

  return lines.join('\n');
}

export function personaProject(project: any): string {
  return `- ${project?.name ?? ''} [${project?.id ?? ''}]`;
}

export function personaPersona(settings: Partial<AyaSettings> | null | undefined, language: string): string {
  if (!settings) return '';
  return (language === 'en' ? settings.personaEn : settings.personaAr) ?? '';
}
