import type { Label, Project, Section, Task } from '@ayatodoist/shared-types';
import { addDays, parseDay } from '@ayatodoist/shared-types';

/**
 * Clean-room, local filter query engine.
 * Grammar: atoms joined by `&` (AND), `|` or `,` (OR), `!` (NOT), grouped with `()`.
 * Atoms: @label, #project, /section, p1-p4, today, tomorrow, overdue, "no date",
 * "7 days", this week, next week, weekdays, recurring, created:today, "free text" and *wildcards*.
 */

export type FilterNode =
  | { type: 'and'; children: FilterNode[] }
  | { type: 'or'; children: FilterNode[] }
  | { type: 'not'; child: FilterNode }
  | { type: 'atom'; atom: Atom };

export type Atom =
  | { kind: 'label'; value: string }
  | { kind: 'project'; value: string }
  | { kind: 'section'; value: string }
  | { kind: 'priority'; value: number }
  | { kind: 'date'; value: 'today' | 'tomorrow' | 'yesterday' | 'overdue' | 'none' | 'week' | 'next-week' | 'recurring' | 'day'; day?: string }
  | { kind: 'created'; value: 'today' | 'week' }
  | { kind: 'search'; value: string };

export interface ParseResult {
  ast: FilterNode | null;
  error: string | null;
}

interface Token {
  type: 'and' | 'or' | 'not' | 'lparen' | 'rparen' | 'atom';
  atom?: Atom;
  position: number;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function toAtom(raw: string, today: string): Atom | null {
  const text = raw.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (lower.startsWith('@')) return { kind: 'label', value: text.slice(1) };
  if (lower.startsWith('#')) return { kind: 'project', value: text.slice(1) };
  if (lower.startsWith('/')) return { kind: 'section', value: text.slice(1) };
  if (/^p[1-4]$/.test(lower)) return { kind: 'priority', value: Number(lower.slice(1)) };

  switch (lower) {
    case 'today':
      return { kind: 'date', value: 'today' };
    case 'tomorrow':
      return { kind: 'date', value: 'tomorrow' };
    case 'yesterday':
      return { kind: 'date', value: 'yesterday' };
    case 'overdue':
      return { kind: 'date', value: 'overdue' };
    case 'no date':
    case 'nodate':
      return { kind: 'date', value: 'none' };
    case 'recurring':
    case 'repeating':
      return { kind: 'date', value: 'recurring' };
    case 'this week':
      return { kind: 'date', value: 'week' };
    case 'next week':
      return { kind: 'date', value: 'next-week' };
    case 'created:today':
      return { kind: 'created', value: 'today' };
    case 'created:week':
      return { kind: 'created', value: 'week' };
    default:
      break;
  }

  const days = lower.match(/^(\d+)\s*days?$/);
  if (days) {
    const until = addDays(today, Number(days[1]));
    return { kind: 'date', value: 'week', day: until };
  }
  if (WEEKDAYS[lower] !== undefined) {
    const current = parseDay(today).getDay();
    const offset = (WEEKDAYS[lower]! - current + 7) % 7;
    return { kind: 'date', value: 'day', day: addDays(today, offset) };
  }
  if (lower.startsWith('created:')) {
    return { kind: 'created', value: lower.endsWith('today') ? 'today' : 'week' };
  }
  return { kind: 'search', value: text.replace(/^\*|\*$/g, '') };
}

function tokenize(input: string, today: string): { tokens: Token[]; error: string | null } {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '&') {
      tokens.push({ type: 'and', position: index });
      index += 1;
      continue;
    }
    if (char === '|' || char === ',') {
      tokens.push({ type: 'or', position: index });
      index += 1;
      continue;
    }
    if (char === '!') {
      tokens.push({ type: 'not', position: index });
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'lparen', position: index });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', position: index });
      index += 1;
      continue;
    }
    if (char === '"') {
      const end = input.indexOf('"', index + 1);
      if (end === -1) return { tokens, error: `Unterminated quote at ${index}` };
      tokens.push({ type: 'atom', atom: { kind: 'search', value: input.slice(index + 1, end) }, position: index });
      index = end + 1;
      continue;
    }

    let end = index;
    let quoted = false;
    while (end < input.length) {
      const current = input[end]!;
      if (current === '"') {
        quoted = !quoted;
        end += 1;
        continue;
      }
      if (!quoted && /[&|!,()]/.test(current)) break;
      end += 1;
    }
    const raw = input.slice(index, end).trim();
    if (raw) {
      const atom = toAtom(raw, today);
      if (atom) tokens.push({ type: 'atom', atom, position: index });
    }
    index = end;
  }
  return { tokens, error: null };
}

export function parseFilter(query: string, today: string): ParseResult {
  const { tokens, error } = tokenize(query, today);
  if (error) return { ast: null, error };
  if (tokens.length === 0) return { ast: null, error: 'Empty filter' };
  let cursor = 0;

  const peek = () => tokens[cursor];
  const consume = () => tokens[cursor++];

  function parseOr(): FilterNode {
    const children = [parseAnd()];
    while (peek()?.type === 'or') {
      consume();
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0]! : { type: 'or', children };
  }

  function parseAnd(): FilterNode {
    const children = [parseUnary()];
    while (peek() && (peek()!.type === 'and' || peek()!.type === 'atom' || peek()!.type === 'lparen' || peek()!.type === 'not')) {
      if (peek()!.type === 'and') consume();
      children.push(parseUnary());
    }
    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  function parseUnary(): FilterNode {
    const token = peek();
    if (!token) throw new Error('Unexpected end of filter');
    if (token.type === 'not') {
      consume();
      return { type: 'not', child: parseUnary() };
    }
    if (token.type === 'lparen') {
      consume();
      const node = parseOr();
      if (peek()?.type !== 'rparen') throw new Error('Missing closing parenthesis');
      consume();
      return node;
    }
    if (token.type === 'atom') {
      consume();
      return { type: 'atom', atom: token.atom! };
    }
    throw new Error(`Unexpected token at ${token.position}`);
  }

  try {
    const ast = parseOr();
    if (cursor < tokens.length) return { ast: null, error: `Unexpected token at ${tokens[cursor]!.position}` };
    return { ast, error: null };
  } catch (cause) {
    return { ast: null, error: (cause as Error).message };
  }
}

export interface FilterContext {
  today: string;
  projects: Project[];
  sections: Section[];
  labels: Label[];
  projectById?: Map<string, Project>;
  labelById?: Map<string, Label>;
}

function matchesName(name: string, pattern: string): boolean {
  const target = pattern.replace(/\*/g, '').toLowerCase();
  return name.toLowerCase().includes(target);
}

function matchesDate(task: Task, atom: Extract<Atom, { kind: 'date' }>, today: string): boolean {
  const due = task.dueDate;
  switch (atom.value) {
    case 'today':
      return due === today;
    case 'tomorrow':
      return due === addDays(today, 1);
    case 'yesterday':
      return due === addDays(today, -1);
    case 'overdue':
      return due !== null && due < today && !task.isCompleted;
    case 'none':
      return due === null;
    case 'week':
      return due !== null && due >= today && due <= (atom.day ?? addDays(today, 7));
    case 'next-week': {
      const start = addDays(today, 7);
      return due !== null && due >= start && due <= addDays(start, 7);
    }
    case 'recurring':
      return task.recurrence !== null;
    case 'day':
      return due === atom.day;
    default:
      return true;
  }
}

export function evaluateNode(node: FilterNode, task: Task, ctx: FilterContext): boolean {
  switch (node.type) {
    case 'and':
      return node.children.every((child) => evaluateNode(child, task, ctx));
    case 'or':
      return node.children.some((child) => evaluateNode(child, task, ctx));
    case 'not':
      return !evaluateNode(node.child, task, ctx);
    case 'atom': {
      const atom = node.atom;
      switch (atom.kind) {
        case 'label': {
          const label = ctx.labelById?.get(atom.value) ?? ctx.labels.find((item) => matchesName(item.name, atom.value));
          return Boolean(label && task.labels.includes(label.id));
        }
        case 'project': {
          const project = ctx.projectById?.get(task.projectId);
          return Boolean(project && matchesName(project.name, atom.value));
        }
        case 'section': {
          const section = ctx.sections.find((item) => item.id === task.sectionId);
          return Boolean(section && matchesName(section.name, atom.value));
        }
        case 'priority':
          return task.priority === atom.value;
        case 'date':
          return matchesDate(task, atom, ctx.today);
        case 'created':
          return atom.value === 'today' ? task.createdAt.slice(0, 10) === ctx.today : task.createdAt.slice(0, 10) >= addDays(ctx.today, -7);
        case 'search':
          return (
            task.content.toLowerCase().includes(atom.value.toLowerCase()) ||
            task.description.toLowerCase().includes(atom.value.toLowerCase())
          );
      }
    }
  }
}

export function evaluateFilter(ast: FilterNode, tasks: Task[], ctx: FilterContext): Task[] {
  const projectById = ctx.projectById ?? new Map(ctx.projects.map((project) => [project.id, project]));
  const labelById = ctx.labelById ?? new Map(ctx.labels.map((label) => [label.id, label]));
  return tasks.filter((task) => evaluateNode(ast, task, { ...ctx, projectById, labelById }));
}

export const STARTER_FILTERS = [
  { name: 'High priority', query: 'p1 | p2', color: '#d1453b' },
  { name: 'Overdue', query: 'overdue & !#Inbox', color: '#eb8909' },
  { name: 'This week', query: '7 days', color: '#692ec2' },
  { name: 'No date', query: 'no date & !recurring', color: '#666666' },
];
