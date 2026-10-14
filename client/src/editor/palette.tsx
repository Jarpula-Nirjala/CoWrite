import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  disabled?: boolean;
  run(): void;
}

/** Ctrl/⌘+K: search and run any action without leaving the keyboard. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = commands.filter((c) => !c.disabled);
    if (!q) return all;
    return all
      .map((c) => {
        const hay = `${c.group} ${c.label}`.toLowerCase();
        const score = hay.includes(q) ? (c.label.toLowerCase().startsWith(q) ? 0 : 1) : q.split(/\s+/).every((w) => hay.includes(w)) ? 2 : -1;
        return { c, score };
      })
      .filter((m) => m.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((m) => m.c);
  }, [commands, query]);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // Let the palette close (and focus return) before the command runs.
    setTimeout(() => c.run(), 0);
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(matches.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(matches[index]);
            } else if (e.key === 'Escape') onClose();
          }}
          aria-label="Search commands"
        />
        <ul className="palette-list" role="listbox" ref={list}>
          {matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === index}>
              <button type="button" className={i === index ? 'active' : ''} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
                <span className="palette-group">{c.group}</span>
                <span className="palette-label">{c.label}</span>
                {c.shortcut && <kbd>{c.shortcut}</kbd>}
              </button>
            </li>
          ))}
          {!matches.length && <li className="muted pad">No matching commands.</li>}
        </ul>
      </div>
    </div>
  );
}
