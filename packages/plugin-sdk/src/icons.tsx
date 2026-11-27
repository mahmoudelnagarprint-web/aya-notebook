import type { ReactNode } from 'react';

/**
 * Inline, offline icon set. Every entry is a set of SVG children drawn on a 24×24 grid
 * with `stroke: currentColor`, so icons inherit text colour and never touch the network.
 */
export const ICON_SHAPES: Record<string, ReactNode> = {
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.6 2.6L16 9.5" />
    </>
  ),
  checklist: (
    <>
      <path d="M9.5 6.5l1.6 1.6L14.6 4.6" />
      <path d="M9.5 13.5l1.6 1.6L14.6 12" />
      <path d="M9.5 20.5l1.6 1.6L14.6 19" />
      <path d="M18 7h3" />
      <path d="M18 14h3" />
      <path d="M18 21h3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 12.5h9L17.5 7" />
      <path d="M10.5 11v5" />
      <path d="M13.5 11v5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11 3.5l1.7 4.3L17 9.5l-4.3 1.7L11 15.5 9.3 11.2 5 9.5l4.3-1.7z" />
      <path d="M18 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  wand: (
    <>
      <path d="M4 20l9-9" />
      <path d="M15 3.5l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" />
      <path d="M19 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4.5h14l-2.8 4.8L19 14H5" />
    </>
  ),
  tag: (
    <>
      <path d="M20.4 13.4l-7 7a2 2 0 0 1-2.8 0L3 12.8V3h9.8l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.6l1.2 2.5 2.7-.5.7 2.7 2.6 1-.9 2.6 1.9 2-1.9 2 .9 2.6-2.6 1-.7 2.7-2.7-.5L12 21.4l-1.2-2.5-2.7.5-.7-2.7-2.6-1 .9-2.6-1.9-2 1.9-2-.9-2.6 2.6-1 .7-2.7 2.7.5z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.8-3.8" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
    </>
  ),
  today: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
      <path d="M8.5 15l2.2 2.2 4.3-4.3" />
    </>
  ),
  upcoming: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.2" />
      <path d="M3 10h18" />
      <path d="M7 2.5v4" />
      <path d="M17 2.5v4" />
      <path d="M9.5 15.5l3.5-2v5.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 2.5L20.5 6 17 9.5" />
      <path d="M7 21.5L3.5 18 7 14.5" />
      <path d="M20.5 6H9.5A5.5 5.5 0 0 0 4 11.5V13" />
      <path d="M3.5 18h11a5.5 5.5 0 0 0 5.5-5.5V11" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
      <circle cx="8.4" cy="10" r="1.5" />
      <path d="M3.8 17.5l4.8-4.8 3.2 3.2 3.4-3.4 5 5" />
    </>
  ),
  filter: (
    <>
      <path d="M3.5 5h17l-6.6 7.6V19l-3.8-2.2v-4.2z" />
    </>
  ),
  chat: (
    <>
      <path d="M21 11.6a8.4 8.4 0 0 1-9.4 8.4 8.9 8.9 0 0 1-3.4-.9L3 21l1.9-5.1A8.4 8.4 0 1 1 21 11.6z" />
    </>
  ),
  message: (
    <>
      <path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12z" />
      <path d="M8.5 11h7" />
      <path d="M8.5 14h4.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5z" />
      <path d="M10.2 20.5a2.2 2.2 0 0 0 3.6 0" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5h4l1.8 2.8h4.4l1.8-2.8h4" />
      <path d="M6.4 5h11.2l2.4 8.5v5.2a2.3 2.3 0 0 1-2.3 2.3H6.3A2.3 2.3 0 0 1 4 18.7v-5.2z" />
    </>
  ),
  hash: (
    <>
      <path d="M9.6 3.5L7.6 20.5" />
      <path d="M16.4 3.5l-2 17" />
      <path d="M4 9h16" />
      <path d="M3.5 15h16" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.2" />
      <path d="M9.5 4v16" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.3" />
      <circle cx="15" cy="6" r="1.3" />
      <circle cx="9" cy="12" r="1.3" />
      <circle cx="15" cy="12" r="1.3" />
      <circle cx="9" cy="18" r="1.3" />
      <circle cx="15" cy="18" r="1.3" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7.5A2.2 2.2 0 0 1 5.2 5.3h4l2 2.2h7.6A2.2 2.2 0 0 1 21 9.7v7.6a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.3z" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8" y="2.8" width="8" height="4" rx="1.2" />
      <path d="M16 4.8h2.2A2.2 2.2 0 0 1 20.4 7v12.2a2.2 2.2 0 0 1-2.2 2.2H5.8a2.2 2.2 0 0 1-2.2-2.2V7a2.2 2.2 0 0 1 2.2-2.2H8" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
  audit: (
    <>
      <path d="M12 2.8l7 3v5.6c0 5-3.1 8.4-7 9.8-3.9-1.4-7-4.8-7-9.8V5.8z" />
      <path d="M8.8 12l2.3 2.3 4.1-4.4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4.2" />
      <circle cx="12" cy="17.2" r="1" />
    </>
  ),
  alignLeft: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h10" />
      <path d="M4 18h13" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="7" height="9" rx="1.6" />
      <rect x="14" y="4" width="7" height="16" rx="1.6" />
      <rect x="3" y="17" width="7" height="3" rx="1.4" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.2" />
      <path d="M3 10h18" />
      <path d="M9.5 10v10" />
      <path d="M15.5 10v10" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6.5h12" />
      <path d="M8.5 12h12" />
      <path d="M8.5 17.5h12" />
      <circle cx="4.5" cy="6.5" r="1.2" />
      <circle cx="4.5" cy="12" r="1.2" />
      <circle cx="4.5" cy="17.5" r="1.2" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2.2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M20 10h.01M6 13.5h.01M9.5 13.5h.01M13 13.5h.01M16.5 13.5h.01M20 13.5h.01M8 16.5h8" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="9" />,
  chevronRight: (
    <>
      <path d="M9.5 6l6 6-6 6" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2.2" />
      <path d="M9 20.5h6" />
      <path d="M12 16.5v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </>
  ),
  moon: (
    <>
      <path d="M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5 8.6 8.6 0 1 0 20.5 14.8z" />
    </>
  ),
  planet: (
    <>
      <circle cx="12" cy="11" r="6" />
      <path d="M4.4 15.8C1.9 17 1 18.4 1.6 19.3c1 1.4 6.2-.1 11.6-3.3s9.1-7 8.1-8.4c-.5-.7-1.7-.8-3.3-.5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14l-5-5 5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H10" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H14" />
    </>
  ),
  send: (
    <>
      <path d="M22 2.5L11 13.5" />
      <path d="M22 2.5l-6.8 19-4.2-8.5-8.5-4.2z" />
    </>
  ),
  paperPlane: (
    <>
      <path d="M22 2.5L11 13.5" />
      <path d="M22 2.5l-6.8 19-4.2-8.5-8.5-4.2z" />
    </>
  ),
  save: (
    <>
      <path d="M19.5 21h-15A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3H16l5 5v11.5A1.5 1.5 0 0 1 19.5 21z" />
      <path d="M7.5 3v6h9V3" />
      <path d="M7.5 21v-6.5h9V21" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 11.5a8.5 8.5 0 1 0-2.6 6.4" />
      <path d="M20.5 4.5v7h-7" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14.5V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2H10" />
    </>
  ),
  loading: (
    <>
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </>
  ),
};

export const FALLBACK_ICON: ReactNode = (
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.4" />
  </>
);

export function iconShapes(name: string): ReactNode {
  return ICON_SHAPES[name] ?? FALLBACK_ICON;
}
