import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyPrefs, localPrefs } from './lib/prefs.ts';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import './styles.css';
import './app.css';
import './rich.css';
import './kinds/kinds.css';
import './features.css';
import './tools.css';
import './home.css';
import './showcase.css';
import './apps.css';
import './workspace.css';
import './calendar.css';
import './themes.css';

applyPrefs(localPrefs());
createRoot(document.getElementById('root')!).render(<App />);

// Installable app + offline shell (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
