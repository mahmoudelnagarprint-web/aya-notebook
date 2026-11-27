import type { Kernel } from '@ayatodoist/core-kernel';

export interface AyaInboxCard {
  id: string;
  title: string;
  body: string;
  kind: 'reminder' | 'procrastination';
  actions: Array<{ name: string; input: Record<string, unknown>; label: string }>;
}

const WELCOME_ID = 'aya_welcome';

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The 24/7 radar: turns overdue and repeatedly-postponed tasks into inbox
 * cards. Cards are persisted, so a later scan never duplicates one the user has
 * already seen, and the welcome card always exists on a fresh install.
 */
export class AyaProactiveEngine {
  constructor(private readonly store: any) {}

  private seenTitles(): Set<string> {
    const rows = (this.store.listInbox?.() ?? []) as any[];
    return new Set(rows.map((row) => String(row.title ?? '')));
  }

  async scan(kernel: Kernel, now: Date = new Date()): Promise<AyaInboxCard[]> {
    const today = day(now);
    const cards: AyaInboxCard[] = [];
    const seen = this.seenTitles();

    for (const task of kernel.store.list('tasks') as any[]) {
      if (task.isCompleted || task.deletedAt || !task.dueDate) continue;
      if (String(task.dueDate) >= today) continue;

      const daysLate = Math.max(0, Math.round((now.getTime() - Date.parse(`${String(task.dueDate).slice(0, 10)}T00:00:00Z`)) / 86_400_000));
      const postponed = Number(task.postponedCount ?? 0);
      const procrastinated = postponed >= 3 || daysLate >= 14;
      const title = procrastinated ? `⏰ ${task.content}` : `🔔 ${task.content}`;
      if (seen.has(title)) continue;

      const card: AyaInboxCard = {
        id: procrastinated ? `card-procrastinate-${task.id}` : `card-reminder-${task.id}`,
        title,
        body: procrastinated
          ? `المهمة متأخرة ${daysLate} يوم وتم تأجيلها ${postponed} مرات. تحبي نبدأ فيها النهارده؟`
          : `المهمة مستحقة منذ ${daysLate} يوم.`,
        kind: procrastinated ? 'procrastination' : 'reminder',
        actions: [
          { name: 'task.update', input: { id: task.id, dueDate: today }, label: 'حدّديها النهارده' },
        ],
      };
      seen.add(title);
      cards.push(card);
    }

    for (const card of cards) {
      this.store.saveInboxItem({
        id: card.id,
        kind: card.kind,
        title: card.title,
        body: card.body,
        status: 'unread',
        actions: card.actions.map((action) => ({ name: action.name, input: action.input })),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }

    const inbox = (this.store.listInbox?.() ?? []) as any[];
    if (!inbox.some((row) => row.id === WELCOME_ID)) {
      this.store.saveInboxItem({
        id: WELCOME_ID,
        kind: 'tip',
        title: 'أهلاً بيك في آية 🤍',
        body: 'أنا آية، هرتّب مهامك وأفكّرك بالمتأخر وأساعدك تنفّذي كل حاجة من الشات.',
        status: 'unread',
        actions: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }

    return cards;
  }
}

/** Executes a card's actions as one undoable batch. */
export async function executeInboxActions(
  kernel: Kernel,
  card: AyaInboxCard,
  batchId: string,
): Promise<{ executed: Array<{ name: string; ok: boolean; error?: string }> }> {
  const executed: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const action of card.actions) {
    try {
      await kernel.execute(action.name, action.input, { batchId, actor: 'ai', skipPermission: true });
      executed.push({ name: action.name, ok: true });
    } catch (error) {
      executed.push({ name: action.name, ok: false, error: (error as Error).message });
    }
  }

  return { executed };
}

export function proactiveTask(task: any): AyaInboxCard | null {
  if (!task?.dueDate) return null;
  return {
    id: `card-reminder-${task.id}`,
    title: `🔔 ${task.content}`,
    body: `المهمة مستحقة ${task.dueDate}.`,
    kind: 'reminder',
    actions: [{ name: 'task.update', input: { id: task.id, dueDate: task.dueDate }, label: 'تأكيد' }],
  };
}
