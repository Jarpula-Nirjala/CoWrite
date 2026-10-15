import { useId, type ReactNode } from 'react';

/**
 * CoWrite's product icons: one designed, full-colour mark per application, in the flat,
 * layered style of modern office-suite logos. Documents are pages with a folded corner;
 * everything else is a rounded tile with a white glyph.
 */
export function ProductIcon({ id, size = 40, title }: { id: string; size?: number; title?: string }) {
  const uid = useId().replace(/:/g, '');
  const g = (n: string) => `${uid}${n}`;
  const draw = ICONS[id] ?? ICONS.docs;
  return (
    <svg className="product-icon" width={size} height={size} viewBox="0 0 48 48" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {draw(g)}
    </svg>
  );
}

type Draw = (g: (n: string) => string) => ReactNode;

/** A page with a folded top-right corner, in the given colours, with a glyph drawn on it. */
const page =
  (top: string, bottom: string, fold: string, glyph: ReactNode): Draw =>
  (g) => (
    <>
      <defs>
        <linearGradient id={g('p')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <path d="M12 3h17l11 11v29a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill={`url(#${g('p')})`} />
      <path d="M29 3l11 11h-9a2 2 0 0 1-2-2z" fill={fold} />
      <path d="M29 14l11 11V14z" fill="#000" opacity=".12" />
      {glyph}
    </>
  );

/** A rounded tile with a soft vertical gradient. */
const tile =
  (top: string, bottom: string, glyph: ReactNode): Draw =>
  (g) => (
    <>
      <defs>
        <linearGradient id={g('t')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="10" fill={`url(#${g('t')})`} />
      <rect x="4" y="4" width="40" height="20" rx="10" fill="#fff" opacity=".08" />
      {glyph}
    </>
  );

const W = '#fff';

const ICONS: Record<string, Draw> = {
  docs: page('#5b9cff', '#2f6fe0', '#a8c8ff', <path d="M16 21h16v2.5H16zm0 6h16v2.5H16zm0 6h10v2.5H16z" fill={W} />),
  sheets: page(
    '#2fbf71',
    '#138a4c',
    '#9de2bd',
    <>
      <rect x="15" y="20" width="18" height="16" rx="1.5" fill={W} />
      <path d="M15 25h18v1.6H15zm0 5h18v1.6H15zM21.2 20h1.6v16h-1.6z" fill="#169a55" />
    </>,
  ),
  slides: page(
    '#ffc233',
    '#f29900',
    '#ffe199',
    <>
      <rect x="14.5" y="21" width="19" height="13" rx="1.5" fill="none" stroke={W} strokeWidth="2.6" />
    </>,
  ),
  forms: page(
    '#9b6ef3',
    '#6b3fd0',
    '#d2bdfb',
    <>
      <circle cx="17.5" cy="22" r="1.8" fill={W} />
      <circle cx="17.5" cy="28" r="1.8" fill={W} />
      <circle cx="17.5" cy="34" r="1.8" fill={W} />
      <path d="M21.5 20.8h11v2.4h-11zm0 6h11v2.4h-11zm0 6h11v2.4h-11z" fill={W} />
    </>,
  ),
  sites: page(
    '#6f86ff',
    '#3d55d6',
    '#c0caff',
    <>
      <rect x="15" y="19" width="18" height="5" rx="1" fill={W} />
      <rect x="15" y="26" width="8" height="10" rx="1" fill={W} opacity=".95" />
      <rect x="25" y="26" width="8" height="4" rx="1" fill={W} opacity=".75" />
      <rect x="25" y="32" width="8" height="4" rx="1" fill={W} opacity=".75" />
    </>,
  ),
  keep: page(
    '#ffd34d',
    '#f6b100',
    '#ffeaa6',
    <>
      <path d="M24 17.5a7 7 0 0 0-4 12.7V33h8v-2.8a7 7 0 0 0-4-12.7z" fill={W} />
      <rect x="20.5" y="34.5" width="7" height="2.4" rx="1.2" fill={W} />
    </>,
  ),
  calendar: (g) => (
    <>
      <defs>
        <linearGradient id={g('c')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4d8dff" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect x="5" y="6" width="38" height="37" rx="7" fill="#fff" stroke="#d6dbe4" />
      <path d="M12 6h24a7 7 0 0 1 7 7v4H5v-4a7 7 0 0 1 7-7z" fill={`url(#${g('c')})`} />
      <rect x="14" y="3" width="3.2" height="7" rx="1.6" fill="#1e40af" />
      <rect x="30.8" y="3" width="3.2" height="7" rx="1.6" fill="#1e40af" />
      <text x="24" y="37" textAnchor="middle" fontFamily="Roboto, 'Segoe UI', Arial, sans-serif" fontWeight="700" fontSize="16" fill="#2563eb">
        31
      </text>
    </>
  ),
  tasks: (g) => (
    <>
      <defs>
        <linearGradient id={g('k')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4c9bff" />
          <stop offset="1" stopColor="#1a5fd6" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="19" fill={`url(#${g('k')})`} />
      <path d="M15.5 24.5l6 6 11-12" fill="none" stroke={W} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="37" cy="11" r="4" fill="#ffc233" />
    </>
  ),
  meet: tile(
    '#14b37d',
    '#0b8457',
    <>
      <rect x="11" y="16" width="19" height="16" rx="3" fill={W} />
      <path d="M31.5 21.5l6.5-4v13l-6.5-4z" fill={W} />
    </>,
  ),
  chat: tile(
    '#20b860',
    '#0d8a45',
    <>
      <path d="M13 14h22a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H21l-6 5v-5h-2a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill={W} />
      <path d="M16 20h16v2.2H16zm0 5h11v2.2H16z" fill="#13a052" />
    </>,
  ),
  drive: (g) => (
    <>
      <defs>
        <linearGradient id={g('d')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd25e" />
          <stop offset="1" stopColor="#f5a800" />
        </linearGradient>
      </defs>
      <path d="M6 12a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v3H6z" fill="#d98e00" />
      <rect x="6" y="16" width="36" height="25" rx="3" fill={`url(#${g('d')})`} />
      <rect x="6" y="16" width="36" height="5" rx="2" fill="#fff" opacity=".18" />
    </>
  ),
  pics: (g) => (
    <>
      <defs>
        <linearGradient id={g('s')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8a65" />
          <stop offset="1" stopColor="#e53935" />
        </linearGradient>
      </defs>
      <rect x="4" y="6" width="40" height="36" rx="8" fill={`url(#${g('s')})`} />
      <circle cx="33" cy="16" r="4" fill="#ffe082" />
      <path d="M8 36l10-12 7 8 5-5 10 9v1a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z" fill={W} />
    </>
  ),
  whiteboard: tile(
    '#ab47bc',
    '#7b1fa2',
    <>
      <rect x="11" y="12" width="26" height="19" rx="2" fill={W} />
      <path d="M15 25c3-6 5 2 8-3s5 1 8-4" fill="none" stroke="#8e24aa" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M22 31l-3 6m7-6l3 6" stroke={W} strokeWidth="2.4" strokeLinecap="round" />
    </>,
  ),
  kanban: tile(
    '#29a3e6',
    '#0b6fb3',
    <>
      <rect x="11" y="12" width="7" height="24" rx="2" fill={W} />
      <rect x="20.5" y="12" width="7" height="16" rx="2" fill={W} />
      <rect x="30" y="12" width="7" height="20" rx="2" fill={W} />
    </>,
  ),
  assistant: (g) => (
    <>
      <defs>
        <linearGradient id={g('a')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8bff" />
          <stop offset=".55" stopColor="#8a5cf6" />
          <stop offset="1" stopColor="#e05cb0" />
        </linearGradient>
      </defs>
      <path d="M24 4c1.6 9.6 10.4 18.4 20 20-9.6 1.6-18.4 10.4-20 20-1.6-9.6-10.4-18.4-20-20 9.6-1.6 18.4-10.4 20-20z" fill={`url(#${g('a')})`} />
    </>
  ),
  notebook: tile(
    '#7e57c2',
    '#4527a0',
    <>
      <path d="M14 12h17a3 3 0 0 1 3 3v21H17a3 3 0 0 1-3-3z" fill={W} />
      <path d="M17 33h17v3H17a1.5 1.5 0 0 1 0-3z" fill="#d1c4e9" />
      <path d="M25 12h5v10l-2.5-2-2.5 2z" fill="#5e35b1" />
    </>,
  ),
  studio: tile(
    '#ec4f8c',
    '#b0185e',
    <>
      <path d="M13 35l14-14 3 3-14 14z" fill={W} />
      <path d="M30 10c.7 3.4 2.6 5.3 6 6-3.4.7-5.3 2.6-6 6-.7-3.4-2.6-5.3-6-6 3.4-.7 5.3-2.6 6-6z" fill={W} />
      <circle cx="36" cy="27" r="1.6" fill={W} />
    </>,
  ),
  templates: tile(
    '#d4a63c',
    '#a07818',
    <>
      <rect x="11" y="11" width="26" height="8" rx="1.5" fill={W} />
      <rect x="11" y="21.5" width="12" height="15.5" rx="1.5" fill={W} />
      <rect x="25.5" y="21.5" width="11.5" height="6.5" rx="1.5" fill={W} opacity=".85" />
      <rect x="25.5" y="30.5" width="11.5" height="6.5" rx="1.5" fill={W} opacity=".85" />
    </>,
  ),
  connections: tile(
    '#3d8bfd',
    '#1857c8',
    <>
      <path d="M21.5 26.5a5.5 5.5 0 0 0 7.8 0l5-5a5.5 5.5 0 0 0-7.8-7.8l-1.6 1.6" fill="none" stroke={W} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M26.5 21.5a5.5 5.5 0 0 0-7.8 0l-5 5a5.5 5.5 0 0 0 7.8 7.8l1.6-1.6" fill="none" stroke={W} strokeWidth="3.2" strokeLinecap="round" />
    </>,
  ),
  pdf: page('#f2675c', '#d93025', '#f9b4ae', <text x="24" y="33" textAnchor="middle" fontFamily="Roboto, 'Segoe UI', Arial, sans-serif" fontWeight="800" fontSize="10" fill={W}>PDF</text>),
};

/** Document kinds (doc, sheet, slides …) mapped to their product icon. */
export const KIND_PRODUCT: Record<string, string> = { doc: 'docs', sheet: 'sheets', slides: 'slides', form: 'forms', site: 'sites', board: 'whiteboard', kanban: 'kanban', pdf: 'pdf', note: 'keep' };
