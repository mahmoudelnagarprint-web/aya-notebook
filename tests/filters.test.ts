import { describe, expect, test } from 'bun:test';
import { TaskSchema, ProjectSchema, LabelSchema, type Task } from '@ayatodoist/shared-types';
import { evaluateFilter, parseFilter, STARTER_FILTERS } from '@ayatodoist/plugin-filters-labels';

const projects = [
  ProjectSchema.parse({ id: 'p_work', name: 'Work', orderKey: 'a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
  ProjectSchema.parse({ id: 'p_home', name: 'Home', orderKey: 'b', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
];
const labels = [LabelSchema.parse({ id: 'l_urgent', name: 'urgent', color: '#dc4c3e', orderKey: 'a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })];

function task(overrides: Partial<Task>): Task {
  return TaskSchema.parse({
    id: `t_${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'p_work',
    content: 'Task',
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

const tasks = [
  task({ id: 't1', content: 'Ship release', priority: 1, dueDate: '2026-11-24', labels: ['l_urgent'] }),
  task({ id: 't2', content: 'Water plants', projectId: 'p_home', priority: 4, dueDate: '2026-11-26' }),
  task({ id: 't3', content: 'Overdue invoice', priority: 2, dueDate: '2026-11-20' }),
];

const ctx = { today: '2026-11-24', projects, sections: [], labels };

function run(query: string): string[] {
  const parsed = parseFilter(query, ctx.today);
  expect(parsed.error).toBeNull();
  return evaluateFilter(parsed.ast!, tasks, ctx).map((entry) => entry.id);
}

describe('filter query engine', () => {
  test('priority atom', () => {
    expect(run('p1')).toEqual(['t1']);
  });

  test('boolean AND/OR with grouping', () => {
    expect(run('p1 | p2').sort()).toEqual(['t1', 't3']);
    expect(run('today & p1')).toEqual(['t1']);
    expect(run('overdue | today')).toEqual(['t1', 't3']);
    expect(run('!p4').sort()).toEqual(['t1', 't3']);
  });

  test('project, label and section atoms', () => {
    expect(run('#Home')).toEqual(['t2']);
    expect(run('@urgent')).toEqual(['t1']);
    expect(run('#Work & !p2')).toEqual(['t1']);
  });

  test('wildcard free text', () => {
    expect(run('*invoice*')).toEqual(['t3']);
  });

  test('invalid grammar reports an error', () => {
    expect(parseFilter('p1 &', ctx.today).error).not.toBeNull();
    expect(parseFilter('((p1)', ctx.today).error).not.toBeNull();
  });

  test('starter filters all parse', () => {
    for (const filter of STARTER_FILTERS) {
      const parsed = parseFilter(filter.query, ctx.today);
      expect(parsed.error).toBeNull();
    }
  });
});
