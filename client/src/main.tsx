import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyPrefs, localPrefs } from './lib/prefs.ts';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/playfair-display/800.css';
import './styles.css';
import './brand.css';
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
import './layout.css';
import './a11y.css';
import './apps-window.css';

applyPrefs(localPrefs());
createRoot(document.getElementById('root')!).render(<App />);

// Installable app + offline shell (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
