import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { EditorState, NodeSelection, Selection as PMSelection, TextSelection, type Command } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { Doc } from '../../../shared/crdt.ts';
import type { Selection } from '../../../shared/protocol.ts';
import type { RemoteCursor } from '../components/CollabEditor.tsx';
import { Avatar, ICON_PATHS, Icon, Modal } from '../components/ui.tsx';
import { AtomView, ChipView } from './atoms.tsx';
import { insertAtom, insertChip, insertText, setMarkValue } from './commands.ts';
import { flatten, posToToken, reconcile, tokenToPos, tokensToDoc, type FlatToken } from './convert.ts';
import { embedFor, mapEmbed, type EditorCtx } from './ctx.ts';
import { EMOJI_GROUPS, searchEmoji } from './emoji.ts';
import { decoKey, decorationsPlugin, editorKeymap, highlightPlugin, listNumberPlugin, lockPlugin, markdownShortcuts, placeholderPlugin } from './plugins.ts';
import { SLASH_ITEMS, type SlashItem } from './slash.ts';

/** A highlighted token range [from, to). */
export interface RangeDeco {
  from: number;
  to: number;
  kind: 'author' | 'comment' | 'comment-active' | 'sugg-ins' | 'sugg-del' | 'locked' | 'heat' | 'speak' | 'search';
  color?: string;
  title?: string;
}

/** A widget shown before token `at` (e.g. reactions on a paragraph). */
export interface WidgetDeco {
  at: number;
  key: string;
  render(): HTMLElement;
}

export interface RichHandle {
  view: EditorView | null;
  run(cmd: Command): boolean;
  insertAtom(kind: string, data?: Record<string, unknown>): void;
  insertText(text: string): void;
  /** Token indices of the selection. */
  tokenSelection(): { start: number; end: number };
  selectTokens(from: number, to?: number): void;
  focus(): void;
  openDialog(kind: DialogKind): void;
  pickFile(kind: 'image' | 'file' | 'audio'): void;
}

export type DialogKind = 'embed' | 'link' | 'image-url' | 'record' | 'emoji' | 'icon' | 'map';

interface Props {
  doc: Doc;
  version: number;
  cursors: RemoteCursor[];
  decorations: RangeDeco[];
  widgets?: WidgetDeco[];
  locked?: { from: number; to: number }[];
  readOnly: boolean;
  ctx: Omit<EditorCtx, 'headings' | 'jumpTo' | 'onChange'>;
  onLocal(flat: FlatToken[]): void;
  onSelection(sel: Selection, range: { start: number; end: number }): void;
  onKeyCommand?(e: KeyboardEvent): boolean;
  onStateChange?(state: EditorState): void;
  typewriter?: boolean;
  placeholder?: string;
  handleRef?: Ref<RichHandle>;
  className?: string;
}

interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  icon?: string;
  run: () => void;
}

interface Menu {
  kind: 'slash' | 'mention' | 'emoji';
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
  index: number;
}

const DECO_STYLE: Record<RangeDeco['kind'], (d: RangeDeco) => Record<string, string>> = {
  author: (d) => ({ style: `background:${d.color}26` }),
  comment: () => ({ class: 'deco-comment' }),
  'comment-active': () => ({ class: 'deco-comment active' }),
  'sugg-ins': (d) => ({ class: 'deco-sugg-ins', style: `--sugg:${d.color ?? '#2e7d5b'}` }),
  'sugg-del': () => ({ class: 'deco-sugg-del' }),
  locked: () => ({ class: 'deco-locked' }),
  heat: (d) => ({ style: `background:${d.color}` }),
  speak: () => ({ class: 'deco-speak' }),
  search: () => ({ class: 'deco-search' }),
};

export function RichEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const changeSubs = useRef(new Set<() => void>());
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileKind = useRef<'image' | 'file' | 'audio'>('image');
  const lockedPm = useRef<{ from: number; to: number }[]>([]);

  // The full context handed to block objects, including editor-provided parts.
  const ctxRef = useRef<EditorCtx>(null as unknown as EditorCtx);
  ctxRef.current = {
    ...props.ctx,
    readOnly: props.readOnly,
    headings: () => {
      const out: { level: number; text: string; pos: number }[] = [];
      viewRef.current?.state.doc.forEach((n, pos) => {
        if (n.type.name === 'para' && n.attrs.block === 'h') out.push({ level: n.attrs.level || 1, text: n.textContent, pos: pos + 1 });
      });
      return out;
    },
    jumpTo: (pos) => {
      const v = viewRef.current;
      if (!v) return;
      v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(Math.min(pos, v.state.doc.content.size)))).scrollIntoView());
      v.focus();
    },
    onChange: (cb) => {
      changeSubs.current.add(cb);
      return () => changeSubs.current.delete(cb);
    },
  };

  const reportSelection = useCallback((state: EditorState) => {
    const flat = flatten(state.doc);
    const { anchor, head, from, to } = state.selection;
    const a = posToToken(flat, anchor);
    const h = posToToken(flat, head);
    const d = propsRef.current.doc;
    propsRef.current.onSelection([d.idBefore(a), d.idBefore(h)], { start: posToToken(flat, from), end: posToToken(flat, to) });
  }, []);

  const updateMenu = useCallback((view: EditorView) => {
    const { state } = view;
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type.name !== 'para' || $from.parent.attrs.block === 'code' || !view.hasFocus()) {
      if (menuRef.current) setMenu(null);
      return;
    }
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 30), $from.parentOffset, undefined, '￼');
    const m = /(?:^|\s)([/@:])([\w-]{0,24})$/.exec(before);
    if (!m || (m[1] === ':' && m[2].length < 2)) {
      if (menuRef.current) setMenu(null);
      return;
    }
    const kind = m[1] === '/' ? 'slash' : m[1] === '@' ? 'mention' : 'emoji';
    const from = $from.pos - m[2].length - 1;
    const coords = view.coordsAtPos($from.pos);
    const box = host.current!.getBoundingClientRect();
    const prev = menuRef.current;
    setMenu({ kind, query: m[2], from, to: $from.pos, left: coords.left - box.left, top: coords.bottom - box.top + 4, index: prev && prev.kind === kind ? Math.min(prev.index, 50) : 0 });
  }, []);

  // ------------------------------------------------------- the view

  useLayoutEffect(() => {
    const state = EditorState.create({
      doc: tokensToDoc(props.doc.tokens()),
      plugins: [
        markdownShortcuts(),
        ...editorKeymap(),
        dropCursor({ color: '#1f3a68', width: 2 }),
        gapCursor(),
        decorationsPlugin(),
        highlightPlugin(),
        listNumberPlugin(),
        placeholderPlugin(() => propsRef.current.placeholder ?? 'Start writing…'),
        lockPlugin(() => lockedPm.current),
      ],
    });
    const view = new EditorView(host.current!, {
      state,
      editable: () => !propsRef.current.readOnly,
      nodeViews: {
        atom: (node, v, getPos) => new AtomView(node, v, getPos as () => number | undefined, () => ctxRef.current),
        chip: (node) => new ChipView(node),
      },
      attributes: { class: 'rich-doc', spellcheck: 'true', 'aria-label': 'Document text', role: 'textbox', 'aria-multiline': 'true' },
      dispatchTransaction(tr) {
        const v = viewRef.current!;
        const before = v.state;
        const next = before.apply(tr);
        v.updateState(next);
        if (tr.docChanged && !tr.getMeta('remote')) {
          if (!v.composing) flushLocal(v);
        }
        if (tr.docChanged) for (const cb of changeSubs.current) cb();
        if (tr.selectionSet || tr.docChanged) {
          reportSelection(v.state);
          updateMenu(v);
          if (propsRef.current.typewriter && !tr.getMeta('remote')) centerCaret(v);
        }
        propsRef.current.onStateChange?.(v.state);
      },
      handleClickOn(v, _pos, node, nodePos, event) {
        // Clicking a checklist's box toggles it.
        if (node.type.name !== 'para' || node.attrs.block !== 'task' || propsRef.current.readOnly) return false;
        const dom = v.nodeDOM(nodePos) as HTMLElement | null;
        if (!dom || event.clientX - dom.getBoundingClientRect().left > 26) return false;
        v.dispatch(v.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
        return true;
      },
      handleKeyDown(v, event) {
        const m = menuRef.current;
        if (m) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            setMenu({ ...m, index: Math.max(0, m.index + (event.key === 'ArrowDown' ? 1 : -1)) });
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            pickMenuItem(v, m);
            return true;
          }
          if (event.key === 'Escape') {
            setMenu(null);
            return true;
          }
        }
        return propsRef.current.onKeyCommand?.(event) ?? false;
      },
      handlePaste(v, event) {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length) {
          void insertFiles(v, files, null);
          return true;
        }
        const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
        if (/^https?:\/\/\S+$/.test(text) && !event.clipboardData?.getData('text/html')) {
          const { empty, $from } = v.state.selection;
          if (!empty) {
            setMarkValue('link', text)(v.state, v.dispatch);
            return true;
          }
          const emb = embedFor(text);
          if (emb && $from.parent.content.size === 0) {
            insertAtom('embed', { url: text, ...emb })(v.state, v.dispatch);
            return true;
          }
          if ($from.parent.content.size === 0) {
            insertAtom('link', { url: text })(v.state, v.dispatch);
            return true;
          }
          const tr = v.state.tr.insertText(text);
          tr.addMark(v.state.selection.from, v.state.selection.from + text.length, v.state.schema.marks.link.create({ href: text }));
          v.dispatch(tr);
          return true;
        }
        return false;
      },
      handleDrop(v, event) {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
        if (!files.length) return false;
        const pos = v.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
        event.preventDefault();
        void insertFiles(v, files, pos?.pos ?? null);
        return true;
      },
      handleDOMEvents: {
        compositionend: (v) => {
          setTimeout(() => flushLocal(v), 0);
          return false;
        },
        blur: () => {
          setTimeout(() => setMenu(null), 150);
          return false;
        },
      },
    });
    viewRef.current = view;
    props.onStateChange?.(view.state);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once per document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.doc]);

  function flushLocal(v: EditorView) {
    const flat = flatten(v.state.doc);
    propsRef.current.onLocal(flat);
    // Normalise to the CRDT's canonical form (suggestions, rejected edits…).
    reconcile(v, propsRef.current.doc.tokens());
  }

  // Remote changes, undo, restores…
  useEffect(() => {
    const v = viewRef.current;
    if (!v || v.composing) return;
    reconcile(v, props.doc.tokens());
  }, [props.version, props.doc]);

  useEffect(() => {
    viewRef.current?.setProps({ editable: () => !props.readOnly });
  }, [props.readOnly]);

  // ------------------------------------------------------- decorations

  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const pmDoc = v.state.doc;
    const flat = flatten(pmDoc);
    const n = flat.length;
    const toPos = (i: number) => tokenToPos(flat, Math.max(0, Math.min(i, n)), pmDoc);
    const decos: Decoration[] = [];
    for (const d of props.decorations) {
      const from = toPos(d.from);
      const to = d.to >= n ? pmDoc.content.size : toPos(d.to);
      if (to <= from) continue;
      const attrs = DECO_STYLE[d.kind](d);
      if (d.title) attrs.title = d.title;
      decos.push(Decoration.inline(from, to, attrs));
      // Block objects inside the range get a node decoration too.
      pmDoc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === 'atom' && pos >= from && pos + node.nodeSize <= to) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `deco-node-${d.kind}` }));
        return node.type.name === 'doc';
      });
    }
    for (const c of props.cursors) {
      if (!c.sel) continue;
      const a = props.doc.posAfter(c.sel[0]);
      const h = props.doc.posAfter(c.sel[1]);
      if (a < 0 || h < 0) continue;
      const pa = toPos(a);
      const ph = toPos(h);
      if (pa !== ph) decos.push(Decoration.inline(Math.min(pa, ph), Math.max(pa, ph), { style: `background:${c.color}33` }));
      decos.push(
        Decoration.widget(
          ph,
          () => {
            const el = document.createElement('span');
            el.className = 'remote-caret';
            el.dataset.site = c.site;
            el.style.setProperty('--peer', c.color);
            const label = document.createElement('span');
            label.className = 'remote-caret-label';
            label.textContent = c.name;
            el.appendChild(label);
            return el;
          },
          { key: `caret-${c.site}-${c.name}-${c.color}`, side: 1 },
        ),
      );
    }
    for (const w of props.widgets ?? []) decos.push(Decoration.widget(toPos(w.at), w.render, { key: w.key, side: -1 }));
    lockedPm.current = (props.locked ?? []).map((r) => ({ from: toPos(r.from), to: r.to >= n ? pmDoc.content.size : toPos(r.to) }));
    v.dispatch(v.state.tr.setMeta(decoKey, DecorationSet.create(pmDoc, decos)).setMeta('remote', true).setMeta('addToHistory', false));
  }, [props.decorations, props.cursors, props.widgets, props.locked, props.version, props.doc]);

  // ---------------------------------------------------- files & menus

  async function insertFiles(v: EditorView, files: File[], at: number | null) {
    for (const file of files) {
      try {
        const isImage = file.type.startsWith('image/');
        const blob = isImage ? await downscale(file) : file;
        const up = await propsRef.current.ctx.upload(blob, file.name);
        const kind = isImage ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'file';
        const data = isImage ? { src: up.src, w: 100, align: 'center', caption: '' } : { src: up.src, name: up.name, size: up.size, mime: up.mime };
        if (at !== null) {
          const $p = v.state.doc.resolve(Math.min(at, v.state.doc.content.size));
          const pos = $p.depth > 0 ? $p.after(1) : at;
          v.dispatch(v.state.tr.insert(pos, v.state.schema.nodes.atom.create({ kind, data })));
        } else {
          insertAtom(kind, data)(v.state, v.dispatch);
        }
      } catch (e) {
        window.alert(`Could not upload ${file.name}: ${(e as Error).message}`);
      }
    }
  }

  const menuItems = useMemo((): MenuItem[] => {
    if (!menu) return [] as MenuItem[];
    const v = viewRef.current!;
    const q = menu.query.toLowerCase();
    const clear = () => v.dispatch(v.state.tr.delete(menu.from, menu.to));
    if (menu.kind === 'slash') {
      return SLASH_ITEMS.filter((it) => !q || it.label.toLowerCase().includes(q) || it.keywords.includes(q))
        .filter((it) => !it.needsAi || props.ctx.aiEnabled)
        .slice(0, 40)
        .map((it: SlashItem) => ({
          key: it.id,
          label: it.label,
          hint: it.group,
          icon: it.icon,
          run: () => {
            clear();
            it.run(handle());
          },
        }));
    }
    if (menu.kind === 'mention') {
      return props.ctx.people
        .filter((p) => !q || p.username.includes(q) || p.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((p) => ({
          key: p.id,
          label: p.name,
          hint: `@${p.username}`,
          run: () => {
            clear();
            insertChip('mention', { id: p.id, name: p.name, username: p.username })(v.state, v.dispatch);
          },
        }));
    }
    return searchEmoji(q, 8).map((e) => ({
      key: e.e,
      label: `${e.e}  ${e.k.split(' ')[0]}`,
      run: () => {
        clear();
        insertText(e.e)(v.state, v.dispatch);
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.kind, menu?.query, props.ctx.people, props.ctx.aiEnabled]);

  function pickMenuItem(_v: EditorView, m: Menu) {
    const items = menuItemsRef.current;
    const it = items[Math.min(m.index, items.length - 1)];
    setMenu(null);
    it?.run();
  }
  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;

  const handle = (): RichHandle => ({
    view: viewRef.current,
    run(cmd) {
      const v = viewRef.current;
      if (!v) return false;
      const ok = cmd(v.state, v.dispatch, v);
      v.focus();
      return ok;
    },
    insertAtom(kind, data = {}) {
      const v = viewRef.current;
      if (v) insertAtom(kind, data)(v.state, v.dispatch);
    },
    insertText(text) {
      const v = viewRef.current;
      if (v) insertText(text)(v.state, v.dispatch);
    },
    tokenSelection() {
      const v = viewRef.current;
      if (!v) return { start: 0, end: 0 };
      const flat = flatten(v.state.doc);
      return { start: posToToken(flat, v.state.selection.from), end: posToToken(flat, v.state.selection.to) };
    },
    selectTokens(from, to = from) {
      const v = viewRef.current;
      if (!v) return;
      const flat = flatten(v.state.doc);
      const a = tokenToPos(flat, from, v.state.doc);
      const b = tokenToPos(flat, to, v.state.doc);
      let sel: PMSelection;
      const node = v.state.doc.nodeAt(a);
      if (a === b && node?.type.name === 'atom') sel = NodeSelection.create(v.state.doc, a);
      else sel = TextSelection.between(v.state.doc.resolve(a), v.state.doc.resolve(b));
      v.dispatch(v.state.tr.setSelection(sel).scrollIntoView());
      v.focus();
    },
    focus: () => viewRef.current?.focus(),
    openDialog: (k) => setDialog(k),
    pickFile(kind) {
      fileKind.current = kind;
      const el = fileInput.current!;
      el.accept = kind === 'image' ? 'image/*' : kind === 'audio' ? 'audio/*' : '*/*';
      el.value = '';
      el.click();
    },
  });

  useImperativeHandle(props.handleRef, handle);

  const insertFromDialog = (kind: string, data: Record<string, unknown>) => {
    const v = viewRef.current;
    setDialog(null);
    if (v) {
      v.focus();
      insertAtom(kind, data)(v.state, v.dispatch);
    }
  };

  return (
    <div className={`rich-host ${props.className ?? ''}`}>
      <div ref={host} className="rich-mount" />
      {menu && menuItems.length > 0 && (
        <ul className="slash-menu" style={{ left: Math.max(0, menu.left), top: menu.top }} role="listbox">
          {menuItems.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === Math.min(menu.index, menuItems.length - 1)}>
              <button
                type="button"
                className={i === Math.min(menu.index, menuItems.length - 1) ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setMenu(null);
                  it.run();
                }}
              >
                {'icon' in it && it.icon ? <Icon name={String(it.icon)} size={16} /> : menu.kind === 'mention' ? <Avatar name={it.label} size={20} /> : null}
                <span className="slash-label">{it.label}</span>
                {it.hint && <span className="slash-hint">{it.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const v = viewRef.current;
          const files = [...(e.target.files ?? [])];
          if (v && files.length) void insertFiles(v, files, null);
        }}
      />
      {dialog && <InsertDialog kind={dialog} onClose={() => setDialog(null)} onInsert={insertFromDialog} ctx={props.ctx} onText={(t) => handle().insertText(t)} onChip={(k, d) => handle().run(insertChip(k, d))} />}
    </div>
  );
}

function centerCaret(v: EditorView) {
  requestAnimationFrame(() => {
    try {
      const c = v.coordsAtPos(v.state.selection.head);
      window.scrollBy({ top: c.top - window.innerHeight * 0.45 });
    } catch {
      // position not rendered yet
    }
  });
}

/** Large photos are scaled down before upload (max 1800 px, WebP/JPEG). */
async function downscale(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml' || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

// ---------------------------------------------------------------- dialogs

const ICON_NAMES = [
  'star', 'check', 'clock', 'file', 'folder', 'lock', 'users', 'chat', 'bell', 'sparkle', 'mic', 'chart', 'search', 'tag', 'branch', 'history', 'eye', 'wifi', 'share', 'download', 'upload', 'link', 'comment', 'play', 'keyboard', 'trash',
];

function InsertDialog({
  kind,
  onClose,
  onInsert,
  ctx,
  onText,
  onChip,
}: {
  kind: DialogKind;
  onClose(): void;
  onInsert(kind: string, data: Record<string, unknown>): void;
  ctx: Props['ctx'];
  onText(t: string): void;
  onChip(kind: string, data: Record<string, unknown>): void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState(EMOJI_GROUPS[0].name);

  if (kind === 'emoji') {
    const list = value ? searchEmoji(value, 120) : EMOJI_GROUPS.find((g) => g.name === group)!.items;
    return (
      <Modal title="Insert emoji" onClose={onClose} wide>
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Search emoji, e.g. rocket" autoFocus />
        {!value && (
          <div className="tabs emoji-tabs">
            {EMOJI_GROUPS.map((g) => (
              <button key={g.name} type="button" className={g.name === group ? 'tab active' : 'tab'} onClick={() => setGroup(g.name)}>
                {g.items[0].e} {g.name}
              </button>
            ))}
          </div>
        )}
        <div className="emoji-grid">
          {list.map((e) => (
            <button
              key={e.e + e.k}
              type="button"
              title={e.k}
              onClick={() => {
                onText(e.e);
                onClose();
              }}
            >
              {e.e}
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  if (kind === 'icon') {
    return (
      <Modal title="Insert icon" onClose={onClose}>
        <div className="icon-grid">
          {ICON_NAMES.map((n) => (
            <button
              key={n}
              type="button"
              title={n}
              onClick={() => {
                onChip('icon', { name: n, path: ICON_PATHS[n] });
                onClose();
              }}
            >
              <Icon name={n} size={22} />
              <span>{n}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  if (kind === 'record') return <VoiceRecorder ctx={ctx} onClose={onClose} onDone={(d) => onInsert('audio', d)} />;

  const titles: Record<string, string> = {
    embed: 'Embed media',
    link: 'Link preview card',
    'image-url': 'Image from a link',
    map: 'Embed a map',
  };
  const submit = () => {
    setError(null);
    const v = value.trim();
    if (kind === 'map') {
      if (!v) return setError('Type a place or address.');
      return onInsert('embed', { url: `https://www.google.com/maps?q=${encodeURIComponent(v)}`, ...mapEmbed(v) });
    }
    if (!/^https?:\/\//.test(v)) return setError('Paste a full link starting with https://');
    if (kind === 'embed') {
      const emb = embedFor(v);
      if (!emb) return setError('That site cannot be embedded. Supported: YouTube, Vimeo, Loom, Spotify, Figma, CodePen, X/Twitter, Google Maps, GitHub Gists. Use a link preview instead.');
      return onInsert('embed', { url: v, ...emb });
    }
    if (kind === 'image-url') return onInsert('image', { src: v, w: 100, align: 'center', caption: '' });
    onInsert('link', { url: v });
  };
  return (
    <Modal title={titles[kind] ?? 'Insert'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>{kind === 'map' ? 'Place or address' : 'Link'}</span>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder={kind === 'map' ? 'e.g. India Gate, New Delhi' : 'https://'} />
        </label>
        {kind === 'embed' && <p className="muted small">YouTube, Vimeo, Loom, Spotify, Figma, CodePen, X/Twitter posts, Google Maps and GitHub Gists.</p>}
        {error && <p className="error-text small">{error}</p>}
        <button className="btn btn-primary" type="submit">
          Insert
        </button>
      </form>
    </Modal>
  );
}

function VoiceRecorder({ ctx, onClose, onDone }: { ctx: Props['ctx']; onClose(): void; onDone(d: Record<string, unknown>): void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  useEffect(() => {
    if (state !== 'recording') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState('saving');
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
          const name = `Voice note ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.webm`;
          const up = await ctx.upload(blob, name);
          onDone({ src: up.src, name, size: up.size, duration: seconds });
        } catch (e) {
          setError((e as Error).message);
          setState('idle');
        }
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setState('recording');
    } catch {
      setError('Microphone access was blocked. Allow it in your browser to record voice notes.');
    }
  };
  return (
    <Modal title="Record a voice note" onClose={onClose}>
      <div className="recorder">
        <div className={`rec-dot ${state === 'recording' ? 'on' : ''}`} />
        <p className="rec-time">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </p>
        {error && <p className="error-text small">{error}</p>}
        {state === 'idle' && (
          <button className="btn btn-primary" type="button" onClick={start}>
            <Icon name="mic" size={16} /> Start recording
          </button>
        )}
        {state === 'recording' && (
          <button className="btn btn-danger" type="button" onClick={() => rec.current?.stop()}>
            Stop and insert
          </button>
        )}
        {state === 'saving' && <p className="muted">Saving…</p>}
      </div>
    </Modal>
  );
}
