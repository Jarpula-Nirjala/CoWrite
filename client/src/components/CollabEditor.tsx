import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import type { Doc, Op } from '../../../shared/crdt.ts';
import type { Selection } from '../../../shared/protocol.ts';

export interface RemoteCursor {
  site: string;
  name: string;
  color: string;
  sel: Selection;
}

/** A highlighted range of visible text. */
export interface Decoration {
  from: number;
  to: number;
  kind: 'author' | 'comment' | 'comment-active' | 'sugg-ins' | 'sugg-del' | 'search';
  color?: string;
}

export interface EditorHandle {
  /** Replace [from, to) with text, going through the same path as typing. */
  replaceRange(from: number, to: number, text: string, select?: [number, number]): void;
  getSelection(): { start: number; end: number };
  setSelection(start: number, end?: number): void;
  focus(): void;
  /** Scroll so the caret sits in the middle of the window. */
  revealCaret(): void;
}

export interface ChangeResult {
  ops: Op[];
  /** Where to put the caret afterwards. */
  caret: number;
}

interface Props {
  doc: Doc;
  /** Bump whenever `doc` changed from outside this editor. */
  version: number;
  cursors: RemoteCursor[];
  decorations?: Decoration[];
  /**
   * Turns a text change into CRDT ops (the parent decides: plain edit,
   * suggestion, ...). Return null to reject the change.
   */
  onChange(pos: number, del: number, ins: string): ChangeResult | null;
  onSelection?(sel: Selection, range: { start: number; end: number }): void;
  /** Return true when the key was handled (prevents the default). */
  onKeyCommand?(e: KeyboardEvent<HTMLTextAreaElement>): boolean;
  readOnly?: boolean;
  typewriter?: boolean;
  placeholder?: string;
  label: string;
  minRows?: number;
  handleRef?: Ref<EditorHandle>;
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

/** Plain editing: what the playground and simple editors use. */
export function plainChange(doc: Doc, pos: number, del: number, ins: string): ChangeResult {
  return { ops: [...doc.delete(pos, del), ...doc.insert(pos, ins)], caret: pos + ins.length };
}

export function CollabEditor(props: Props) {
  const { doc, version, cursors, decorations, onChange, onSelection, onKeyCommand, readOnly, typewriter, placeholder, label, minRows = 8, handleRef } = props;
  const ta = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  // Our own selection as CRDT anchors, so remote edits cannot shift it.
  const anchors = useRef<Selection>(null);
  const [text, setText] = useState(() => doc.text());
  const [caret, setCaret] = useState(0);

  const autosize = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const revealCaret = useCallback(() => {
    requestAnimationFrame(() => {
      const marker = backdrop.current?.querySelector('[data-own-caret]');
      if (!marker) return;
      const rect = marker.getBoundingClientRect();
      window.scrollBy({ top: rect.top - window.innerHeight * 0.45 });
    });
  }, []);

  const captureSelection = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    const backward = el.selectionDirection === 'backward';
    const anchor = backward ? el.selectionEnd : el.selectionStart;
    const head = backward ? el.selectionStart : el.selectionEnd;
    const sel: Selection = [doc.idBefore(anchor), doc.idBefore(head)];
    const prev = anchors.current;
    anchors.current = sel;
    setCaret(el.selectionEnd);
    if (!prev || String(prev) !== String(sel)) onSelection?.(sel, { start: el.selectionStart, end: el.selectionEnd });
  }, [doc, onSelection]);

  /** Make the textarea show the doc's text with the caret at `pos`. */
  const syncTo = useCallback(
    (selStart: number, selEnd = selStart) => {
      const el = ta.current!;
      const next = doc.text();
      if (el.value !== next) el.value = next;
      el.setSelectionRange(Math.min(selStart, next.length), Math.min(selEnd, next.length));
      setText(next);
      autosize();
    },
    [doc],
  );

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
        setCaret(el.selectionEnd);
      }
    }
    setText(next);
    autosize();
  }, [doc, version]);

  useEffect(() => {
    const onDocSelection = () => {
      if (document.activeElement === ta.current) captureSelection();
    };
    document.addEventListener('selectionchange', onDocSelection);
    window.addEventListener('resize', autosize);
    return () => {
      document.removeEventListener('selectionchange', onDocSelection);
      window.removeEventListener('resize', autosize);
    };
  }, [captureSelection]);

  const applyChange = useCallback(
    (pos: number, del: number, ins: string, select?: [number, number]) => {
      const result = onChange(pos, del, ins);
      const el = ta.current!;
      if (!result) {
        syncTo(pos);
        return;
      }
      if (select) syncTo(select[0], select[1]);
      else if (el.value !== doc.text() || el.selectionEnd !== result.caret) syncTo(result.caret);
      else {
        setText(el.value);
        autosize();
      }
      captureSelection();
      if (typewriter) revealCaret();
    },
    [onChange, syncTo, doc, captureSelection, typewriter, revealCaret],
  );

  const onInput = () => {
    const el = ta.current!;
    const { pos, del, ins } = diff(doc.text(), el.value, el.selectionEnd);
    if (!del && !ins) return;
    applyChange(pos, del, ins);
  };

  useImperativeHandle(
    handleRef,
    () => ({
      replaceRange(from, to, text, select) {
        if (readOnly) return;
        ta.current?.focus();
        applyChange(from, to - from, text, select);
      },
      getSelection: () => ({ start: ta.current?.selectionStart ?? 0, end: ta.current?.selectionEnd ?? 0 }),
      setSelection(start, end = start) {
        const el = ta.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(start, end);
        captureSelection();
        revealCaret();
      },
      focus: () => ta.current?.focus(),
      revealCaret,
    }),
    [applyChange, captureSelection, revealCaret, readOnly],
  );

  const overlay = useMemo(() => renderOverlay(text, cursors, decorations ?? [], doc, caret), [text, cursors, decorations, doc, version, caret]);

  return (
    <div className="editor-surface">
      <div className="editor-backdrop" aria-hidden="true" ref={backdrop}>
        {overlay}
      </div>
      <textarea
        ref={ta}
        className="editor-input"
        defaultValue={text}
        onInput={onInput}
        onSelect={() => {
          captureSelection();
          if (typewriter) revealCaret();
        }}
        onFocus={captureSelection}
        onKeyDown={(e) => {
          if (onKeyCommand?.(e)) e.preventDefault();
        }}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-label={label}
        rows={minRows}
        spellCheck
      />
    </div>
  );
}

interface Span {
  from: number;
  to: number;
  bg?: string;
  priority: number;
  underline?: string;
  strike?: string;
}

const PRIORITY = { author: 1, search: 2, 'sugg-ins': 3, 'sugg-del': 3, comment: 4, selection: 5, 'comment-active': 6 } as const;

/** Text is invisible here; only highlights, remote selections and carets show through. */
function renderOverlay(text: string, cursors: RemoteCursor[], decorations: Decoration[], doc: Doc, ownCaret: number): ReactNode[] {
  const len = text.length;
  const spans: Span[] = [];
  for (const d of decorations) {
    const from = Math.max(0, Math.min(d.from, len));
    const to = Math.max(from, Math.min(d.to, len));
    if (to <= from) continue;
    switch (d.kind) {
      case 'author':
        spans.push({ from, to, bg: `${d.color}26`, priority: PRIORITY.author });
        break;
      case 'search':
        spans.push({ from, to, bg: '#f5c84a88', priority: PRIORITY.search });
        break;
      case 'sugg-ins':
        spans.push({ from, to, bg: `${d.color ?? '#2e7d5b'}22`, underline: d.color ?? '#2e7d5b', priority: PRIORITY['sugg-ins'] });
        break;
      case 'sugg-del':
        spans.push({ from, to, bg: '#b3261e14', strike: '#b3261e', priority: PRIORITY['sugg-del'] });
        break;
      case 'comment':
        spans.push({ from, to, bg: '#f5c84a55', priority: PRIORITY.comment });
        break;
      case 'comment-active':
        spans.push({ from, to, bg: '#f5c84aaa', priority: PRIORITY['comment-active'] });
        break;
    }
  }

  const carets: { pos: number; site: string; name: string; color: string }[] = [];
  for (const c of cursors) {
    if (!c.sel) continue;
    const a = doc.posAfter(c.sel[0]);
    const h = doc.posAfter(c.sel[1]);
    if (a < 0 || h < 0) continue; // anchor not received yet
    const from = Math.min(a, h, len);
    const to = Math.min(Math.max(a, h), len);
    if (to > from) spans.push({ from, to, bg: `${c.color}33`, priority: PRIORITY.selection });
    carets.push({ pos: Math.min(h, len), site: c.site, name: c.name, color: c.color });
  }

  const cuts = new Set([0, len, Math.min(ownCaret, len)]);
  for (const s of spans) cuts.add(s.from).add(s.to);
  for (const c of carets) cuts.add(c.pos);
  const points = [...cuts].sort((x, y) => x - y);

  const out: ReactNode[] = [];
  const marks = (pos: number) => {
    if (pos === ownCaret) out.push(<span key={`own-${pos}`} data-own-caret="" />);
    for (const c of carets) {
      if (c.pos !== pos) continue;
      out.push(
        <span key={`caret-${c.site}`} className="remote-caret" data-site={c.site} style={{ '--peer': c.color } as CSSProperties}>
          <span className="remote-caret-label">{c.name}</span>
        </span>,
      );
    }
  };

  for (let i = 0; i < points.length - 1; i++) {
    const [x, y] = [points[i], points[i + 1]];
    marks(x);
    let bg: Span | undefined;
    let underline: string | undefined;
    let strike: string | undefined;
    for (const s of spans) {
      if (s.from > x || s.to < y) continue;
      if (s.bg && (!bg || s.priority > bg.priority)) bg = s;
      underline ??= s.underline;
      strike ??= s.strike;
    }
    const style: CSSProperties | undefined =
      bg || underline || strike
        ? {
            background: bg?.bg,
            textDecorationLine: [underline && 'underline', strike && 'line-through'].filter(Boolean).join(' ') || undefined,
            textDecorationColor: strike ?? underline,
            textDecorationThickness: underline || strike ? '2px' : undefined,
          }
        : undefined;
    out.push(
      <span key={`seg-${x}`} style={style}>
        {text.slice(x, y)}
      </span>,
    );
  }
  marks(len);
  // Keeps a trailing empty line tall enough to host a caret.
  out.push('​');
  return out;
}
