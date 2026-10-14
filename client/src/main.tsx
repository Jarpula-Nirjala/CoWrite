import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import './styles.css';
import './app.css';
import './rich.css';

createRoot(document.getElementById('root')!).render(<App />);

// Installable app + offline shell (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
