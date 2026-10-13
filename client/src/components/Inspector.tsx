import type { CSSProperties } from 'react';
import type { Doc } from '../../../shared/crdt.ts';

const LIMIT = 400;

const show = (ch: string) => (ch === '\n' ? '↵' : ch === ' ' ? '␣' : ch);

export function Inspector({ doc, colors }: { doc: Doc; colors: Record<string, string> }) {
  const items = doc.inspect(LIMIT);
  return (
    <div className="inspector">
      <ol className="chips">
        {items.map((it) => (
          <li
            key={it.key}
            className={it.deleted ? 'chip deleted' : 'chip'}
            style={{ '--peer': colors[it.site] ?? 'var(--muted)' } as CSSProperties}
            title={`${it.deleted ? 'tombstone ' : ''}"${it.ch}" id ${it.key}`}
          >
            <span className="chip-ch">{show(it.ch)}</span>
            <span className="chip-id">
              {it.site}:{it.clock}
            </span>
          </li>
        ))}
      </ol>
      {doc.size > LIMIT && <p className="muted small">…and {doc.size - LIMIT} more items</p>}
    </div>
  );
}
