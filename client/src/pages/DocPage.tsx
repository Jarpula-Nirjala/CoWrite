import type { EditorState } from 'prosemirror-state';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Doc, Id, Op, Token } from '../../../shared/crdt.ts';
import { canComment as roleCanComment, canEdit as roleCanEdit, type PresenceState, type Selection } from '../../../shared/protocol.ts';
import { blocksOf, markdownToTokens, plainText } from '../../../shared/rich.ts';
import { api, errorText, type DocDetails, type Suggestion } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Brand } from '../components/Brand.tsx';
import type { RemoteCursor } from '../components/CollabEditor.tsx';
import { NotificationBell, ThemeToggle, UserMenu } from '../components/SiteHeader.tsx';
import { Avatar, Dropdown, Icon, Spinner } from '../components/ui.tsx';
import { AiPanel, type AiAction, type AiTool } from '../editor/ai.tsx';
import { MindMap } from '../editor/MindMap.tsx';
import { exportNarration } from '../editor/narrate.ts';
import { StudyDialog } from '../editor/StudyDialog.tsx';
import { UpdatesSection } from '../editor/UpdatesSection.tsx';
import { WebsitePanel } from '../editor/WebsitePanel.tsx';
import { deckFromOutline } from '../kinds/slides/model.ts';
import { HistoryPanel, type Viewing } from '../editor/history.tsx';
import { ImageSearch } from '../editor/imageSearch.tsx';
import { PagePanel } from '../editor/pagePanel.tsx';
import { CommandPalette, type Command } from '../editor/palette.tsx';
import { ChatPanel, CommentsPanel, NetworkPanel, OutlinePanel, StatsPanel, SuggestionsPanel } from '../editor/panels.tsx';
import { ShareDialog } from '../editor/share.tsx';
import { DraftPanel, ReviewPanel } from '../editor/review.tsx';
import { blockKey, heatmap, useLocks, useReactions, useWorkflow, type Lock } from '../editor/team.ts';
import { TimeMachinePanel } from '../editor/timemachine.tsx';
import { CallButton, CallDock, P2PSection, useCall, usePeerMesh } from '../editor/call.tsx';
import { useSpeech } from '../editor/speech.ts';
import { UndoStack } from '../editor/undo.ts';
import { loadChatHistory, useAuthors, useComments, usePeople, useSuggestions, useVersions } from '../editor/useCollab.ts';
import { useDocSession, type DocSession } from '../editor/useDocSession.ts';
import { useFiles } from '../editor/useFiles.ts';
import { KindPage } from '../kinds/KindPage.tsx';
import { exportDocx, exportMarkdown, exportPdf, exportText } from '../lib/exporters.ts';
import { saveToGoogle } from '../lib/google.ts';
import { pendingContent, type InitialContent } from '../lib/templates.ts';
import { countWords } from '../lib/text.ts';
import { setBlock } from '../rich/commands.ts';
import { attrsKey, diffTokens, flatten, tokensToDoc, type FlatToken } from '../rich/convert.ts';
import { RichEditor, type RangeDeco, type RichHandle, type WidgetDeco } from '../rich/RichEditor.tsx';
import { RichToolbar } from '../rich/RichToolbar.tsx';
import { DEFAULT_SETTINGS, paperProps, printCss, readSettings, settingsOps, type DocSettings } from '../rich/settings.ts';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import { Link, navigate, queryParam } from '../router.ts';
import { MeetBanner } from '../components/MeetBanner.tsx';

type PanelId = 'outline' | 'comments' | 'suggestions' | 'chat' | 'history' | 'time' | 'review' | 'draft' | 'site' | 'stats' | 'page' | 'ai' | 'network';

const PANELS: { id: PanelId; label: string; icon: string }[] = [
  { id: 'outline', label: 'Outline', icon: 'list' },
  { id: 'comments', label: 'Comments', icon: 'comment' },
  { id: 'suggestions', label: 'Suggest', icon: 'check' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'time', label: 'Time', icon: 'clock' },
  { id: 'review', label: 'Review', icon: 'shield' },
  { id: 'draft', label: 'Draft', icon: 'pencil' },
  { id: 'page', label: 'Page', icon: 'file' },
  { id: 'stats', label: 'Stats', icon: 'chart' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
  { id: 'site', label: 'Website', icon: 'globe' },
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
  const s = useDocSession(roomId);
  if (s.meta?.kind && s.meta.kind !== 'doc') return <KindPage roomId={roomId} s={s} />;
  return <DocEditor roomId={roomId} s={s} />;
}

function DocEditor({ roomId, s }: { roomId: string; s: DocSession }) {
  const { user, aiReady, aiName } = useAuth();
  const { client, meta, role, cipher, share, keyText } = s;
  const editor = useRef<RichHandle>(null);
  const undo = useRef(new UndoStack());
  const [localVersion, bumpLocal] = useReducer((n: number) => n + 1, 0);
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  const [panel, setPanelState] = useState<PanelId | null>(() => {
    const asked = queryParam('panel');
    if (asked && PANELS.some((p) => p.id === asked)) return asked as PanelId;
    if (queryParam('meet')) return 'chat';
    return window.innerWidth > 1180 ? readPref<PanelId | null>('panel', 'outline') : null;
  });
  const [meetRoom] = useState(() => queryParam('meet') === '1');
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
  const [aiTool2, setAiTool2] = useState<{ busy: string | null; message: string | null }>({ busy: null, message: null });
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
  const registered = !!meta && !meta.encrypted;
  const [heat, setHeat] = useState(false);
  const [reading, setReading] = useState(false);
  const [mindmapOpen, setMindmapOpen] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const call = useCall(client);
  const p2p = usePeerMesh(client, roleCanEdit(role));
  const locksQ = useLocks(roomId, share, !!meta, s.notifyVersion.locks);
  const reactionsQ = useReactions(roomId, share, !!meta, s.notifyVersion.reactions);
  const workflowQ = useWorkflow(roomId, share, !!meta, s.notifyVersion.workflow + s.notifyVersion.meta);
  const locks: Lock[] = locksQ.data?.locks ?? [];

  // ------------------------------------------------------------- files

  const { resolve, upload } = useFiles(roomId, keyText);

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
    // Wait until we know this is a text document: slides, boards and sheets take their own content.
    if (!client || !doc || !online || !roleCanEdit(role) || (meta?.kind ?? 'doc') !== 'doc' || !meta) return;
    const initial = pendingContent.take(roomId);
    if (initial && doc.length === 0) {
      const ops = [...doc.insertTokens(0, initial.tokens), ...(initial.settings ? settingsOps(doc, initial.settings) : [])];
      client.edit(ops);
      bumpLocal();
    }
  }, [client, doc, online, role, roomId, meta]);

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
        setReading(false);
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

  /** Inserts Markdown as new blocks after the paragraph holding the cursor. */
  const insertMarkdown = (md: string) => {
    if (!client || !doc) return;
    const all = doc.tokens();
    const from = Math.min(editor.current?.tokenSelection().end ?? all.length, all.length);
    let at = all.findIndex((t, i) => i >= from && t.ch === '\n');
    at = at < 0 ? all.length : at + 1;
    const ops = doc.insertTokens(at, markdownToTokens(md));
    client.edit(ops);
    undo.current.record({ ops, removed: [], formats: [] });
    bumpLocal();
  };

  const runTool = async (tool: AiTool) => {
    const busyText: Record<AiTool['kind'], string> = {
      review: `${aiName} is reviewing the document…`,
      slides: `${aiName} is designing your slides…`,
      translate: 'Translating…',
      meeting: 'Writing meeting notes…',
      'photo-notes': 'Reading the photo…',
      'summary-card': '',
    };
    if (tool.kind === 'summary-card') {
      editor.current?.insertAtom('summary', { text: '' });
      return;
    }
    let file: File | null = null;
    if (tool.kind === 'photo-notes') {
      file = await new Promise<File | null>((done) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => done(input.files?.[0] ?? null);
        input.click();
      });
      if (!file) return;
    }
    setAiTool2({ busy: busyText[tool.kind], message: null });
    try {
      if (tool.kind === 'review') {
        const r = await api<{ added: number }>(`/docs/${roomId}/ai/review`, { method: 'POST', share, body: { focus: tool.focus } });
        setAiTool2({ busy: null, message: r.added ? `${aiName} left ${r.added} comments. Open the Comments panel to read them.` : `${aiName} found nothing to comment on.` });
      } else if (tool.kind === 'slides') {
        const r = await api<{ document: { id: string }; deck: Parameters<typeof deckFromOutline>[0] }>(`/docs/${roomId}/ai/slides`, { method: 'POST', share });
        pendingContent.set(r.document.id, deckFromOutline(r.deck) as unknown as InitialContent);
        setAiTool2({ busy: null, message: null });
        navigate(`/d/${r.document.id}`);
      } else if (tool.kind === 'translate') {
        const r = await api<{ document: { id: string } }>(`/docs/${roomId}/ai/translate`, { method: 'POST', share, body: { lang: tool.lang } });
        setAiTool2({ busy: null, message: null });
        navigate(`/d/${r.document.id}`);
      } else if (tool.kind === 'meeting') {
        const r = await api<{ markdown: string }>(`/docs/${roomId}/ai/meeting`, { method: 'POST', share, body: { transcript: tool.transcript } });
        insertMarkdown(r.markdown);
        setAiTool2({ busy: null, message: 'Meeting notes added below your cursor.' });
      } else if (tool.kind === 'photo-notes' && file) {
        const up = await upload(file, file.name);
        const text = await aiTool('whiteboard-to-text', { src: up.src });
        insertMarkdown(text);
        setAiTool2({ busy: null, message: 'Notes from the photo added below your cursor.' });
      }
    } catch (e) {
      setAiTool2({ busy: null, message: errorText(e) });
    }
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

  // Locked sections as token ranges; the ones I may not edit are passed to the editor.
  const lockRanges = useMemo(() => {
    if (!doc) return [];
    return locks.flatMap((l) => {
      const a = doc.locate(l.start);
      const b = doc.locate(l.end);
      return a && b && b.pos >= a.pos ? [{ from: a.pos, to: b.pos + (b.deleted ? 0 : 1), lock: l }] : [];
    });
  }, [doc, version, locks]);
  const lockedForMe = useMemo(() => lockRanges.filter((r) => role !== 'owner' && r.lock.createdBy !== user?.id), [lockRanges, role, user?.id]);
  const [speakRange, setSpeakRange] = useState<{ from: number; to: number } | null>(null);

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
    for (const l of lockRanges) out.push({ from: l.from, to: l.to, kind: 'locked', title: `Locked by ${l.lock.createdName}` });
    if (heat) {
      const spots = heatmap(doc);
      const max = Math.max(1, ...spots.map((x) => x.score));
      for (const h of spots) out.push({ from: h.from, to: h.to, kind: 'heat', color: `rgba(255, 120, 0, ${(0.12 + (0.45 * h.score) / max).toFixed(2)})`, title: `${h.sites} people edited this at about the same time` });
    }
    if (speakRange) out.push({ ...speakRange, kind: 'speak' });
    return out;
  }, [doc, version, authorship, authorColor, suggestions.suggestions, suggestions.localTick, commentPositions, comments.comments, activeComment, lockRanges, heat, speakRange]);

  // ------------------------------------------------- blocks, reactions, read aloud

  const blocks = useMemo(() => blocksOf(tokens), [tokens]);
  const cursorBlock = useMemo(() => {
    const b = blocks.find((x) => x.start <= range.start && range.start < x.end) ?? blocks[blocks.length - 1];
    return b ? { start: b.start, end: Math.max(b.start, b.end - 1) } : null;
  }, [blocks, range.start]);

  const toggleReaction = useCallback(
    async (target: string, emoji: string) => {
      try {
        await api(`/docs/${roomId}/reactions`, { method: 'POST', share, body: { target, emoji, name: myName, guest: client?.doc.site } });
        reactionsQ.reload();
      } catch (e) {
        flash(errorText(e));
      }
    },
    [roomId, share, myName, client, reactionsQ],
  );

  const widgets = useMemo<WidgetDeco[]>(() => {
    if (!meta || viewing) return [];
    const byTarget = new Map<string, NonNullable<typeof reactionsQ.data>['reactions']>();
    for (const r of reactionsQ.data?.reactions ?? []) byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r]);
    const out: WidgetDeco[] = [];
    const EMOJI = ['👍', '❤️', '🎉', '😂', '🤔', '👀', '🔥', '✅'];
    for (const b of blocks) {
      if (b.type !== 'text' || !b.id) continue;
      const key = blockKey(b.id);
      const list = byTarget.get(key) ?? [];
      const isCursor = !!cursorBlock && b.start === cursorBlock.start && canComment;
      if (!list.length && !isCursor) continue;
      const sig = `${key}|${list.map((r) => `${r.emoji}${r.count}${r.mine ? 1 : 0}`).join(',')}|${isCursor ? 1 : 0}`;
      out.push({
        at: b.end - 1,
        key: `react-${sig}`,
        render: () => {
          const wrap = document.createElement('span');
          wrap.className = 'reactions';
          wrap.contentEditable = 'false';
          for (const r of list) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `reaction-chip${r.mine ? ' mine' : ''}`;
            chip.textContent = `${r.emoji} ${r.count}`;
            chip.title = r.names.join(', ');
            chip.onmousedown = (e) => e.preventDefault();
            chip.onclick = () => void toggleReaction(key, r.emoji);
            wrap.appendChild(chip);
          }
          if (isCursor) {
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'reaction-add';
            add.textContent = '☺+';
            add.title = 'React to this paragraph';
            add.onmousedown = (e) => e.preventDefault();
            add.onclick = () => {
              wrap.querySelector('.reaction-pop')?.remove();
              const pop = document.createElement('span');
              pop.className = 'reaction-pop';
              for (const em of EMOJI) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = em;
                btn.onmousedown = (e) => e.preventDefault();
                btn.onclick = () => {
                  pop.remove();
                  void toggleReaction(key, em);
                };
                pop.appendChild(btn);
              }
              wrap.appendChild(pop);
            };
            wrap.appendChild(add);
          }
          return wrap;
        },
      });
    }
    return out;
  }, [meta, viewing, reactionsQ.data, blocks, cursorBlock, toggleReaction, canComment]);

  const lockSelection = async () => {
    if (!doc) return;
    const lo = Math.min(range.start, range.end);
    const hi = Math.max(range.start, range.end);
    const covered = blocks.filter((b) => b.end > lo && b.start <= Math.max(lo, hi - 1));
    if (!covered.length) return;
    const first = covered[0];
    const last = covered[covered.length - 1];
    const startTok = tokens[first.start];
    const endTok = tokens[Math.min(last.end - 1, tokens.length - 1)];
    if (!startTok || !endTok) return;
    const quote = plainText(tokens.slice(first.start, last.end)).slice(0, 200);
    await api(`/docs/${roomId}/locks`, { method: 'POST', share, body: { start: startTok.id, end: endTok.id, quote } });
    locksQ.reload();
    flash('Section locked. Others can read it but not change it.');
  };

  const [speaking, setSpeaking] = useState(false);
  const readAloud = () => {
    if (!('speechSynthesis' in window)) return flash('Your browser cannot read aloud.');
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      setSpeakRange(null);
      return;
    }
    const from = range.end > range.start ? range.start : (cursorBlock?.start ?? 0);
    const to = range.end > range.start ? range.end : tokens.length;
    const txt = tokens
      .slice(from, to)
      .map((t) => (t.ch === '\uFFFC' ? ' ' : t.ch))
      .join('');
    const u = new SpeechSynthesisUtterance(txt);
    u.onboundary = (e) => {
      if (e.name !== 'word') return;
      const len = e.charLength || /^\S+/.exec(txt.slice(e.charIndex))?.[0].length || 1;
      setSpeakRange({ from: from + e.charIndex, to: from + e.charIndex + len });
    };
    u.onend = u.onerror = () => {
      setSpeaking(false);
      setSpeakRange(null);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const narrate = async () => {
    if (!meta) return flash('Narration works for documents saved to an account.');
    if (!aiReady) return flash('Narration uses Gemini. Connect your free Gemini key in Account settings.');
    setNarrating(true);
    flash('Recording the narration… this can take a minute.');
    try {
      const r = await exportNarration(roomId, title, 'Kore');
      flash(r.truncated ? 'Saved the MP3 (the first part of a long document).' : 'Saved the narration as an MP3.');
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setNarrating(false);
    }
  };

  const applyOps = (ops: Op[]) => {
    if (!client || !ops.length) return;
    client.edit(ops);
    undo.current.record({ ops, removed: [], formats: [] });
    bumpLocal();
  };

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
      aiEnabled: aiReady && !meta?.encrypted && !client?.encrypted,
      upload,
      resolve,
      unfurl: (url: string) => api<{ url: string; title: string; description: string; image: string | null; site: string }>(`/unfurl?url=${encodeURIComponent(url)}`),
      ai: (tool: 'describe-image' | 'summarize', input: Record<string, unknown>) => aiTool(tool, input),
      openImageSearch: () => setImageSearch(true),
    }),
    [roomId, share, canEdit, user?.id, myName, people, aiReady, meta?.encrypted, client?.encrypted, upload, resolve, aiTool],
  );

  // ------------------------------------------------------------ commands

  const exportAs = async (kind: 'pdf' | 'docx' | 'md' | 'txt' | 'print' | 'gdocs') => {
    try {
      if (kind === 'gdocs') {
        flash('Saving to Google Docs…');
        const blob = (await exportDocx(title, tokens, resolve, { blob: true })) as Blob;
        window.open(await saveToGoogle(blob, title, 'docs'), '_blank', 'noopener');
        return;
      }
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
    { id: 'mindmap', group: 'View', label: 'Mind map of the headings', run: () => setMindmapOpen(true) },
    { id: 'study', group: 'Tools', label: 'Study: flashcards & quiz', run: () => setStudyOpen(true) },
    { id: 'narrate', group: 'Export', label: 'Audio narration (.mp3)', disabled: !aiReady || !meta, run: () => void narrate() },
    { id: 'website', group: 'Share', label: 'Publish as a website', disabled: !meta, run: () => setPanel('site') },
    { id: 'read-aloud', group: 'View', label: speaking ? 'Stop reading aloud' : 'Read aloud', run: readAloud },
    { id: 'reading', group: 'View', label: 'Reading mode', run: () => setReading(true) },
    { id: 'time', group: 'History', label: 'Compare two moments / paragraph history', run: () => setPanel('time') },
    { id: 'heat', group: 'History', label: heat ? 'Hide conflict heatmap' : 'Show conflict heatmap', run: () => setHeat(!heat) },
    { id: 'lock', group: 'Review', label: 'Lock the selected paragraphs', disabled: !meta || !canEdit || !user, run: () => void lockSelection().catch((e) => flash(errorText(e))) },
    { id: 'review', group: 'Review', label: 'Send for review / approve', disabled: !meta, run: () => setPanel('review') },
    { id: 'draft', group: 'Review', label: 'Private draft', run: () => setPanel('draft') },
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
    { id: 'gdocs', group: 'Export', label: 'Save to Google Docs', run: () => void exportAs('gdocs') },
    { id: 'ai-continue', group: 'AI', label: 'AI: continue writing', disabled: !editorCtx.aiEnabled || !canEdit, run: () => (setPanel('ai'), void runAi('continue')) },
    { id: 'ai-summary', group: 'AI', label: 'AI: summarize document', disabled: !editorCtx.aiEnabled || !canEdit, run: () => (setPanel('ai'), void runAi('summarize')) },
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
            title={title}
            colors={authorColor}
          />
        );
      case 'time':
        return (
          <TimeMachinePanel
            doc={doc}
            docVersion={version}
            docId={roomId}
            share={share}
            registered={registered}
            authors={authors}
            canEdit={canEdit}
            block={cursorBlock}
            heat={heat}
            setHeat={setHeat}
            onView={setViewing}
            onApply={applyOps}
          />
        );
      case 'review':
        return (
          <>
          <ReviewPanel
            docId={roomId}
            share={share}
            role={role}
            registered={!!meta}
            signedIn={!!user}
            userId={user?.id ?? null}
            workflow={workflowQ.data}
            locks={locks}
            selection={cursorBlock ? { quote: '' } : null}
            onLock={lockSelection}
            onUnlock={async (id) => {
              await api(`/docs/${roomId}/locks/${id}`, { method: 'DELETE', share });
              locksQ.reload();
            }}
            onJump={(l) => {
              const r = lockRanges.find((x) => x.lock.id === l.id);
              if (r) editor.current?.selectTokens(r.from, r.from);
            }}
            onSignature={() => editor.current?.insertAtom('signature', {})}
            onChanged={() => workflowQ.reload()}
          />
          {!!meta && !!user && <UpdatesSection docId={roomId} share={share} role={role} />}
          </>
        );
      case 'site':
        return (
          <WebsitePanel
            docId={roomId}
            meta={meta}
            role={role}
            site={(doc.getObject('settings')?.site ?? undefined) as { theme?: string; accent?: string | null } | undefined}
            onSite={(site) => {
              client.edit(doc.setFields('settings', { site }));
              bumpLocal();
            }}
            onMeta={s.setMeta}
          />
        );
      case 'draft':
        return <DraftPanel docId={roomId} share={share} serverSide={!!meta && !meta.encrypted && !!user} canEdit={canEdit} onPublish={(md) => (insertMarkdown(md), flash('Your draft is now part of the document.'))} />;
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
            enabled={aiReady}
            aiName={aiName}
            encrypted={!!meta?.encrypted || client.encrypted}
            canEdit={canEdit}
            online={online}
            hasSelection={range.end > range.start}
            busy={ai.busy}
            error={ai.error}
            outcome={ai.result ? { inserted: ai.result.inserted.length, replaced: ai.result.deleted.length } : null}
            onRun={(a, i) => void runAi(a, i)}
            onTool={(t) => void runTool(t)}
            toolBusy={aiTool2.busy}
            toolMessage={aiTool2.message}
            signedIn={!!user}
            onKeep={() => setAi({ busy: false, error: null, result: null })}
            onUndo={undoAi}
          />
        );
      case 'network':
        return (
          <>
            <NetworkPanel client={client} manualOffline={manualOffline} setOffline={toggleOffline} />
            <P2PSection p2p={p2p} canEdit={canEdit} />
          </>
        );
      default:
        return null;
    }
  })();

  const longDate = new Date(meta?.createdAt ?? Date.now()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className={`docpage ${focus || reading ? 'focus-mode' : ''} ${reading ? 'reading-mode' : ''} ${panel ? 'with-panel' : ''}`}>
      {!focus && !reading && (
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
            <CallButton call={call} onError={flash} />
            <ThemeToggle />
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

      {!focus && !reading && (
        <RichToolbar
          state={editorState}
          handle={editor.current}
          disabled={!canEdit}
          onUndo={() => runUndo(false)}
          onRedo={() => runUndo(true)}
          people={people}
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
              <button className={`tool ${speaking ? 'on' : ''}`} onClick={readAloud} title={speaking ? 'Stop reading aloud' : 'Read aloud from the cursor (or the selection)'} aria-label="Read aloud" aria-pressed={speaking} type="button">
                <Icon name="speaker" />
              </button>
              <button className="tool" onClick={() => setReading(true)} title="Reading mode" aria-label="Reading mode" type="button">
                <Icon name="book" />
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
                        ['gdocs', 'Save to Google Docs'],
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
                    <button
                      role="menuitem"
                      type="button"
                      disabled={narrating}
                      onClick={() => {
                        close();
                        void narrate();
                      }}
                    >
                      🎧 Audio narration (.mp3)
                    </button>
                  </>
                )}
              </Dropdown>
              <button className="tool" onClick={() => setMindmapOpen(true)} title="Mind map of the headings" aria-label="Mind map" type="button">
                <Icon name="mindmap" />
              </button>
              <button className="tool" onClick={() => setStudyOpen(true)} title="Study: flashcards and quiz from your notes" aria-label="Flashcards" type="button">
                <Icon name="cards" />
              </button>
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
              viewing.side ? (
                <div className="readonly-view side-by-side">
                  <div>
                    <h4 className="side-title">{viewing.side.leftTitle}</h4>
                    <StaticDoc tokens={viewing.doc.tokens()} resolve={resolve} />
                  </div>
                  <div>
                    <h4 className="side-title">{viewing.side.rightTitle}</h4>
                    <StaticDoc tokens={viewing.side.doc.tokens()} resolve={resolve} />
                  </div>
                </div>
              ) : (
                <div className="readonly-view">
                  <StaticDoc tokens={viewing.doc.tokens()} resolve={resolve} siteColors={viewing.colors ?? authorColor} />
                </div>
              )
            ) : (
              <RichEditor
                handleRef={editor}
                doc={doc}
                version={version}
                cursors={cursors}
                decorations={decorations}
                widgets={widgets}
                locked={lockedForMe}
                readOnly={!canEdit || reading}
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

      {(focus || reading) && (
        <button className="focus-exit btn btn-outline btn-sm" onClick={() => (setFocus(false), setReading(false))} type="button">
          {reading ? 'Exit reading mode (Esc)' : 'Exit focus (Esc)'}
        </button>
      )}
      <CallDock call={call} client={client} />
      {meetRoom && <MeetBanner call={call} onError={flash} />}
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
      {mindmapOpen && <MindMap title={title} headings={headings} onJump={(at) => editor.current?.selectTokens(at)} onClose={() => setMindmapOpen(false)} />}
      {studyOpen && (
        <StudyDialog
          doc={doc}
          version={version}
          docId={roomId}
          share={share}
          registered={!!meta && !meta.encrypted}
          signedIn={!!user}
          canEdit={canEdit}
          aiReady={aiReady && !meta?.encrypted}
          onEdit={(ops) => {
            client.edit(ops);
            bumpLocal();
          }}
          onClose={() => setStudyOpen(false)}
        />
      )}
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
