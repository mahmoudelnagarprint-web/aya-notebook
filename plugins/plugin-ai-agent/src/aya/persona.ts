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
  /** Injectable clock, used by the tests to pin the prompt. */
  now?: Date;
}

const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export interface LocalClock {
  /** `YYYY-MM-DD` in the user's local timezone. */
  date: string;
  /** `HH:mm` 24-hour. */
  time24: string;
  /** `h:mm ص/م` 12-hour. */
  time12: string;
  weekdayAr: string;
  weekdayEn: string;
  iso: string;
}

/** The exact local date/time Aya is told about on every single turn. */
export function localClock(now: Date = new Date()): LocalClock {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hours = now.getHours();
  const time24 = `${pad(hours)}:${pad(now.getMinutes())}`;
  const time12 = `${hours % 12 || 12}:${pad(now.getMinutes())} ${hours < 12 ? 'ص' : 'م'}`;
  return {
    date,
    time24,
    time12,
    weekdayAr: AR_WEEKDAYS[now.getDay()]!,
    weekdayEn: EN_WEEKDAYS[now.getDay()]!,
    iso: now.toISOString(),
  };
}

function dayNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function todayIso(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Aya's persona + a live snapshot of the workspace. Because projects, labels,
 * counts and the clock are already in the prompt, the model is told explicitly
 * not to spend a turn calling discovery tools.
 */
export function buildAyaSystemPrompt(options: SystemPromptOptions): string {
  const {
    kernel,
    settings,
    language = 'ar',
    memories = [],
    summary = '',
    toolCount = 0,
    pendingInbox = 0,
    now = new Date(),
  } = options;

  const projects = (kernel?.store?.list?.('projects') ?? []) as any[];
  const labels = (kernel?.store?.list?.('labels') ?? []) as any[];
  const tasks = ((kernel?.store?.list?.('tasks') ?? []) as any[]).filter((task) => !task.deletedAt);

  const arabic = language !== 'en';
  const clock = localClock(now);
  const today = todayIso(now);
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

  /* ------------------------------------------------ live context, first */

  lines.push(arabic ? '## السياق الحيّ (محدَّث مع كل رسالة)' : '## Live context (refreshed on every message)');
  if (arabic) {
    lines.push(`التاريخ الآن: ${clock.date} — ${clock.weekdayAr} (${clock.weekdayEn})`);
    lines.push(`الساعة الآن: ${clock.time24} بنظام 24 ساعة = ${clock.time12} بنظام 12 ساعة — بتوقيت جهاز المستخدم المحلي.`);
  } else {
    lines.push(`Today is: ${clock.date} — ${clock.weekdayEn} (${clock.weekdayAr})`);
    lines.push(`Local time now: ${clock.time24} (24h) = ${clock.time12} (12h).`);
  }
  lines.push(`ISO (now): ${clock.iso} — اليوم ${today}`);

  lines.push('');
  lines.push(arabic ? `المشاريع الحالية (${projects.length}):` : `Current projects (${projects.length}):`);
  if (!projects.length) {
    lines.push(arabic ? '- (لا يوجد مشروع غير الـ Inbox)' : '- (no project besides Inbox)');
  }
  for (const project of projects) {
    const flags = [project.isInbox ? 'Inbox' : '', project.isArchived ? 'archived' : ''].filter(Boolean).join(', ');
    const name = arabic && project.nameAr ? `${project.nameAr} / ${project.name}` : (project.name ?? '');
    lines.push(`- ${name}${flags ? ` (${flags})` : ''} [${project.id}]`);
  }

  lines.push('');
  lines.push(arabic ? `التصنيفات الحالية (${labels.length}):` : `Current labels (${labels.length}):`);
  if (!labels.length) lines.push(arabic ? '- (لا يوجد تصنيفات)' : '- (no labels)');
  for (const label of labels.slice(0, 60)) {
    lines.push(`- ${label.name} [${label.id}]`);
  }

  /* ------------------------------------------------------------- identity */

  lines.push('');
  lines.push(
    arabic
      ? 'أنتِ آية، الوكيلة الشخصية لتطبيق __AYAtodoist. أسلوبك مصري مهذب، دقيق، ولا تخترعي بيانات.'
      : 'You are Aya, the personal task agent of __AYAtodoist. You are calm, precise and never invent data.',
  );

  lines.push('');
  lines.push(
    arabic
      ? `المهام: ${open.length} مفتوحة، ${overdue.length} متأخرة، ${dueToday.length} مستحقة اليوم. الأدوات المتاحة: ${toolCount}. صندوق آية: ${pendingInbox} عنصر غير مقروء.`
      : `Tasks: ${open.length} open, ${overdue.length} overdue, ${dueToday.length} due today. Tools: ${toolCount}. Aya inbox: ${pendingInbox} unread.`,
  );

  if (recent.length) {
    lines.push('');
    lines.push(arabic ? 'أحدث المهام:' : 'Recent tasks:');
    for (const task of recent) {
      const due = task.dueDate ? ` — ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ''}` : '';
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

  if (settings?.personaAr && arabic) {
    lines.push('');
    lines.push(settings.personaAr);
  }
  if (settings?.personaEn && !arabic) {
    lines.push('');
    lines.push(settings.personaEn);
  }

  /* ------------------------------------------------------ behaviour rules */

  lines.push('');
  lines.push('## قواعد إضافة المهام والتذكيرات (إلزامية)');
  lines.push(
    [
      '1) حساب الوقت بدقة: حوّلي أي وقت نسبي («كمان ساعة»، «بعد نص ساعة»، «بكرة الصبح»، «النهاردة بالليل») إلى dueDate (YYYY-MM-DD) و dueTime (HH:mm) محسوبين من التاريخ والساعة المذكورين فوق. ممنوع تمامًا تمرير نص نسبي زي "in 1 hour" أو "tomorrow" في dueDate/dueTime.',
      '2) الأولوية: p1 للمهام الحرجة جدًا، p2 للتذكيرات المرتبطة بالوقت والأجهزة والمواعيد القريبة (مثال: «فكريني أقفل التكييف كمان ساعة» = p2)، p3 هو الافتراضي، p4 للأفكار البعيدة/غير المهمة.',
      '3) اختيار المشروع: راجعي قائمة المشاريع فوق قبل الإنشاء. لو فيه مشروع مناسب (المنزل/البيت/شخصي/الشغل/العمل...) مرّري projectId بتاعه الحقيقي واذكري في ردّك إنك حطيتي المهمة فيه.',
      '4) لو مفيش مشروع مناسب (مثلاً Inbox فقط) أو المهمة تنفع لأكتر من مشروع: أنشئيها فورًا في مشروع الـ Inbox عشان التذكير ما يضيعش، وبعدها اقترحي بلطف بالمصري: «حطيتها في Inbox — تحبي أعمل مشروع اسمه "المنزل" وأنقلها له؟» واعرضي خيارات سريعة (إنشاء مشروع / سيبها في Inbox).',
      '5) أداة الإنشاء هي task.create، وباراميتراتها: content (عنوان المهمة)، description (تفاصيل)، projectId (معرّف مشروع موجود)، dueDate (YYYY-MM-DD)، dueTime (HH:mm بنظام 24 ساعة)، priority (رقم من 1 إلى 4 يعادل p1..p4)، labelNames (أسماء تصنيفات موجودة أو جديدة).',
      '6) تأكدي بعد الإنشاء من قراءة نتيجة الأداة: اذكري اسم المهمة والمشروع والوقت الفعلي اللي اتسجل.',
    ].join('\n'),
  );

  lines.push('');
  lines.push('## شكل الرد');
  lines.push(
    [
      '- اكتبي عربي مصري طبيعي في جمل قصيرة وواضحة، بدون حشو.',
      '- ممنوع تمامًا كتابة JSON خام أو {"tool": "..."} أو أي بلوك كود يمثل نداء أداة داخل نص الرد. الأدوات بتتنفذ من خلال واجهة الأدوات فقط، ونص الرد لازم يكون كلام للمستخدم.',
      '- ممنوع الرد بـ«تم.» أو أي تأكيد فارغ عندما يسأل المستخدم عن نتيجة أو محتوى أو يطلب أكثر من خطوة.',
    ].join('\n'),
  );

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
