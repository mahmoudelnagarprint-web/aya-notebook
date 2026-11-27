import { describe, expect, test } from 'bun:test';
import { parseQuickAdd } from '@ayatodoist/plugin-quick-add-nlp';

const ctx = {
  today: '2026-11-24',
  projects: [
    { id: 'prj_work', name: 'عمل' },
    { id: 'prj_home', name: 'Home' },
  ],
  sections: [{ id: 'sec_design', name: 'تصميم', projectId: 'prj_work' }],
  labels: [
    { id: 'lbl_review', name: 'مراجعة' },
    { id: 'lbl_urgent', name: 'urgent' },
  ],
  weekStart: 6 as const,
};

describe('quick add NLP (Arabic + English)', () => {
  test('parses Arabic date, time, priority, project and label', () => {
    const result = parseQuickAdd('تقرير غدا 10 صباحا p1 #عمل @مراجعة', ctx);
    expect(result.title).toBe('تقرير');
    expect(result.dueDate).toBe('2026-11-25');
    expect(result.dueTime).toBe('10:00');
    expect(result.priority).toBe(1);
    expect(result.projectId).toBe('prj_work');
    expect(result.labelNames).toContain('مراجعة');
  });

  test('last priority wins', () => {
    const result = parseQuickAdd('Ship release p1 p3', ctx);
    expect(result.priority).toBe(3);
  });

  test('resolves project, section and English label', () => {
    const result = parseQuickAdd('Design review tomorrow 14:30 #عمل /تصميم @urgent', ctx);
    expect(result.dueDate).toBe('2026-11-25');
    expect(result.dueTime).toBe('14:30');
    expect(result.projectName).toBe('عمل');
    expect(result.sectionName).toBe('تصميم');
    expect(result.labelNames).toContain('urgent');
  });

  test('recurrence, deadline and duration', () => {
    const result = parseQuickAdd('Pay bills every! month {2026-12-01} for 45m', ctx);
    expect(result.recurrence?.unit).toBe('month');
    expect(result.recurrence?.strict).toBe(true);
    expect(result.deadline).toBe('2026-12-01');
    expect(result.durationMinutes).toBe(45);
  });

  test('ignored tokens stay in the title and lose their semantics', () => {
    const result = parseQuickAdd('Email about p1 tomorrow', ctx, { ignore: ['p1', 'tomorrow'] });
    expect(result.priority).toBeNull();
    expect(result.dueDate).toBeNull();
    expect(result.title).toContain('p1');
    expect(result.title).toContain('tomorrow');
  });

  test('plain text keeps the full title', () => {
    const result = parseQuickAdd('Read the blueprints', ctx);
    expect(result.title).toBe('Read the blueprints');
    expect(result.dueDate).toBeNull();
  });
});
