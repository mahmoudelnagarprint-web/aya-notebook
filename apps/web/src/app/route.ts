import type { Route } from '@ayatodoist/shared-types';

const KINDS = new Set([
  'inbox',
  'today',
  'upcoming',
  'project',
  'section',
  'label',
  'filter',
  'filters-labels',
  'reporting',
  'settings',
  'search',
  'home',
  'activity',
  'completed',
  'aya',
]);

/** Hash router → Route DTO. Unknown routes fall back to the inbox. */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').trim();
  if (!raw) return { kind: 'inbox' };
  const [pathPart, queryPart] = raw.split('?');
  const segments = (pathPart ?? '').split('/').filter(Boolean);
  const kind = segments[0];
  if (!kind || !KINDS.has(kind)) return { kind: 'inbox' };
  const id = segments[1] ? decodeURIComponent(segments[1]) : null;
  const query = queryPart ? new URLSearchParams(queryPart).get('q') : null;
  return { kind: kind as Route['kind'], id, query };
}

export function routeToHash(route: Route): string {
  const parts: string[] = [route.kind];
  if (route.id) parts.push(encodeURIComponent(route.id));
  if (route.kind === 'search' && route.query) return `#/${parts.join('/')}?q=${encodeURIComponent(route.query)}`;
  return `#/${parts.join('/')}`;
}

export function routeTitle(route: Route): string {
  switch (route.kind) {
    case 'inbox':
      return 'inbox';
    case 'today':
      return 'today';
    case 'upcoming':
      return 'upcoming';
    case 'settings':
      return 'settings';
    default:
      return route.kind;
  }
}
