import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Doc, Id, Op } from '../../../shared/crdt.ts';
import { canComment as roleCanComment, canEdit as roleCanEdit, type PresenceState, type Selection } from '../../../shared/protocol.ts';
import { api, errorText, type DocDetails, type Suggestion } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Brand } from '../components/Brand.tsx';
import { CollabEditor, plainChange, type ChangeResult, type Decoration, type EditorHandle, type RemoteCursor } from '../components/CollabEditor.tsx';
import { NotificationBell, UserMenu } from '../components/SiteHeader.tsx';
import { Avatar, Dropdown, Icon, Spinner } from '../components/ui.tsx';
import { AiPanel, type AiAction } from '../editor/ai.tsx';
import { formatEdit, type FormatCmd } from '../editor/format.ts';
import { HistoryPanel, type Viewing } from '../editor/history.tsx';
import { CommandPalette, type Command } from '../editor/palette.tsx';
import { ChatPanel, CommentsPanel, NetworkPanel, OutlinePanel, StatsPanel, SuggestionsPanel } from '../editor/panels.tsx';
import { ShareDialog } from '../editor/share.tsx';
import { useSpeech } from '../editor/speech.ts';
import { UndoStack } from '../editor/undo.ts';
import { loadChatHistory, useAuthors, useComments, usePeople, useSuggestions, useVersions } from '../editor/useCollab.ts';
import { useDocSession } from '../editor/useDocSession.ts';
import { exportDocx, exportMarkdown, exportPdf, exportText } from '../lib/exporters.ts';
import { pendingContent } from '../lib/templates.ts';
import { applyEdits, countWords, diffText, renderMarkdown } from '../lib/text.ts';
import { Link, navigate } from '../router.ts';

type PanelId = 'outline' | 'comments' | 'suggestions' | 'chat' | 'history' | 'stats' | 'ai' | 'network';
type ViewMode = 'edit' | 'split' | 'preview';

const PANELS: { id: PanelId; label: string; icon: string }[] = [
  { id: 'outline', label: 'Outline', icon: 'list' },
  { id: 'comments', label: 'Comments', icon: 'comment' },
  { id: 'suggestions', label: 'Suggestions', icon: 'check' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'stats', label: 'Stats', icon: 'chart' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
  { id: 'network', label: 'Network', icon: 'wifi' },
];

const TOOLS: { cmd: FormatCmd; icon?: string; text?: string; label: string; key?: string }[] = [
  { cmd: 'h1', text: 'H1', label: 'Heading 1' },
  { cmd: 'h2', text: 'H2', label: 'Heading 2' },
  { cmd: 'h3', text: 'H3', label: 'Heading 3' },
  { cmd: 'bold', icon: 'bold', label: 'Bold', key: 'Ctrl+B' },
  { cmd: 'italic', icon: 'italic', label: 'Italic', key: 'Ctrl+I' },
  { cmd: 'strike', icon: 'strike', label: 'Strikethrough' },
  { cmd: 'code', icon: 'code', label: 'Inline code', key: 'Ctrl+E' },
  { cmd: 'link', icon: 'link', label: 'Link' },
  { cmd: 'ul', icon: 'ul', label: 'Bulleted list' },
  { cmd: 'ol', icon: 'ol', label: 'Numbered list' },
  { cmd: 'task', icon: 'check', label: 'Checklist' },
  { cmd: 'quote', icon: 'quote', label: 'Quote' },
  { cmd: 'codeblock', text: '{ }', label: 'Code block' },
  { cmd: 'table', icon: 'table', label: 'Table' },
  { cmd: 'hr', icon: 'hr', label: 'Divider' },
];

const STATUS_TEXT = { online: 'Saved', connecting: 'Connecting…', offline: 'Offline' } as const;

const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(`cowrite:pref:${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: unknown) => {
  try {
    localStorage.setItem(`cowrite:pref:${key}`, JSON.stringify(v));
  } catch {
    // ignore
  }
};

export function DocPage({ roomId }: { roomId: string }) {
  const { user, providers } = useAuth();
  const s = useDocSession(roomId);
  const { client, meta, role, cipher, share } = s;
  const editor = useRef<EditorHandle>(null);
  const undo = useRef(new UndoStack());
  const [localVersion, bumpLocal] = useReducer((n: number) => n + 1, 0);

  const [panel, setPanelState] = useState<PanelId | null>(() => (window.innerWidth > 1100 ? readPref<PanelId | null>('panel', 'comments') : null));
  const [view, setView] = useState<ViewMode>(() => readPref<ViewMode>('view', 'edit'));
  const [focus, setFocus] = useState(false);
  const [typewriter, setTypewriter] = useState(() => readPref('typewriter', false));
  const [authorship, setAuthorship] = useState(false);
  const [suggestMode, setSuggestMode] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [follow, setFollow] = useState<string | null>(null);
  const [manualOffline, setManualOffline] = useState(false);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const selRef = useRef<Selection>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; error: string | null; result: { inserted: Id[]; deleted: Id[]; original: string } | null }>({
    busy: false,
    error: null,
    result: null,
  });
  const [chatSeen, setChatSeen] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const sessionStartWords = useRef<number | null>(null);
  const presence = useRef<{ state: PresenceState; typingTimer?: ReturnType<typeof setTimeout>; idleTimer?: ReturnType<typeof setTimeout> }>({ state: 'active' });

  const setPanel = (p: PanelId | null) => {
    setPanelState(p);
    writePref('panel', p);
  };
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const doc: Doc | null = client?.doc ?? null;
  const version = s.docVersion + localVersion;
  const canEdit = roleCanEdit(role) && !viewing;
  const canComment = roleCanComment(role);
  const online = client?.status === 'online';
  const myName = user?.name ?? client?.name ?? 'Guest';
  const myColor = client?.color ?? '#1f3a68';
  const text = useMemo(() => doc?.text() ?? '', [doc, version]);

  if (doc && sessionStartWords.current === null && client?.status === 'online') sessionStartWords.current = countWords(text);

  // Collaboration data (refetched when the server announces changes).
  const comments = useComments(roomId, share, cipher, s.notifyVersion.comments);
  const suggestions = useSuggestions(roomId, share, s.notifyVersion.suggestions, { name: myName, color: myColor, userId: user?.id ?? null });
  const versions = useVersions(roomId, share, s.notifyVersion.versions);
  const authors = useAuthors(roomId, share, s.notifyVersion.members + (client?.peers.size ?? 0));
  const people = usePeople(roomId, share);

  // ------------------------------------------------------------- effects

  useEffect(() => {
    document.title = `${meta?.title ?? 'Document'} · CoWrite`;
  }, [meta?.title]);

  // Chat history once connected.
  useEffect(() => {
    if (!client || !online) return;
    loadChatHistory(roomId, share, cipher)
      .then((history) => s.pushChat(mergeById(history, s.chat)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, online === true]);

  // New documents from a template or an import get their content on first open.
  useEffect(() => {
    if (!client || !doc || !online || !roleCanEdit(role)) return;
    const initial = pendingContent.take(roomId);
    if (initial && doc.length === 0) {
      client.edit(doc.insert(0, initial));
      bumpLocal();
    }
  }, [client, doc, online, role, roomId]);

  // Presence: typing / idle / away.
  useEffect(() => {
    if (!client) return;
    const set = (state: PresenceState, typing = false) => {
      presence.current.state = state;
      client.setPresence(state, typing);
    };
    const onVis = () => set(document.hidden ? 'away' : 'active');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [client]);

  const markActive = useCallback(
    (typing: boolean) => {
      if (!client) return;
      const p = presence.current;
      client.setPresence('active', typing);
      clearTimeout(p.typingTimer);
      clearTimeout(p.idleTimer);
      if (typing) p.typingTimer = setTimeout(() => client.setPresence('active', false), 2500);
      p.idleTimer = setTimeout(() => client.setPresence('idle', false), 60_000);
    },
    [client],
  );

  // Follow mode: keep the followed person's cursor in view.
  useEffect(() => {
    if (!follow) return;
    if (client && !client.peers.has(follow)) {
      setFollow(null);
      return;
    }
    const el = document.querySelector(`.editor-backdrop [data-site="${CSS.escape(follow)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [follow, s.tick, version, client]);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocus((f) => !f);
      } else if (e.key === 'Escape' && !paletteOpen) {
        setFocus(false);
        setFollow(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  useEffect(() => {
    if (panel === 'chat') setChatSeen(s.chat.length);
  }, [panel, s.chat.length]);

  // ----------------------------------------------------------- editing

  const onChange = useCallback(
    (pos: number, del: number, ins: string): ChangeResult | null => {
      if (!client || !doc || !roleCanEdit(role) || viewing) return null;
      setFollow(null);
      markActive(true);
      if (suggestMode) {
        const r = suggestions.suggestChange(doc, pos, del, ins);
        client.edit(r.ops);
        return r;
      }
      const removed = del ? doc.text().slice(pos, pos + del) : '';
      const r = plainChange(doc, pos, del, ins);
      undo.current.record(r.ops, removed);
      client.edit(r.ops);
      return r;
    },
    [client, doc, role, viewing, suggestMode, suggestions, markActive],
  );

  /** Replace a range with minimal edits so untouched characters keep their ids. */
  const replace = useCallback((from: number, to: number, insert: string, select?: [number, number]) => {
    const ed = editor.current;
    if (!ed || !doc) return;
    const old = doc.text().slice(from, to);
    for (const e of diffText(old, insert).sort((a, b) => b.pos - a.pos)) ed.replaceRange(from + e.pos, from + e.pos + e.del, e.ins);
    if (select) ed.setSelection(select[0], select[1]);
  }, [doc]);

  const format = useCallback(
    (cmd: FormatCmd) => {
      const ed = editor.current;
      if (!ed || !doc || !canEdit) return;
      const sel = ed.getSelection();
      const f = formatEdit(doc.text(), sel.start, sel.end, cmd);
      replace(f.from, f.to, f.insert, f.select);
    },
    [doc, canEdit, replace],
  );

  const runUndo = useCallback(
    (redo: boolean) => {
      if (!client || !doc || !canEdit) return;
      const r = redo ? undo.current.redo(doc) : undo.current.undo(doc);
      if (!r) return;
      client.edit(r.ops);
      bumpLocal();
      requestAnimationFrame(() => editor.current?.setSelection(r.caret));
    },
    [client, doc, canEdit],
  );

  const insertAtCursor = useCallback(
    (t: string) => {
      const ed = editor.current;
      if (!ed || !doc) return;
      const { start, end } = ed.getSelection();
      const before = doc.text().slice(0, start);
      const spaced = (before && !/\s$/.test(before) ? ' ' : '') + t;
      ed.replaceRange(start, end, spaced);
    },
    [doc],
  );
  const speech = useSpeech(insertAtCursor);

  const onKeyCommand = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return false;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) return runUndo(false), true;
      if ((k === 'z' && e.shiftKey) || k === 'y') return runUndo(true), true;
      if (k === 'b') return format('bold'), true;
      if (k === 'i') return format('italic'), true;
      if (k === 'e') return format('code'), true;
      if (e.altKey && k === 'm') return setPanel('comments'), true;
      if (k === 's') return setPanel('history'), flash('Name a version in the History panel to save it.'), true;
      return false;
    },
    [runUndo, format],
  );

  const onSelection = useCallback(
    (sel: Selection, r: { start: number; end: number }) => {
      selRef.current = sel;
      setRange(r);
      client?.setSelection(sel);
      markActive(false);
    },
    [client, markActive],
  );

  const restoreText = useCallback(
    (target: string) => {
      if (!client || !doc) return;
      const ops = applyEdits(doc, diffText(doc.text(), target));
      client.edit(ops);
      bumpLocal();
      flash('Restored. Everyone sees the change, and the history keeps every step.');
    },
    [client, doc],
  );

  // ----------------------------------------------------------- comments

  const commentPositions = useMemo(() => {
    const m = new Map<string, number>();
    const ranges = new Map<string, { from: number; to: number }>();
    if (!doc) return { m, ranges };
    for (const c of comments.comments) {
      if (c.parentId || !c.anchorStart || !c.anchorEnd) continue;
      const a = doc.locate(c.anchorStart);
      const b = doc.locate(c.anchorEnd);
      if (!a || !b) continue;
      const to = b.deleted ? b.pos : b.pos + 1;
      if (to <= a.pos) continue;
      m.set(c.id, a.pos);
      ranges.set(c.id, { from: a.pos, to });
    }
    return { m, ranges };
  }, [doc, comments.comments, version]);

  // Clicking inside commented text opens that comment.
  useEffect(() => {
    for (const [id, r] of commentPositions.ranges) {
      if (range.start >= r.from && range.start <= r.to && range.start === range.end) {
        const c = comments.comments.find((x) => x.id === id);
        if (c && !c.resolved) setActiveComment(id);
        return;
      }
    }
  }, [range, commentPositions, comments.comments]);

  const addComment = async (body: string, mentions: string[]) => {
    if (!doc || range.end <= range.start) return;
    const anchorStart = doc.idAt(range.start);
    const anchorEnd = doc.idAt(range.end - 1);
    await comments.add({ anchorStart, anchorEnd, quote: doc.text().slice(range.start, range.end), body, mentions, name: myName, color: myColor });
  };

  // --------------------------------------------------------------- AI

  const runAi = async (action: AiAction, instruction?: string) => {
    if (!doc) return;
    setAi({ busy: true, error: null, result: null });
    const sel = selRef.current ?? [doc.idBefore(doc.length), doc.idBefore(doc.length)];
    try {
      const r = await api<{ inserted: Id[]; deleted: Id[]; original: string }>(`/docs/${roomId}/ai`, {
        method: 'POST',
        share,
        body: { action, selection: action === 'continue' ? [sel[1], sel[1]] : sel, instruction },
      });
      setAi({ busy: false, error: null, result: r });
    } catch (e) {
      setAi({ busy: false, error: errorText(e), result: null });
    }
  };

  const undoAi = () => {
    if (!client || !doc || !ai.result) return;
    const { inserted, deleted, original } = ai.result;
    const ops: Op[] = [...doc.deleteIds(inserted)];
    if (deleted.length && original) {
      const at = doc.locate(deleted[0])?.pos ?? doc.length;
      ops.push(...doc.insert(Math.min(at, doc.length), original));
    }
    client.edit(ops);
    bumpLocal();
    setAi({ busy: false, error: null, result: null });
  };

  // ------------------------------------------------------- decorations

  const authorColor = useMemo(() => {
    const m = new Map(authors.map((a) => [a.site, a.color]));
    if (client) m.set(client.doc.site, myColor);
    for (const p of client?.peers.values() ?? []) m.set(p.site, p.color);
    return m;
  }, [authors, client, myColor, s.tick]);

  const decorations = useMemo<Decoration[]>(() => {
    if (!doc) return [];
    const out: Decoration[] = [];
    if (authorship) {
      let pos = 0;
      for (const run of doc.runs()) {
        out.push({ from: pos, to: pos + run.text.length, kind: 'author', color: authorColor.get(run.site) ?? '#9aa0a6' });
        pos += run.text.length;
      }
    }
    for (const sg of suggestions.suggestions) {
      if (sg.status !== 'open') continue;
      for (const r of doc.rangesOf(new Set(sg.keys))) out.push({ ...r, kind: sg.kind === 'insert' ? 'sugg-ins' : 'sugg-del', color: sg.color });
    }
    for (const [id, r] of commentPositions.ranges) {
      const c = comments.comments.find((x) => x.id === id);
      if (c && !c.resolved) out.push({ ...r, kind: id === activeComment ? 'comment-active' : 'comment' });
    }
    return out;
  }, [doc, version, authorship, authorColor, suggestions.suggestions, suggestions.localTick, commentPositions, comments.comments, activeComment]);

  const cursors: RemoteCursor[] = client ? [...client.peers.values()] : [];

  // ---------------------------------------------------------- commands

  const exportAs = async (kind: 'pdf' | 'docx' | 'md' | 'txt') => {
    const title = meta?.title ?? 'Untitled document';
    try {
      if (kind === 'pdf') await exportPdf(title, text);
      else if (kind === 'docx') await exportDocx(title, text);
      else if (kind === 'md') exportMarkdown(title, text);
      else exportText(title, text);
    } catch (e) {
      flash(`Export failed: ${(e as Error).message}`);
    }
  };

  const fork = async () => {
    try {
      const r = await api<{ document: DocDetails }>(`/docs/${roomId}/fork`, { method: 'POST', share });
      navigate(`/d/${r.document.id}${window.location.hash}`);
    } catch (e) {
      flash(errorText(e));
    }
  };

  const toggleOffline = (off: boolean) => {
    if (!client) return;
    if (off) client.disconnect();
    else client.connect();
    setManualOffline(off);
  };

  const commands: Command[] = [
    ...TOOLS.map((t) => ({ id: `fmt-${t.cmd}`, group: 'Format', label: t.label, shortcut: t.key, disabled: !canEdit, run: () => format(t.cmd) })),
    { id: 'undo', group: 'Edit', label: 'Undo my last change', shortcut: 'Ctrl+Z', disabled: !canEdit, run: () => runUndo(false) },
    { id: 'redo', group: 'Edit', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canEdit, run: () => runUndo(true) },
    { id: 'suggest', group: 'Edit', label: suggestMode ? 'Stop suggesting (edit directly)' : 'Start suggesting mode', disabled: !roleCanEdit(role), run: () => setSuggestMode(!suggestMode) },
    { id: 'voice', group: 'Edit', label: speech.listening ? 'Stop voice typing' : 'Start voice typing', disabled: !speech.supported || !canEdit, run: () => (speech.listening ? speech.stop() : speech.start()) },
    ...PANELS.map((p) => ({ id: `panel-${p.id}`, group: 'Panels', label: `Open ${p.label}`, run: () => setPanel(p.id) })),
    { id: 'view-edit', group: 'View', label: 'Editor only', run: () => changeView('edit') },
    { id: 'view-split', group: 'View', label: 'Editor and preview side by side', run: () => changeView('split') },
    { id: 'view-preview', group: 'View', label: 'Preview only', run: () => changeView('preview') },
    { id: 'focus', group: 'View', label: focus ? 'Exit focus mode' : 'Focus mode', shortcut: 'Ctrl+Shift+F', run: () => setFocus(!focus) },
    { id: 'typewriter', group: 'View', label: typewriter ? 'Turn off typewriter scrolling' : 'Typewriter scrolling', run: () => toggleTypewriter() },
    { id: 'authors', group: 'View', label: authorship ? 'Hide author colours' : 'Show who wrote what', run: () => setAuthorship(!authorship) },
    { id: 'replay', group: 'History', label: 'Replay how this document was written', run: () => setPanel('history') },
    { id: 'fork', group: 'History', label: 'Fork this document', disabled: !user || !meta, run: () => void fork() },
    { id: 'share', group: 'Document', label: 'Share…', run: () => setShareOpen(true) },
    { id: 'pdf', group: 'Export', label: 'Download as PDF', run: () => void exportAs('pdf') },
    { id: 'docx', group: 'Export', label: 'Download as Word (.docx)', run: () => void exportAs('docx') },
    { id: 'md', group: 'Export', label: 'Download as Markdown', run: () => void exportAs('md') },
    { id: 'txt', group: 'Export', label: 'Download as plain text', run: () => void exportAs('txt') },
    { id: 'ai-continue', group: 'AI', label: 'Claude: continue writing', disabled: !providers.ai || !canEdit, run: () => (setPanel('ai'), void runAi('continue')) },
    { id: 'ai-summary', group: 'AI', label: 'Claude: summarize document', disabled: !providers.ai || !canEdit, run: () => (setPanel('ai'), void runAi('summarize')) },
    { id: 'offline', group: 'Network', label: manualOffline ? 'Reconnect' : 'Go offline (simulate)', run: () => toggleOffline(!manualOffline) },
    { id: 'docs', group: 'Go to', label: 'My documents', disabled: !user, run: () => navigate('/documents') },
    { id: 'home', group: 'Go to', label: 'Home page', run: () => navigate('/') },
  ];

  function changeView(v: ViewMode) {
    setView(v);
    writePref('view', v);
  }
  function toggleTypewriter() {
    setTypewriter(!typewriter);
    writePref('typewriter', !typewriter);
  }

  // ------------------------------------------------------------ render

  if (s.fatal) {
    return (
      <div className="page center-page">
        <div className="panel narrow-card">
          <Brand />
          <h1>Cannot open this document</h1>
          <p>{s.fatal}</p>
          <div className="row-actions">
            <Link className="btn btn-primary" to={user ? '/documents' : '/'}>
              {user ? 'My documents' : 'Home'}
            </Link>
            {!user && (
              <Link className="btn btn-outline" to={`/signin?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (!client || !doc) return <Spinner label="Opening document…" />;

  const status = client.status === 'online' && client.pending > 0 ? 'Saving…' : STATUS_TEXT[client.status];
  const unreadChat = Math.max(0, s.chat.length - chatSeen);
  const openComments = comments.comments.filter((c) => !c.parentId && !c.resolved).length;
  const openSuggestions = suggestions.suggestions.filter((x) => x.status === 'open').length;
  const counts: Partial<Record<PanelId, number>> = { comments: openComments, suggestions: openSuggestions, chat: panel === 'chat' ? 0 : unreadChat };

  const titleInput = meta && role === 'owner' && (
    <input
      className="doc-title-input"
      defaultValue={meta.title}
      key={meta.title}
      maxLength={120}
      onBlur={async (e) => {
        const t = e.target.value.trim() || 'Untitled document';
        if (t === meta.title) return;
        try {
          const r = await api<{ document: DocDetails }>(`/docs/${roomId}`, { method: 'PATCH', body: { title: t } });
          s.setMeta({ ...meta, title: r.document.title });
        } catch (err) {
          flash(errorText(err));
        }
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      aria-label="Document title"
    />
  );

  const panelBody = (() => {
    switch (panel) {
      case 'outline':
        return <OutlinePanel text={text} onJump={(pos) => editor.current?.setSelection(pos)} />;
      case 'comments':
        return (
          <CommentsPanel
            comments={comments.comments}
            activeId={activeComment}
            setActive={setActiveComment}
            canComment={canComment}
            selectionQuote={range.end > range.start ? text.slice(range.start, range.end) : ''}
            people={people}
            userId={user?.id ?? null}
            isOwner={role === 'owner'}
            positions={commentPositions.m}
            onAdd={addComment}
            onReply={(parentId, body, mentions) => comments.add({ parentId, body, mentions, name: myName, color: myColor })}
            onResolve={(id, resolved) => void comments.update(id, { resolved })}
            onDelete={(id) => void comments.remove(id)}
            onJump={(id) => {
              const r = commentPositions.ranges.get(id);
              if (r) editor.current?.setSelection(r.from, r.to);
            }}
          />
        );
      case 'suggestions':
        return (
          <SuggestionsPanel
            suggestions={suggestions.suggestions}
            doc={doc}
            canSuggest={roleCanEdit(role)}
            canResolve={roleCanEdit(role)}
            suggestMode={suggestMode}
            setSuggestMode={setSuggestMode}
            onResolve={async (sg: Suggestion, accept: boolean) => {
              const ops = await suggestions.resolve(doc, sg, accept);
              if (ops.length) {
                client.edit(ops);
                bumpLocal();
              }
            }}
            onJump={(sg) => {
              const r = doc.rangesOf(new Set(sg.keys))[0];
              if (r) editor.current?.setSelection(r.from, r.to);
            }}
          />
        );
      case 'chat':
        return <ChatPanel messages={s.chat} onSend={(b) => client.sendChat(b)} canChat={online} people={people} myName={myName} />;
      case 'history':
        return (
          <HistoryPanel
            doc={doc}
            docVersion={version}
            docId={roomId}
            share={share}
            cipher={cipher}
            meta={meta}
            versions={versions.versions}
            canEdit={roleCanEdit(role)}
            signedIn={!!user}
            online={online}
            onSaveVersion={async (name) => {
              await api(`/docs/${roomId}/versions`, { method: 'POST', share, body: { name, authorName: myName } });
              versions.reload();
              flash('Version saved.');
            }}
            onDeleteVersion={async (id) => {
              await api(`/docs/${roomId}/versions/${id}`, { method: 'DELETE', share });
              versions.reload();
            }}
            onView={setViewing}
            onRestoreText={restoreText}
            onFork={fork}
          />
        );
      case 'stats':
        return (
          <StatsPanel
            text={text}
            doc={doc}
            authors={authors}
            goal={meta?.wordGoal ?? readPref<number | null>(`goal:${roomId}`, null)}
            canSetGoal
            onSetGoal={async (goal) => {
              if (meta && role === 'owner') {
                const r = await api<{ document: DocDetails }>(`/docs/${roomId}`, { method: 'PATCH', body: { wordGoal: goal } });
                s.setMeta({ ...meta, wordGoal: r.document.wordGoal });
              } else {
                writePref(`goal:${roomId}`, goal);
                bumpLocal();
              }
            }}
            sessionStartWords={sessionStartWords.current ?? countWords(text)}
          />
        );
      case 'ai':
        return (
          <AiPanel
            enabled={providers.ai}
            encrypted={!!meta?.encrypted || client.encrypted}
            canEdit={canEdit}
            online={online}
            hasSelection={range.end > range.start}
            busy={ai.busy}
            error={ai.error}
            outcome={ai.result ? { inserted: ai.result.inserted.length, replaced: ai.result.deleted.length } : null}
            onRun={(a, i) => void runAi(a, i)}
            onKeep={() => setAi({ busy: false, error: null, result: null })}
            onUndo={undoAi}
          />
        );
      case 'network':
        return <NetworkPanel client={client} manualOffline={manualOffline} setOffline={toggleOffline} />;
      default:
        return null;
    }
  })();

  const editorEl = (
    <article className={`paper ${suggestMode ? 'suggesting' : ''}`}>
      <CollabEditor
        handleRef={editor}
        doc={doc}
        version={version}
        cursors={cursors}
        decorations={decorations}
        onChange={onChange}
        onSelection={onSelection}
        onKeyCommand={onKeyCommand}
        readOnly={!canEdit}
        typewriter={typewriter}
        placeholder={canEdit ? 'Start writing… Markdown works: # Heading, **bold**, - list. Press Ctrl+K for commands.' : 'This document is empty.'}
        label="Document text"
        minRows={24}
      />
    </article>
  );

  return (
    <div className={`docpage ${focus ? 'focus-mode' : ''} ${panel ? 'with-panel' : ''}`}>
      {!focus && (
        <header className="doc-header">
          <div className="doc-header-left">
            <Brand compact />
            <div className="doc-title-block">
              {titleInput || <span className="doc-title">{meta?.title ?? 'Untitled document'}</span>}
              <span className="doc-sub">
                {meta?.encrypted && (
                  <span className="pill pill-lock">
                    <Icon name="lock" size={12} /> End-to-end encrypted
                  </span>
                )}
                {role && role !== 'owner' && role !== 'editor' && <span className="pill">{role === 'viewer' ? 'View only' : 'Can comment'}</span>}
                {meta?.parentId && (
                  <span className="pill">
                    <Icon name="branch" size={12} /> Fork
                  </span>
                )}
                <span className="muted small">
                  {meta ? (role === 'owner' ? 'Owned by you' : `Owned by ${meta.ownerName}`) : 'Guest document · anyone with the link can edit'}
                </span>
                {user && (
                  <Link className="small" to="/documents">
                    My documents
                  </Link>
                )}
              </span>
            </div>
          </div>
          <div className="doc-header-right">
            <div className="presence" aria-label={`${cursors.length + 1} people here`}>
              {cursors.slice(0, 5).map((p) => {
                const peer = client.peers.get(p.site);
                return (
                  <button
                    key={p.site}
                    className={`presence-btn ${follow === p.site ? 'following' : ''} state-${peer?.state ?? 'active'}`}
                    onClick={() => setFollow(follow === p.site ? null : p.site)}
                    title={`${p.name}${peer?.typing ? ' (typing…)' : peer?.state === 'away' ? ' (away)' : peer?.state === 'idle' ? ' (idle)' : ''} · click to follow`}
                    type="button"
                  >
                    <Avatar name={p.name} color={p.color} size={30} />
                    {peer?.typing && <span className="typing-dot" />}
                  </button>
                );
              })}
              {cursors.length > 5 && <span className="avatar more">+{cursors.length - 5}</span>}
              <Avatar name={myName} src={user?.avatar} color={myColor} size={30} title={`${myName} (you)`} />
            </div>
            <span className={`status-pill ${client.status}`} role="status" title={s.secondaryTab ? 'Open in another tab: offline copy disabled here' : 'Changes save automatically'}>
              <span className="dot" />
              {status}
              {client.status !== 'online' && client.pending > 0 && <span className="pending"> · {client.pending} unsynced</span>}
            </span>
            <button className="btn btn-primary btn-sm" onClick={() => setShareOpen(true)} type="button">
              <Icon name="share" size={15} /> Share
            </button>
            <NotificationBell />
            {user ? (
              <UserMenu />
            ) : (
              <Link className="btn btn-outline btn-sm" to={`/signin?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`}>
                Sign in
              </Link>
            )}
          </div>
        </header>
      )}

      {!focus && (
        <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
          <div className="tool-group">
            <button className="tool" onClick={() => runUndo(false)} disabled={!canEdit} title="Undo my last change (Ctrl+Z)" aria-label="Undo" type="button">
              <Icon name="undo" />
            </button>
            <button className="tool" onClick={() => runUndo(true)} disabled={!canEdit} title="Redo (Ctrl+Y)" aria-label="Redo" type="button">
              <Icon name="redo" />
            </button>
          </div>
          <div className="tool-group tools-format">
            {TOOLS.map((t) => (
              <button
                key={t.cmd}
                className="tool"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => format(t.cmd)}
                disabled={!canEdit}
                title={`${t.label}${t.key ? ` (${t.key})` : ''}`}
                aria-label={t.label}
                type="button"
              >
                {t.icon ? <Icon name={t.icon} /> : <span className="tool-text">{t.text}</span>}
              </button>
            ))}
          </div>
          <div className="tool-group">
            <button
              className={`tool ${suggestMode ? 'on' : ''}`}
              onClick={() => setSuggestMode(!suggestMode)}
              disabled={!roleCanEdit(role)}
              title="Suggesting mode: edits become suggestions"
              type="button"
            >
              <Icon name="check" /> <span className="tool-label">{suggestMode ? 'Suggesting' : 'Editing'}</span>
            </button>
            <button className={`tool ${authorship ? 'on' : ''}`} onClick={() => setAuthorship(!authorship)} title="Colour text by author" aria-pressed={authorship} type="button">
              <Icon name="users" /> <span className="tool-label">Authors</span>
            </button>
            <button
              className={`tool ${speech.listening ? 'on recording' : ''}`}
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              disabled={!speech.supported || !canEdit}
              title={speech.supported ? 'Voice typing' : 'Voice typing is not supported in this browser'}
              aria-pressed={speech.listening}
              type="button"
            >
              <Icon name="mic" /> <span className="tool-label">{speech.listening ? 'Listening…' : 'Voice'}</span>
            </button>
          </div>
          <div className="tool-group view-switch" role="radiogroup" aria-label="View">
            {(['edit', 'split', 'preview'] as ViewMode[]).map((v) => (
              <button key={v} className={`tool ${view === v ? 'on' : ''}`} onClick={() => changeView(v)} role="radio" aria-checked={view === v} type="button">
                <span className="tool-label always">{v === 'edit' ? 'Write' : v === 'split' ? 'Split' : 'Preview'}</span>
              </button>
            ))}
          </div>
          <div className="tool-group">
            <button className="tool" onClick={() => setFocus(true)} title="Focus mode (Ctrl+Shift+F)" aria-label="Focus mode" type="button">
              <Icon name="focus" />
            </button>
            <button className={`tool ${typewriter ? 'on' : ''}`} onClick={toggleTypewriter} title="Typewriter scrolling" aria-pressed={typewriter} type="button">
              <Icon name="keyboard" />
            </button>
            <Dropdown className="tool" ariaLabel="Export" label={<Icon name="download" />}>
              {(close) => (
                <>
                  {(['pdf', 'docx', 'md', 'txt'] as const).map((k) => (
                    <button
                      key={k}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        close();
                        void exportAs(k);
                      }}
                    >
                      {k === 'pdf' ? 'PDF document' : k === 'docx' ? 'Word document (.docx)' : k === 'md' ? 'Markdown (.md)' : 'Plain text (.txt)'}
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
            <button className="tool" onClick={() => setPaletteOpen(true)} title="All commands (Ctrl+K)" aria-label="Command palette" type="button">
              <span className="tool-text">⌘K</span>
            </button>
          </div>
        </div>
      )}

      {(follow || speech.listening || speech.error || client.error || s.secondaryTab || viewing) && !focus && (
        <div className="doc-banners">
          {follow && (
            <div className="banner info">
              Following {client.peers.get(follow)?.name ?? 'collaborator'}.{' '}
              <button className="link-button" onClick={() => setFollow(null)} type="button">
                Stop following
              </button>
            </div>
          )}
          {speech.listening && <div className="banner info">🎙 Listening… {speech.interim && <em className="muted">“{speech.interim}”</em>}</div>}
          {speech.error && <div className="banner error">{speech.error}</div>}
          {client.error && <div className="banner error">{client.error}</div>}
          {s.secondaryTab && <div className="banner info">This document is open in another tab, so this tab will not keep an offline copy.</div>}
          {viewing && (
            <div className="banner info">
              <strong>{viewing.title}</strong> · read-only view.{' '}
              {viewing.restore && (
                <button className="btn btn-primary btn-sm" onClick={viewing.restore} type="button">
                  Restore this
                </button>
              )}{' '}
              <button className="btn btn-outline btn-sm" onClick={() => setViewing(null)} type="button">
                Back to live document
              </button>
            </div>
          )}
        </div>
      )}

      <div className="doc-body">
        <main className={`doc-main view-${viewing ? 'viewing' : view}`}>
          {viewing ? (
            <article className="paper readonly-view">
              <ColoredText doc={viewing.doc} colors={authorColor} />
            </article>
          ) : (
            <>
              {view !== 'preview' && editorEl}
              {view !== 'edit' && (
                <article className="paper markdown-preview" aria-label="Preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) || '<p class="muted">Nothing to preview yet.</p>' }} />
              )}
            </>
          )}
          <p className="doc-stats muted small">
            {countWords(text).toLocaleString()} words · {text.length.toLocaleString()} characters
            {suggestMode && ' · Suggesting'}
          </p>
        </main>

        {!focus && (
          <aside className={`side ${panel ? 'open' : ''}`} aria-label="Side panels">
            <nav className="rail" aria-label="Panels">
              {PANELS.map((p) => (
                <button
                  key={p.id}
                  className={panel === p.id ? 'rail-btn active' : 'rail-btn'}
                  onClick={() => setPanel(panel === p.id ? null : p.id)}
                  aria-pressed={panel === p.id}
                  title={p.label}
                  type="button"
                >
                  <Icon name={p.icon} />
                  <span>{p.label}</span>
                  {!!counts[p.id] && <span className="badge">{counts[p.id]}</span>}
                </button>
              ))}
            </nav>
            {panel && (
              <section className="panel-body" aria-label={PANELS.find((p) => p.id === panel)?.label}>
                <header className="panel-head">
                  <h2>{PANELS.find((p) => p.id === panel)?.label}</h2>
                  <button className="modal-close" onClick={() => setPanel(null)} aria-label="Close panel" type="button">
                    ×
                  </button>
                </header>
                {panelBody}
              </section>
            )}
          </aside>
        )}
      </div>

      {focus && (
        <button className="focus-exit btn btn-outline btn-sm" onClick={() => setFocus(false)} type="button">
          Exit focus (Esc)
        </button>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {shareOpen && <ShareDialog docId={roomId} meta={meta} role={role} share={share} onClose={() => setShareOpen(false)} onMetaChange={s.setMeta} />}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))];
}

/** Read-only rendering of a document state, coloured by author (replay, versions). */
function ColoredText({ doc, colors }: { doc: Doc; colors: Map<string, string> }) {
  const runs = doc.runs();
  return (
    <div className="colored-text">
      {runs.map((r, i) => (
        <span key={i} style={{ background: `${colors.get(r.site) ?? '#9aa0a6'}22` }}>
          {r.text}
        </span>
      ))}
      {!runs.length && <span className="muted">(empty)</span>}
    </div>
  );
}

