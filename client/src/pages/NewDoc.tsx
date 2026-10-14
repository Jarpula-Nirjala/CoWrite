import { useEffect, useState } from 'react';
import { EMBED } from '../../../shared/crdt.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText, type DocKind, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Spinner } from '../components/ui.tsx';
import { BLANKS, GALLERY } from '../lib/gallery.ts';
import { pendingContent, type InitialContent } from '../lib/templates.ts';
import { newForm } from '../rich/form.tsx';
import { Link, navigate } from '../router.ts';

const KINDS: Record<string, DocKind> = { doc: 'doc', sheet: 'sheet', slides: 'slides', board: 'board', kanban: 'kanban', form: 'doc', site: 'doc' };

/** /new/<kind>: creates a fresh document of that kind (used by the app launcher). */
export function NewDoc({ kind }: { kind: string }) {
  const { user, ready } = useAuth();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (!user) return navigate(`/signin?next=${encodeURIComponent(`/new/${kind}`)}`, { replace: true });
    const k = KINDS[kind] ?? 'doc';
    let title = 'Untitled document';
    let content: InitialContent;
    if (kind === 'form') {
      title = 'Untitled form';
      content = { tokens: [...markdownToTokens('# Untitled form\nTell people what this form is for.'), { ch: EMBED, a: { atom: 'form', ...newForm() } }, { ch: '\n' }] };
    } else if (kind === 'site') {
      title = 'My website';
      content = {
        tokens: markdownToTokens(
          ['# My website', 'A one-line description of what you do.', '![Cover](/features/workspaces.jpg)', '## About', 'Who you are and what makes you different.', '## Services', '- First service', '- Second service', '- Third service', '## Contact', 'Write to hello@example.com'].join('\n'),
        ),
      };
      try {
        localStorage.setItem('cowrite:pref:panel', '"site"');
      } catch {
        // ignore
      }
    } else {
      const blank = GALLERY.find((g) => g.id === BLANKS[k])!;
      title = blank.title;
      content = blank.build();
    }
    api<{ document: DocMeta }>('/docs', { method: 'POST', body: { title, kind: k } }).then(
      ({ document }) => {
        pendingContent.set(document.id, content);
        navigate(`/d/${document.id}`, { replace: true });
      },
      (e) => setError(errorText(e)),
    );
  }, [ready, user, kind]);
  if (error)
    return (
      <div className="page center-page">
        <div className="panel narrow-card">
          <p className="error-text">{error}</p>
          <Link to="/home">Back home</Link>
        </div>
      </div>
    );
  return <Spinner label="Creating…" />;
}
