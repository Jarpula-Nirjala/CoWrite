import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Doc, Op } from '../../../shared/crdt.ts';
import type { Selection } from '../../../shared/protocol.ts';

export interface RemoteCursor {
  site: string;
  name: string;
  color: string;
  sel: Selection;
}

interface Props {
  doc: Doc;
  /** Bump whenever `doc` changed from outside this editor. */
  version: number;
  cursors: RemoteCursor[];
  onLocalOps(ops: Op[]): void;
  onSelection?(sel: Selection): void;
  placeholder?: string;
  label: string;
  minRows?: number;
}

/**
 * Turns a textarea edit into one delete + one insert. The caret pins down
 * where the change happened, which matters when the text has repeated
 * characters ("aaa"): without it a diff cannot tell which "a" was typed.
 */
function diff(prev: string, next: string, caret: number): { pos: number; del: number; ins: string } {
  const grown = Math.max(0, next.length - prev.length);
  const maxPrefix = Math.min(prev.length, next.length, Math.max(0, caret - grown));
  let p = 0;
  while (p < maxPrefix && prev[p] === next[p]) p++;
  let s = 0;
  const maxSuffix = Math.min(prev.length, next.length) - p;
  while (s < maxSuffix && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  return { pos: p, del: prev.length - p - s, ins: next.slice(p, next.length - s) };
}

export function CollabEditor({ doc, version, cursors, onLocalOps, onSelection, placeholder, label, minRows = 8 }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  // Our own selection as CRDT anchors, so remote edits cannot shift it.
  const anchors = useRef<Selection>(null);
  const [text, setText] = useState(() => doc.text());

  const autosize = () => {
    const el = ta.current!;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const captureSelection = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    const backward = el.selectionDirection === 'backward';
    const anchor = backward ? el.selectionEnd : el.selectionStart;
    const head = backward ? el.selectionStart : el.selectionEnd;
    const sel: Selection = [doc.idBefore(anchor), doc.idBefore(head)];
    const prev = anchors.current;
    anchors.current = sel;
    if (!prev || String(prev) !== String(sel)) onSelection?.(sel);
  }, [doc, onSelection]);

  // Apply outside changes and put the caret back where its anchor now is.
  useLayoutEffect(() => {
    const el = ta.current!;
    const next = doc.text();
    if (el.value !== next) {
      el.value = next;
      const sel = anchors.current;
      if (sel) {
        const a = Math.max(0, doc.posAfter(sel[0]));
        const h = Math.max(0, doc.posAfter(sel[1]));
        el.setSelectionRange(Math.min(a, h), Math.max(a, h), h < a ? 'backward' : 'forward');
      }
    }
    setText(next);
    autosize();
  }, [doc, version]);

  useEffect(() => {
    const onChange = () => {
      if (document.activeElement === ta.current) captureSelection();
    };
    document.addEventListener('selectionchange', onChange);
    window.addEventListener('resize', autosize);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.removeEventListener('resize', autosize);
    };
  }, [captureSelection]);

  const onInput = () => {
    const el = ta.current!;
    const prev = doc.text();
    const next = el.value;
    const { pos, del, ins } = diff(prev, next, el.selectionEnd);
    const ops: Op[] = [...doc.delete(pos, del), ...doc.insert(pos, ins)];
    if (ops.length) onLocalOps(ops);
    setText(next);
    captureSelection();
    autosize();
  };

  const overlay = useMemo(() => renderOverlay(text, cursors, doc), [text, cursors, doc, version]);

  return (
    <div className="editor-surface">
      <div className="editor-backdrop" aria-hidden="true">
        {overlay}
      </div>
      <textarea
        ref={ta}
        className="editor-input"
        defaultValue={text}
        onInput={onInput}
        onSelect={captureSelection}
        onFocus={captureSelection}
        placeholder={placeholder}
        aria-label={label}
        rows={minRows}
        spellCheck={false}
      />
    </div>
  );
}

/** Text is invisible here; only remote selections and carets show through. */
function renderOverlay(text: string, cursors: RemoteCursor[], doc: Doc): ReactNode[] {
  const resolved = cursors.flatMap((c) => {
    if (!c.sel) return [];
    const a = doc.posAfter(c.sel[0]);
    const h = doc.posAfter(c.sel[1]);
    if (a < 0 || h < 0) return []; // anchor not received yet
    return [{ ...c, from: Math.min(a, h, text.length), to: Math.min(Math.max(a, h), text.length), head: Math.min(h, text.length) }];
  });

  const cuts = new Set([0, text.length]);
  for (const c of resolved) cuts.add(c.from).add(c.to).add(c.head);
  const points = [...cuts].sort((x, y) => x - y);

  const out: ReactNode[] = [];
  const carets = (pos: number) => {
    for (const c of resolved) {
      if (c.head !== pos) continue;
      out.push(
        <span key={`caret-${c.site}`} className="remote-caret" style={{ '--peer': c.color } as CSSProperties}>
          <span className="remote-caret-label">{c.name}</span>
        </span>,
      );
    }
  };

  for (let i = 0; i < points.length - 1; i++) {
    const [x, y] = [points[i], points[i + 1]];
    carets(x);
    const sel = resolved.find((c) => c.from <= x && y <= c.to && c.from !== c.to);
    out.push(
      <span key={`seg-${x}`} style={sel ? { background: `${sel.color}33` } : undefined}>
        {text.slice(x, y)}
      </span>,
    );
  }
  carets(text.length);
  // Keeps a trailing empty line tall enough to host a caret.
  out.push('​');
  return out;
}
