import { DocPage } from './pages/DocPage.tsx';
import { Landing } from './pages/Landing.tsx';
import { usePath } from './router.ts';

export function App() {
  const path = usePath();
  const doc = /^\/d\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path);
  if (doc) return <DocPage key={doc[1]} roomId={doc[1]} />;
  return <Landing />;
}
