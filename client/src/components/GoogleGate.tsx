import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { allowUrl, type GoogleFeature } from '../lib/google.ts';
import { AppLogo, type AppLogoName } from './AppLogo.tsx';
import { Spinner } from './ui.tsx';

const NAMES: Record<GoogleFeature, [string, AppLogoName, string]> = {
  gmail: ['Gmail', 'gmail', 'show your mailbox, and read, send, star, archive and delete mail'],
  youtube: ['YouTube', 'youtube', 'show YouTube: trending, your subscriptions, liked videos and search'],
  sheets: ['Google Sheets', 'drive', 'open and save Google Sheets'],
  tasks: ['Google Tasks', 'tasks', 'show and update your Google Tasks'],
  calendar: ['Google Calendar', 'calendar', 'add CoWrite events to Google Calendar'],
  contacts: ['Google Contacts', 'contacts', 'suggest your contacts'],
  drive: ['Google Drive', 'drive', 'rename, star, move and delete files in your Drive'],
};

/** Shows its children only when Google is connected with this feature's permission; otherwise one button to fix it. */
export function GoogleGate({ feature, tab, children }: { feature: GoogleFeature | null; tab: string; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'connect' | 'allow' | 'ok'>('loading');
  useEffect(() => {
    api<{ google: { connected: boolean; features: Partial<Record<GoogleFeature, boolean>> } }>('/integrations').then(
      (r) => setState(!r.google.connected ? 'connect' : feature && !r.google.features[feature] ? 'allow' : 'ok'),
      () => setState('connect'),
    );
  }, [feature]);
  if (state === 'loading') return <Spinner />;
  if (state === 'ok') return <>{children}</>;
  const [name, logo, what] = feature ? NAMES[feature] : ['Google', 'google' as AppLogoName, 'show your Google files'];
  return (
    <div className="gate">
      <AppLogo name={logo} size={64} />
      <h3>{state === 'connect' ? 'Connect your Google account' : `Allow CoWrite to use ${name}`}</h3>
      <p className="muted">
        {state === 'connect' ? 'Connect Google once in Account settings; then each app asks for its own permission.' : `CoWrite needs your permission to ${what}. Google asks you to confirm; you can remove it any time.`}
      </p>
      <a className="btn btn-primary" href={state === 'connect' ? '/account#connected' : allowUrl(feature!, tab)}>
        {state === 'connect' ? 'Connect Google' : `Allow ${name}`}
      </a>
    </div>
  );
}
