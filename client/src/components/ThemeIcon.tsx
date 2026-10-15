import type { ReactElement } from 'react';
import type { ThemeIconName } from '../lib/prefs.ts';

/** Line icons for colour themes: a sun for light, a moon for dark, a wave for Ocean and so on. */
const PATHS: Record<ThemeIconName, ReactElement> = {
  auto: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity=".2" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
    </>
  ),
  book: <path d="M3 5.5C5.5 4.5 8.5 4.5 12 6.5v13c-3.5-2-6.5-2-9-1Zm18 0c-2.5-1-5.5-1-9 1v13c3.5-2 6.5-2 9-1Z" />,
  wave: (
    <path d="M2 9c2.5-2.5 4.5-2.5 7 0s4.5 2.5 7 0 4-2.5 6 0M2 14c2.5-2.5 4.5-2.5 7 0s4.5 2.5 7 0 4-2.5 6 0M2 19c2.5-2.5 4.5-2.5 7 0s4.5 2.5 7 0 4-2.5 6 0" />
  ),
  tree: <path d="M12 2 5.5 11H9l-4 6h14l-4-6h3.5ZM12 17v5" />,
  flower: (
    <>
      <circle cx="12" cy="9" r="2.2" fill="currentColor" fillOpacity=".25" />
      <path d="M12 6.8c0-2.5-3-3.5-3.8-1.5S9.8 8.9 9.8 8.9M14.2 8.9s2.4-1.6 1.6-3.6-3.8-1-3.8 1.5M9.8 9.1s-2.8.4-2.6 2.6 3 2 4 .1M14.2 9.1s2.8.4 2.6 2.6-3 2-4 .1M12 11.2V22M12 17c-2-2.5-4.5-2.5-6-1.5M12 19c2-2.5 4.5-2.5 6-1.5" />
    </>
  ),
  sprig: (
    <path d="M12 22V6M12 6c-1.2-1-1.2-3 0-4 1.2 1 1.2 3 0 4ZM12 10c-2-.2-3.2-1.8-3-3.5 1.8.1 3 1.6 3 3.5Zm0 0c2-.2 3.2-1.8 3-3.5-1.8.1-3 1.6-3 3.5ZM12 14.5c-2-.2-3.2-1.8-3-3.5 1.8.1 3 1.6 3 3.5Zm0 0c2-.2 3.2-1.8 3-3.5-1.8.1-3 1.6-3 3.5ZM12 19c-2-.2-3.2-1.8-3-3.5 1.8.1 3 1.6 3 3.5Zm0 0c2-.2 3.2-1.8 3-3.5-1.8.1-3 1.6-3 3.5Z" />
  ),
  leaf: <path d="M4 20c0-9 6-15 16-16 0 10-6 16-15 16Zm0 0 8-8" />,
  sunset: <path d="M6.5 16a5.5 5.5 0 0 1 11 0M2 16h20M5 20h14M12 3v3M4.6 7.6l2 2M19.4 7.6l-2 2" />,
  cloud: <path d="M7 18h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 11 3.5 3.5 0 0 0 7 18Z" />,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor" fillOpacity=".2" />,
  stars: (
    <>
      <path d="M15 15.5A7 7 0 0 1 7.5 6a7 7 0 1 0 7.5 9.5Z" fill="currentColor" fillOpacity=".2" />
      <path d="M17.5 3v4M15.5 5h4M20 10v3M18.5 11.5h3" />
    </>
  ),
  cup: <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Zm12 1.5h1.5a2.5 2.5 0 0 1 0 5H16M3 22h15M8 3c-1 1 1 2 0 3.5M12 3c-1 1 1 2 0 3.5" />,
  snow: <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5M3 10.5 6.4 9.8 5.6 6.5M21 13.5l-3.4.7.8 3.3M3 13.5l3.4.7-.8 3.3M21 10.5l-3.4-.7.8-3.3" />,
  gem: <path d="M6 3h12l4 6-10 12L2 9Zm-4 6h20M9 3l3 18 3-18M6 3l3 6 3-6 3 6 3-6" />,
  contrast: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 3h5a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-5Z" fill="currentColor" stroke="none" />
    </>
  ),
};

export function ThemeIcon({ name, size = 18, color }: { name: ThemeIconName; size?: number; color?: string }) {
  return (
    <svg className="theme-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ color }} aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
