import type { EditorState } from 'prosemirror-state';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Doc, Id, Op, Token } from '../../../shared/crdt.ts';
import { canComment as roleCanComment, canEdit as roleCanEdit, type PresenceState, type Selection } from '../../../shared/protocol.ts';
import { blocksOf, plainText } from '../../../shared/rich.ts';
import { api, errorText, type DocDetails, type Suggestion } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Brand } from '../components/Brand.tsx';
import type { RemoteCursor } from '../components/CollabEditor.tsx';
import { NotificationBell, UserMenu } from '../components/SiteHeader.tsx';
import { Avatar, Dropdown, Icon, Spinner } from '../components/ui.tsx';
import { AiPanel, type AiAction } from '../editor/ai.tsx';
import { HistoryPanel, type Viewing } from '../editor/history.tsx';
import { ImageSearch } from '../editor/imageSearch.tsx';
import { PagePanel } from '../editor/pagePanel.tsx';
import { CommandPalette, type Command } from '../editor/palette.tsx';
import { ChatPanel, CommentsPanel, NetworkPanel, OutlinePanel, StatsPanel, SuggestionsPanel } from '../editor/panels.tsx';
import { ShareDialog } from '../editor/share.tsx';
import { useSpeech } from '../editor/speech.ts';
import { UndoStack } from '../editor/undo.ts';
import { loadChatHistory, useAuthors, useComments, usePeople, useSuggestions, useVersions } from '../editor/useCollab.ts';
import { useDocSession } from '../editor/useDocSession.ts';
import { createFileCipher } from '../lib/e2e.ts';
import { exportDocx, exportMarkdown, exportPdf, exportText } from '../lib/exporters.ts';
import { pendingContent } from '../lib/templates.ts';
import { countWords } from '../lib/text.ts';
import { setBlock } from '../rich/commands.ts';
import { attrsKey, diffTokens, flatten, tokensToDoc, type FlatToken } from '../rich/convert.ts';
import { RichEditor, type RangeDeco, type RichHandle } from '../rich/RichEditor.tsx';
import { RichToolbar } from '../rich/RichToolbar.tsx';
import { DEFAULT_SETTINGS, paperProps, printCss, readSettings, settingsOps, type DocSettings } from '../rich/settings.ts';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import { Link, navigate } from '../router.ts';

type PanelId = 'outline' | 'comments' | 'suggestions' | 'chat' | 'history' | 'stats' | 'page' | 'ai' | 'network';

const PANELS: { id: PanelId; label: string; icon: string }[] = [
  { id: 'outline', label: 'Outline', icon: 'list' },
  { id: 'comments', label: 'Comments', icon: 'comment' },
  { id: 'suggestions', label: 'Suggest', icon: 'check' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'page', label: 'Page', icon: 'file' },
  { id: 'stats', label: 'Stats', icon: 'chart' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
  { id: 'network', label: 'Network', icon: 'wifi' },
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
  const { client, meta, role, cipher, share, keyText } = s;
  const editor = useRef<RichHandle>(null);
  const undo = useRef(new UndoStack());
  const [localVersion, bumpLocal] = useReducer((n: number) => n + 1, 0);
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  const [panel, setPanelState] = useState<PanelId | null>(() => (window.innerWidth > 1180 ? readPref<PanelId | null>('panel', 'outline') : null));
  const [focus, setFocus] = useState(false);
  const [typewriter, setTypewriter] = useState(() => readPref('typewriter', false));
  const [authorship, setAuthorship] = useState(false);
  const [suggestMode, setSuggestMode] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [imageSearch, setImageSearch] = useState(false);
  const [follow, setFollow] = useState<string | null>(null);
  const [manualOffline, setManualOffline] = useState(false);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const selRef = useRef<Selection>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; error: string | null; result: { inserted: Id[]; deleted: Id[]; original: Token[] } | null }>({ busy: false, error: null, result: null });
  const [chatSeen, setChatSeen] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const sessionStartWords = useRef<number | null>(null);
  const presence = useRef<{ typingTimer?: ReturnType<typeof setTimeout>; idleTimer?: ReturnType<typeof setTimeout> }>({});

  const setPanel = (p: PanelId | null) => {
    setPanelState(p);
    writePref('panel', p);
  };
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  const doc: Doc | null = client?.doc ?? null;
  const version = s.docVersion + localVersion;
  const canEdit = roleCanEdit(role) && !viewing;
  const canComment = roleCanComment(role);
  const online = client?.status === 'online';
  const myName = user?.name ?? client?.name ?? 'Guest';
  const myColor = client?.color ?? '#1f3a68';
  const tokens = useMemo(() => doc?.tokens() ?? [], [doc, version]);
  const text = useMemo(() => plainText(tokens), [tokens]);
  const settings: DocSettings = useMemo(() => (doc ? readSettings(doc) : DEFAULT_SETTINGS), [doc, version]);
  const title = meta?.title ?? 'Untitled document';

  if (doc && sessionStartWords.current === null && client?.status === 'online') sessionStartWords.current = countWords(text);

  const comments = useComments(roomId, share, cipher, s.notifyVersion.comments);
  const suggestions = useSuggestions(roomId, share, s.notifyVersion.suggestions, { name: myName, color: myColor, userId: user?.id ?? null });
  const versions = useVersions(roomId, share, s.notifyVersion.versions);
  const authors = useAuthors(roomId, share, s.notifyVersion.members + (client?.peers.size ?? 0));
  const people = usePeople(roomId, share);

  // ------------------------------------------------------------- files

  const fileCipher = useMemo(() => (keyText ? createFileCipher(keyText) : null), [keyText]);
  const resolved = useRef(new Map<string, Promise<string>>());
  const resolve = useCallback(
    (src: string): Promise<string> => {
      if (!src.includes('enc=1')) return Promise.resolve(src);
      const hit = resolved.current.get(src);
      if (hit) return hit;
      const p = (async () => {
        const fc = await fileCipher;
        if (!fc) throw new Error('Missing key');
        const buf = await (await fetch(src)).arrayBuffer();
        const mime = new URL(src, location.href).searchParams.get('m') ?? 'application/octet-stream';
        return URL.createObjectURL(new Blob([await fc.decrypt(buf)], { type: mime }));
      })();
      resolved.current.set(src, p);
      return p;
    },
    [fileCipher],
  );
  const upload = useCallback(
    async (blob: Blob, name: string) => {
      const mime = blob.type || 'application/octet-stream';
      const fc = fileCipher ? await fileCipher : null;
      const body = fc ? await fc.encrypt(await blob.arrayBuffer()) : blob;
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'content-type': fc ? 'application/octet-stream' : mime, 'x-file-name': encodeURIComponent(name), 'x-doc-id': roomId },
        body,
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) throw new Error(j.error ?? 'Upload failed.');
      return { src: fc ? `${j.url}?enc=1&m=${encodeURIComponent(mime)}` : j.url, name, size: blob.size, mime };
    },
    [fileCipher, roomId],
  );

  // ------------------------------------------------------------- effects

  useEffect(() => {
    document.title = `${title} · CoWrite`;
  }, [title]);

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
      const ops = [...doc.insertTokens(0, initial.tokens), ...(initial.settings ? settingsOps(doc, initial.settings) : [])];
      client.edit(ops);
      bumpLocal();
    }
  }, [client, doc, online, role, roomId]);

  useEffect(() => {
    if (!client) return;
    const onVis = () => client.setPresence(document.hidden ? 'away' : 'active', false);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [client]);

  const markActive = useCallback(
    (typing: boolean) => {
      if (!client) return;
      const p = presence.current;
      client.setPresence('active' as PresenceState, typing);
      clearTimeout(p.typingTimer);
      clearTimeout(p.idleTimer);
      if (typing) p.typingTimer = setTimeout(() => client.setPresence('active', false), 2500);
      p.idleTimer = setTimeout(() => client.setPresence('idle', false), 60_000);
    },
    [client],
  );

  useEffect(() => {
    if (!follow) return;
    if (client && !client.peers.has(follow)) {
      setFollow(null);
      return;
    }
    document.querySelector(`.rich-doc [data-site="${CSS.escape(follow)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [follow, s.tick, version, client]);

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
    const onSearch = () => setImageSearch(true);
    window.addEventListener('keydown', onKey);
    document.addEventListener('cowrite:image-search', onSearch);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('cowrite:image-search', onSearch);
    };
  }, [paletteOpen]);

  useEffect(() => {
    if (panel === 'chat') setChatSeen(s.chat.length);
  }, [panel, s.chat.length]);

  // Printing follows the page setup.
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = printCss(settings, title);
    document.head.appendChild(el);
    return () => el.remove();
  }, [settings, title]);

  // ------------------------------------------------------------- editing

  const onLocal = useCallback(
    (flat: FlatToken[]) => {
      if (!client || !doc || !roleCanEdit(role) || viewing) return;
      const old = doc.tokens().map((t) => ({ ...t, key: attrsKey(t.attrs) }));
      const change = diffTokens(doc, old, flat, suggestMode ? suggestions.filterDelete : undefined);
      if (!change.ops.length && !change.marked.length) return;
      if (suggestMode) suggestions.trackChange(change.ops, change.marked);
      else undo.current.record(change);
      client.edit(change.ops);
      setFollow(null);
      markActive(true);
      bumpLocal();
    },
    [client, doc, role, viewing, suggestMode, suggestions, markActive],
  );

  const applyTokens = useCallback(
    (target: Token[]) => {
      if (!client || !doc) return;
      const old = doc.tokens().map((t) => ({ ...t, key: attrsKey(t.attrs) }));
      const change = diffTokens(doc, old, flatten(tokensToDoc(target)));
      undo.current.record(change);
      client.edit(change.ops);
      bumpLocal();
    },
    [client, doc],
  );

  const runUndo = useCallback(
    (redo: boolean) => {
      if (!client || !doc || !canEdit) return;
      const r = redo ? undo.current.redo(doc) : undo.current.undo(doc);
      if (!r) return;
      client.edit(r.ops);
      bumpLocal();
      requestAnimationFrame(() => editor.current?.selectTokens(r.caret));
    },
    [client, doc, canEdit],
  );

  const onKeyCommand = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return false;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) return runUndo(false), true;
      if ((k === 'z' && e.shiftKey) || k === 'y') return runUndo(true), true;
      if (e.altKey && k === 'm') return setPanel('comments'), true;
      if (k === 's') return setPanel('history'), flash('Name a version in the History panel to save it.'), true;
      if (k === 'p') return false;
      return false;
    },
    [runUndo],
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

  const insertAtCursor = useCallback((t: string) => editor.current?.insertText(` ${t}`), []);
  const speech = useSpeech(insertAtCursor);

  const changeSettings = (patch: Partial<DocSettings>) => {
    if (!client || !doc || !roleCanEdit(role)) return;
    client.edit(settingsOps(doc, patch));
    bumpLocal();
  };

  // ------------------------------------------------------------ comments

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

  useEffect(() => {
    if (range.start !== range.end) return;
    for (const [id, r] of commentPositions.ranges) {
      if (range.start >= r.from && range.start <= r.to) {
        const c = comments.comments.find((x) => x.id === id);
        if (c && !c.resolved) setActiveComment(id);
        return;
      }
    }
  }, [range, commentPositions, comments.comments]);

  const addComment = async (body: string, mentions: string[]) => {
    if (!doc || range.end <= range.start) return;
    await comments.add({
      anchorStart: doc.idAt(range.start),
      anchorEnd: doc.idAt(range.end - 1),
      quote: tokens.slice(range.start, range.end).map((t) => (t.ch === '\n' ? ' ' : t.ch === '￼' ? '' : t.ch)).join(''),
      body,
      mentions,
      name: myName,
      color: myColor,
    });
  };

  // ------------------------------------------------------------------ AI

  const runAi = async (action: AiAction, instruction?: string) => {
    if (!doc) return;
    setAi({ busy: true, error: null, result: null });
    const sel = selRef.current ?? [doc.idBefore(doc.length), doc.idBefore(doc.length)];
    try {
      const r = await api<{ inserted: Id[]; deleted: Id[]; original: Token[] }>(`/docs/${roomId}/ai`, {
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
    if (deleted.length && original.length) {
      const at = doc.locate(deleted[0])?.pos ?? doc.length;
      ops.push(...doc.insertTokens(Math.min(at, doc.length), original.map((t) => ({ ch: t.ch, a: t.attrs }))));
    }
    client.edit(ops);
    bumpLocal();
    setAi({ busy: false, error: null, result: null });
  };

  const aiTool = useCallback(
    async (tool: string, input: Record<string, unknown>) => {
      const r = await api<{ text: string }>(`/docs/${roomId}/ai/tool`, { method: 'POST', share, body: { tool, input } });
      return r.text;
    },
    [roomId, share],
  );

  // --------------------------------------------------------- decorations

  const authorColor = useMemo(() => {
    const m = new Map(authors.map((a) => [a.site, a.color]));
    if (client) m.set(client.doc.site, myColor);
    for (const p of client?.peers.values() ?? []) m.set(p.site, p.color);
    return m;
  }, [authors, client, myColor, s.tick]);

  const decorations = useMemo<RangeDeco[]>(() => {
    if (!doc) return [];
    const out: RangeDeco[] = [];
    if (authorship) {
      let pos = 0;
      for (const run of doc.runs()) {
        out.push({ from: pos, to: pos + run.text.length, kind: 'author', color: authorColor.get(run.site) ?? '#9aa0a6' });
        pos += run.text.length;
      }
    }
    for (const sg of suggestions.suggestions) {
      if (sg.status !== 'open') continue;
      for (const r of doc.rangesOf(new Set(sg.keys))) out.push({ ...r, kind: sg.kind === 'insert' ? 'sugg-ins' : 'sugg-del', color: sg.color, title: `${sg.authorName} suggested ${sg.kind === 'insert' ? 'adding' : 'deleting'} this` });
    }
    for (const [id, r] of commentPositions.ranges) {
      const c = comments.comments.find((x) => x.id === id);
      if (c && !c.resolved) out.push({ ...r, kind: id === activeComment ? 'comment-active' : 'comment', title: `${c.authorName}: ${c.body.slice(0, 80)}` });
    }
    return out;
  }, [doc, version, authorship, authorColor, suggestions.suggestions, suggestions.localTick, commentPositions, comments.comments, activeComment]);

  const cursors: RemoteCursor[] = useMemo(() => (client ? [...client.peers.values()] : []), [client, s.tick]);

  const headings = useMemo(
    () =>
      blocksOf(tokens)
        .filter((b) => b.type === 'text' && b.kind === 'h')
        .map((b) => ({ level: Number(b.attrs.level || 1), text: b.type === 'text' ? b.text : '', at: b.start })),
    [tokens],
  );

  const editorCtx = useMemo(
    () => ({
      docId: roomId,
      share,
      readOnly: !canEdit,
      me: { id: user?.id ?? null, name: myName },
      people,
      aiEnabled: providers.ai && !meta?.encrypted && !client?.encrypted,
      upload,
      resolve,
      unfurl: (url: string) => api<{ url: string; title: string; description: string; image: string | null; site: string }>(`/unfurl?url=${encodeURIComponent(url)}`),
      ai: (tool: 'describe-image' | 'summarize', input: Record<string, unknown>) => aiTool(tool, input),
      openImageSearch: () => setImageSearch(true),
    }),
    [roomId, share, canEdit, user?.id, myName, people, providers.ai, meta?.encrypted, client?.encrypted, upload, resolve, aiTool],
  );

  // ------------------------------------------------------------ commands

  const exportAs = async (kind: 'pdf' | 'docx' | 'md' | 'txt' | 'print') => {
    try {
      if (kind === 'pdf') await exportPdf(title, tokens, resolve, { header: settings.header, footer: settings.footer, pageNumbers: settings.pageNumbers });
      else if (kind === 'docx') await exportDocx(title, tokens, resolve);
      else if (kind === 'md') exportMarkdown(title, tokens);
      else if (kind === 'txt') exportText(title, tokens);
      else window.print();
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
    { id: 'undo', group: 'Edit', label: 'Undo my last change', shortcut: 'Ctrl+Z', disabled: !canEdit, run: () => runUndo(false) },
    { id: 'redo', group: 'Edit', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canEdit, run: () => runUndo(true) },
    { id: 'h1', group: 'Format', label: 'Heading 1', shortcut: 'Ctrl+Alt+1', disabled: !canEdit, run: () => editor.current?.run(setBlock('h', { level: 1 })) },
    { id: 'h2', group: 'Format', label: 'Heading 2', shortcut: 'Ctrl+Alt+2', disabled: !canEdit, run: () => editor.current?.run(setBlock('h', { level: 2 })) },
    { id: 'task', group: 'Format', label: 'Checklist', disabled: !canEdit, run: () => editor.current?.run(setBlock('task')) },
    { id: 'img', group: 'Insert', label: 'Image', disabled: !canEdit, run: () => editor.current?.pickFile('image') },
    { id: 'stock', group: 'Insert', label: 'Free stock photo', disabled: !canEdit, run: () => setImageSearch(true) },
    { id: 'embed', group: 'Insert', label: 'Video / embed', disabled: !canEdit, run: () => editor.current?.openDialog('embed') },
    { id: 'table', group: 'Insert', label: 'Table', disabled: !canEdit, run: () => editor.current?.insertAtom('table', { rows: [['', ''], ['', '']], header: true }) },
    { id: 'drawing', group: 'Insert', label: 'Drawing', disabled: !canEdit, run: () => editor.current?.insertAtom('drawing', { strokes: [], h: 320 }) },
    { id: 'emoji', group: 'Insert', label: 'Emoji', disabled: !canEdit, run: () => editor.current?.openDialog('emoji') },
    { id: 'voice-note', group: 'Insert', label: 'Voice note', disabled: !canEdit, run: () => editor.current?.openDialog('record') },
    { id: 'suggest', group: 'Edit', label: suggestMode ? 'Stop suggesting (edit directly)' : 'Start suggesting mode', disabled: !roleCanEdit(role), run: () => setSuggestMode(!suggestMode) },
    { id: 'voice', group: 'Edit', label: speech.listening ? 'Stop voice typing' : 'Start voice typing', disabled: !speech.supported || !canEdit, run: () => (speech.listening ? speech.stop() : speech.start()) },
    ...PANELS.map((p) => ({ id: `panel-${p.id}`, group: 'Panels', label: `Open ${p.label}`, run: () => setPanel(p.id) })),
    { id: 'focus', group: 'View', label: focus ? 'Exit focus mode' : 'Focus mode', shortcut: 'Ctrl+Shift+F', run: () => setFocus(!focus) },
    { id: 'typewriter', group: 'View', label: typewriter ? 'Turn off typewriter scrolling' : 'Typewriter scrolling', run: () => toggleTypewriter() },
    { id: 'authors', group: 'View', label: authorship ? 'Hide author colours' : 'Show who wrote what', run: () => setAuthorship(!authorship) },
    { id: 'notebook', group: 'Page', label: 'Notebook paper (ruled lines)', disabled: !canEdit, run: () => changeSettings({ lines: 'ruled', marginLine: true, paper: 'cream', theme: 'notebook', dateHeader: true }) },
    { id: 'replay', group: 'History', label: 'Replay how this document was written', run: () => setPanel('history') },
    { id: 'fork', group: 'History', label: 'Fork this document', disabled: !user || !meta, run: () => void fork() },
    { id: 'share', group: 'Document', label: 'Share…', run: () => setShareOpen(true) },
    { id: 'print', group: 'Export', label: 'Print / save as PDF with page layout', run: () => void exportAs('print') },
    { id: 'pdf', group: 'Export', label: 'Download as PDF', run: () => void exportAs('pdf') },
    { id: 'docx', group: 'Export', label: 'Download as Word (.docx)', run: () => void exportAs('docx') },
    { id: 'md', group: 'Export', label: 'Download as Markdown', run: () => void exportAs('md') },
    { id: 'txt', group: 'Export', label: 'Download as plain text', run: () => void exportAs('txt') },
    { id: 'ai-continue', group: 'AI', label: 'Claude: continue writing', disabled: !editorCtx.aiEnabled || !canEdit, run: () => (setPanel('ai'), void runAi('continue')) },
    { id: 'ai-summary', group: 'AI', label: 'Claude: summarize document', disabled: !editorCtx.aiEnabled || !canEdit, run: () => (setPanel('ai'), void runAi('summarize')) },
    { id: 'offline', group: 'Network', label: manualOffline ? 'Reconnect' : 'Go offline (simulate)', run: () => toggleOffline(!manualOffline) },
    { id: 'docs', group: 'Go to', label: 'My documents', disabled: !user, run: () => navigate('/documents') },
    { id: 'home', group: 'Go to', label: 'Home page', run: () => navigate('/') },
  ];

  function toggleTypewriter() {
    setTypewriter(!typewriter);
    writePref('typewriter', !typewriter);
  }

  // -------------------------------------------------------------- render

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
  const counts: Partial<Record<PanelId, number>> = {
    comments: comments.comments.filter((c) => !c.parentId && !c.resolved).length,
    suggestions: suggestions.suggestions.filter((x) => x.status === 'open').length,
    chat: panel === 'chat' ? 0 : unreadChat,
  };
  const paper = paperProps(settings);

  const panelBody = (() => {
    switch (panel) {
      case 'outline':
        return <OutlinePanel headings={headings} onJump={(at) => editor.current?.selectTokens(at)} />;
      case 'comments':
        return (
          <CommentsPanel
            comments={comments.comments}
            activeId={activeComment}
            setActive={setActiveComment}
            canComment={canComment}
            selectionQuote={range.end > range.start ? tokens.slice(range.start, range.end).map((t) => (t.ch === '\n' ? ' ' : t.ch === '￼' ? '' : t.ch)).join('') : ''}
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
              if (r) editor.current?.selectTokens(r.from, r.to);
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
              if (r) editor.current?.selectTokens(r.from, r.to);
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
            onRestore={(target) => {
              applyTokens(target);
              flash('Restored. Everyone sees the change, and the history keeps every step.');
            }}
            onFork={fork}
          />
        );
      case 'page':
        return <PagePanel settings={settings} onChange={changeSettings} canEdit={roleCanEdit(role)} user={user} />;
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

  const longDate = new Date(meta?.createdAt ?? Date.now()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className={`docpage ${focus ? 'focus-mode' : ''} ${panel ? 'with-panel' : ''}`}>
      {!focus && (
        <header className="doc-header">
          <div className="doc-header-left">
            <Brand compact />
            <div className="doc-title-block">
              {meta && role === 'owner' ? (
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
              ) : (
                <span className="doc-title">{title}</span>
              )}
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
                <span className="muted small">{meta ? (role === 'owner' ? 'Owned by you' : `Owned by ${meta.ownerName}`) : 'Guest document · anyone with the link can edit'}</span>
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
            </div>
            <span className={`status-pill ${client.status}`} role="status">
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
        <RichToolbar
          state={editorState}
          handle={editor.current}
          disabled={!canEdit}
          onUndo={() => runUndo(false)}
          onRedo={() => runUndo(true)}
          extra={
            <div className="tool-group">
              <button className={`tool ${suggestMode ? 'on' : ''}`} onClick={() => setSuggestMode(!suggestMode)} disabled={!roleCanEdit(role)} title="Suggesting mode: edits become suggestions" type="button">
                <Icon name="check" /> <span className="tool-label">{suggestMode ? 'Suggesting' : 'Editing'}</span>
              </button>
              <button className={`tool ${authorship ? 'on' : ''}`} onClick={() => setAuthorship(!authorship)} title="Colour text by author" aria-pressed={authorship} type="button">
                <Icon name="users" />
              </button>
              <button
                className={`tool ${speech.listening ? 'on recording' : ''}`}
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                disabled={!speech.supported || !canEdit}
                title={speech.supported ? 'Voice typing' : 'Voice typing is not supported in this browser'}
                type="button"
              >
                <Icon name="mic" />
              </button>
              <button className="tool" onClick={() => setFocus(true)} title="Focus mode (Ctrl+Shift+F)" aria-label="Focus mode" type="button">
                <Icon name="focus" />
              </button>
              <button className={`tool ${typewriter ? 'on' : ''}`} onClick={toggleTypewriter} title="Typewriter scrolling" aria-pressed={typewriter} type="button">
                <Icon name="keyboard" />
              </button>
              <Dropdown className="tool" ariaLabel="Export" label={<Icon name="download" />}>
                {(close) => (
                  <>
                    {(
                      [
                        ['print', 'Print / save as PDF (exact layout)'],
                        ['pdf', 'PDF document'],
                        ['docx', 'Word document (.docx)'],
                        ['md', 'Markdown (.md)'],
                        ['txt', 'Plain text (.txt)'],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          close();
                          void exportAs(k);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                )}
              </Dropdown>
              <button className="tool" onClick={() => setPaletteOpen(true)} title="All commands (Ctrl+K)" aria-label="Command palette" type="button">
                <span className="tool-text">⌘K</span>
              </button>
            </div>
          }
        />
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
        <main className="doc-main">
          <article className={`${paper.className} ${suggestMode ? 'suggesting' : ''}`} style={paper.style} data-font={settings.font}>
            {(settings.logo || settings.brandName || settings.header) && (
              <header className="paper-header">
                {settings.logo && <BrandLogo src={settings.logo} resolve={resolve} />}
                <span className="paper-brand">{settings.brandName}</span>
                <span className="paper-header-text">{settings.header}</span>
              </header>
            )}
            {settings.dateHeader && <div className="diary-date">{longDate}</div>}
            {viewing ? (
              <div className="readonly-view">
                <StaticDoc tokens={viewing.doc.tokens()} resolve={resolve} siteColors={authorColor} />
              </div>
            ) : (
              <RichEditor
                handleRef={editor}
                doc={doc}
                version={version}
                cursors={cursors}
                decorations={decorations}
                readOnly={!canEdit}
                ctx={editorCtx}
                onLocal={onLocal}
                onSelection={onSelection}
                onKeyCommand={onKeyCommand}
                onStateChange={setEditorState}
                typewriter={typewriter}
                placeholder={canEdit ? 'Start writing… Type “/” for headings, images, tables, embeds and more.' : 'This document is empty.'}
              />
            )}
            {settings.footer && <footer className="paper-footer">{settings.footer}</footer>}
          </article>
          <p className="doc-stats muted small">
            {countWords(text).toLocaleString()} words · {text.length.toLocaleString()} characters
            {suggestMode && ' · Suggesting'}
          </p>
        </main>

        {!focus && (
          <aside className={`side ${panel ? 'open' : ''}`} aria-label="Side panels">
            <nav className="rail" aria-label="Panels">
              {PANELS.map((p) => (
                <button key={p.id} className={panel === p.id ? 'rail-btn active' : 'rail-btn'} onClick={() => setPanel(panel === p.id ? null : p.id)} aria-pressed={panel === p.id} title={p.label} type="button">
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
      {imageSearch && (
        <ImageSearch
          onClose={() => setImageSearch(false)}
          onPick={(img) => {
            setImageSearch(false);
            editor.current?.insertAtom('image', { src: img.url, w: 100, align: 'center', caption: img.title, credit: img.credit, source: img.source });
          }}
        />
      )}
      {shareOpen && <ShareDialog docId={roomId} meta={meta} role={role} share={share} onClose={() => setShareOpen(false)} onMetaChange={s.setMeta} />}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function BrandLogo({ src, resolve }: { src: string; resolve(s: string): Promise<string> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    resolve(src).then(setUrl, () => setUrl(null));
  }, [src, resolve]);
  return url ? <img className="paper-logo" src={url} alt="" /> : null;
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))];
}
