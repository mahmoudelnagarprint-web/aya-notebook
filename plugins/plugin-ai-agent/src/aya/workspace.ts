import type { Kernel } from '@ayatodoist/core-kernel';

export interface WorkspaceHit {
  collection: 'tasks' | 'projects' | 'labels' | 'sections';
  id: string;
  title: string;
  snippet: string;
}

/** Zero-network search over the live kernel: tasks, projects, labels, sections. */
export function searchWorkspace(kernel: Kernel, query: string, limit = 20): WorkspaceHit[] {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  const hits: WorkspaceHit[] = [];

  const matches = (...values: Array<string | null | undefined>) =>
    values.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));

  for (const task of kernel.store.list('tasks') as any[]) {
    if (task.deletedAt) continue;
    if (matches(task.content, task.description)) {
      hits.push({
        collection: 'tasks',
        id: task.id,
        title: task.content,
        snippet: (task.description || task.content || '').slice(0, 160),
      });
    }
  }
  for (const project of kernel.store.list('projects') as any[]) {
    if (matches(project.name, project.description)) {
      hits.push({ collection: 'projects', id: project.id, title: project.name, snippet: project.description ?? '' });
    }
  }
  for (const label of kernel.store.list('labels') as any[]) {
    if (matches(label.name)) hits.push({ collection: 'labels', id: label.id, title: label.name, snippet: '' });
  }
  for (const section of kernel.store.list('sections') as any[]) {
    if (matches(section.name)) hits.push({ collection: 'sections', id: section.id, title: section.name, snippet: '' });
  }

  return hits.slice(0, limit);
}
