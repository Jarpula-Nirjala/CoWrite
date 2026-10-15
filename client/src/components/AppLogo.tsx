import type { ReactElement } from 'react';

export type AppLogoName = 'gmail' | 'youtube' | 'drive' | 'calendar' | 'tasks' | 'contacts' | 'github' | 'google';

/** Brand marks for the connected apps (simplified, drawn as SVG). */
const LOGOS: Record<AppLogoName, ReactElement> = {
  gmail: (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7c1.66 0 3-1.34 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.61 1.71L13 23.7V40H6c-1.66 0-3-1.34-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2L24 19.45 13 11.2l-1 5.8 1 6.7 11 8.25 11-8.25 1-6.7z" />
      <path fill="#c62828" d="M3 12.3v3.9l10 7.5V11.2L9.88 8.86C9.13 8.3 8.22 8 7.28 8 4.92 8 3 9.92 3 12.3z" />
      <path fill="#fbc02d" d="M45 12.3v3.9l-10 7.5V11.2l3.12-2.34C38.87 8.3 39.78 8 40.72 8 43.08 8 45 9.92 45 12.3z" />
    </svg>
  ),
  youtube: (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path fill="#ff0000" d="M43.2 33.9c-.4 2.1-2.1 3.7-4.2 4-3.3.5-8.8 1.1-15 1.1-6.1 0-11.6-.6-15-1.1-2.1-.3-3.8-1.9-4.2-4C4.4 31.6 4 28.2 4 24s.4-7.6.8-9.9c.4-2.1 2.1-3.7 4.2-4C12.3 9.6 17.8 9 24 9c6.2 0 11.6.6 15 1.1 2.1.3 3.8 1.9 4.2 4 .4 2.3.9 5.7.9 9.9-.1 4.2-.5 7.6-.9 9.9z" />
      <path fill="#fff" d="M20 31V17l12 7z" />
    </svg>
  ),
  drive: (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path fill="#0f9d58" d="M17 7 4 29.5 10.5 41 23.5 18.5z" />
      <path fill="#fbbc04" d="M17 7h14l13 22.5H30.5z" />
      <path fill="#4285f4" d="M10.5 41h27L44 29.5H17z" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 48 48" aria-hidden>
      <rect x="6" y="8" width="36" height="34" rx="4" fill="#fff" stroke="#1e88e5" strokeWidth="3" />
      <path fill="#1e88e5" d="M6 12a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v6H6z" />
      <text x="24" y="37" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="15" fill="#1e88e5">31</text>
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="19" fill="#1e88e5" />
      <path d="M15 24.5l6 6 12-13" fill="none" stroke="#fbc02d" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  contacts: (
    <svg viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="20" fill="#1e88e5" />
      <circle cx="24" cy="19" r="7" fill="#fff" />
      <path d="M11 37c2-6 7-9 13-9s11 3 13 9" fill="#fff" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 16 16" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  ),
  google: (
    <svg viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  ),
};

export function AppLogo({ name, size = 20 }: { name: AppLogoName; size?: number }) {
  return (
    <span className="app-logo" style={{ width: size, height: size }}>
      {LOGOS[name]}
    </span>
  );
}
