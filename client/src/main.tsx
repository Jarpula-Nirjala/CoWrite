import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import './app.css';

createRoot(document.getElementById('root')!).render(<App />);

// Installable app + offline shell (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
