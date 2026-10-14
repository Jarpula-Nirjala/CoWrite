import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { indent, insertAtom, setBlock, smartBackspace, smartEnter, toggleMark } from './commands.ts';
import { schema } from './schema.ts';

// ---------------------------------------------------------------- keymap

export function editorKeymap() {
  return [
    keymap({
      'Mod-b': toggleMark('b'),
      'Mod-i': toggleMark('i'),
      'Mod-u': toggleMark('u'),
      'Mod-Shift-x': toggleMark('s'),
      'Mod-e': toggleMark('code'),
      'Mod-.': toggleMark('sup'),
      'Mod-,': toggleMark('sub'),
      'Mod-Alt-1': setBlock('h', { level: 1 }),
      'Mod-Alt-2': setBlock('h', { level: 2 }),
      'Mod-Alt-3': setBlock('h', { level: 3 }),
      'Mod-Alt-0': setBlock('p'),
      'Mod-Shift-7': setBlock('oli'),
      'Mod-Shift-8': setBlock('li'),
      'Mod-Shift-9': setBlock('task'),
      Enter: smartEnter,
      'Shift-Enter': smartEnter,
      Backspace: chainCommands(smartBackspace, baseKeymap.Backspace),
      Tab: indent(1),
      'Shift-Tab': indent(-1),
    }),
    keymap(baseKeymap),
  ];
}

// ----------------------------------------------------------- input rules

const blockRule = (re: RegExp, block: string, attrs: (m: RegExpMatchArray) => Record<string, unknown> = () => ({})) =>
  new InputRule(re, (state, match, start, end) => {
    const $s = state.doc.resolve(start);
    if ($s.parent.type.name !== 'para' || $s.parent.attrs.block === 'code') return null;
    const tr = state.tr.delete(start, end);
    tr.setNodeMarkup($s.before(), undefined, { ...$s.parent.attrs, block, ...attrs(match) });
    return tr;
  });

const markRule = (re: RegExp, mark: string) =>
  new InputRule(re, (state, match, start, end) => {
    const text = match[1];
    if (!text) return null;
    const $s = state.doc.resolve(start);
    if ($s.parent.attrs.block === 'code') return null;
    const tr = state.tr.replaceWith(start, end, schema.text(text, [...$s.marks(), schema.marks[mark].create()]));
    return tr.removeStoredMark(schema.marks[mark]);
  });

export function markdownShortcuts() {
  return inputRules({
    rules: [
      blockRule(/^(#{1,3})\s$/, 'h', (m) => ({ level: m[1].length })),
      blockRule(/^\[( |x)?\]\s$/, 'task', (m) => ({ checked: m[1] === 'x' })),
      blockRule(/^[-*+]\s$/, 'li'),
      blockRule(/^\d+[.)]\s$/, 'oli'),
      blockRule(/^>\s$/, 'quote'),
      blockRule(/^```$/, 'code'),
      blockRule(/^!!\s$/, 'callout', () => ({ emoji: '💡', tone: 'info' })),
      new InputRule(/^---$/, (state, _m, start, end) => {
        const $s = state.doc.resolve(start);
        if ($s.parent.type.name !== 'para') return null;
        return state.tr.replaceWith($s.before(), $s.after(), [schema.nodes.atom.create({ kind: 'hr', data: {} }), schema.nodes.para.create()]).delete(end, end);
      }),
      markRule(/\*\*([^*\s][^*]*[^*\s]|[^*\s])\*\*$/, 'b'),
      markRule(/(?<![*\w])\*([^*\s][^*]*[^*\s]|[^*\s])\*$/, 'i'),
      markRule(/`([^`]+)`$/, 'code'),
      markRule(/~~([^~]+)~~$/, 's'),
      // Typographic niceties.
      new InputRule(/--$/, '—'),
      new InputRule(/->$/, '→'),
      new InputRule(/\(c\)$/, '©'),
    ],
  });
}

export { insertAtom };

// ------------------------------------------------------------ decorations

export const decoKey = new PluginKey<DecorationSet>('cowrite-decos');

/** External decorations (cursors, comments…) set by the React component. */
export function decorationsPlugin() {
  return new Plugin<DecorationSet>({
    key: decoKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(decoKey) as DecorationSet | undefined;
        return next ?? set.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (state) => decoKey.getState(state) },
  });
}

// --------------------------------------------------------- placeholders

export function placeholderPlugin(text: () => string) {
  return new Plugin({
    props: {
      decorations(state) {
        const doc = state.doc;
        if (doc.childCount === 1 && doc.firstChild!.type.name === 'para' && doc.firstChild!.content.size === 0) {
          return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild!.nodeSize, { class: 'is-empty', 'data-placeholder': text() })]);
        }
        // Hint on the empty paragraph holding the caret.
        const { $from, empty } = state.selection;
        if (empty && $from.parent.type.name === 'para' && $from.parent.content.size === 0 && $from.parent.attrs.block === 'p') {
          return DecorationSet.create(doc, [Decoration.node($from.before(), $from.after(), { class: 'is-empty', 'data-placeholder': 'Type “/” for blocks, “@” to mention' })]);
        }
        return null;
      },
    },
  });
}

// ------------------------------------------------------ code highlighting

type Lowlight = { highlight(lang: string, code: string): { children: HastNode[] }; highlightAuto(code: string): { children: HastNode[] }; registered(lang: string): boolean };
type HastNode = { type: string; value?: string; properties?: { className?: string[] }; children?: HastNode[] };

let lowlight: Lowlight | null = null;
let loading: Promise<void> | null = null;
const highlightKey = new PluginKey<DecorationSet>('highlight');

function loadLowlight(onReady: () => void) {
  if (lowlight || loading) return;
  loading = import('lowlight').then(({ common, createLowlight }) => {
    lowlight = createLowlight(common) as unknown as Lowlight;
    onReady();
  });
}

function highlightDecos(doc: PMNode): DecorationSet {
  if (!lowlight) return DecorationSet.empty;
  const decos: Decoration[] = [];
  // Consecutive code paragraphs form one block of code.
  let group: { pos: number; node: PMNode }[] = [];
  const flush = () => {
    if (!group.length) return;
    const lang = group[0].node.attrs.lang as string | null;
    const code = group.map((g) => g.node.textContent).join('\n');
    let tree: { children: HastNode[] };
    try {
      tree = lang && lowlight!.registered(lang) ? lowlight!.highlight(lang, code) : lowlight!.highlightAuto(code);
    } catch {
      group = [];
      return;
    }
    // Map character offsets in `code` back to editor positions.
    const starts: number[] = [];
    let acc = 0;
    for (const g of group) {
      starts.push(acc);
      acc += g.node.textContent.length + 1;
    }
    const toPos = (offset: number) => {
      let i = starts.length - 1;
      while (i > 0 && starts[i] > offset) i--;
      return group[i].pos + 1 + Math.min(offset - starts[i], group[i].node.content.size);
    };
    let offset = 0;
    const walk = (nodes: HastNode[], classes: string[]) => {
      for (const n of nodes) {
        if (n.type === 'text') {
          const len = n.value!.length;
          if (classes.length) {
            // Split ranges that cross line boundaries.
            let s = offset;
            const e = offset + len;
            while (s < e) {
              const lineEnd = n.value!.indexOf('\n', s - offset);
              const segEnd = lineEnd === -1 ? e : offset + lineEnd;
              if (segEnd > s) decos.push(Decoration.inline(toPos(s), toPos(segEnd), { class: classes.join(' ') }));
              s = segEnd + 1;
            }
          }
          offset += len;
        } else if (n.children) {
          walk(n.children, [...classes, ...(n.properties?.className ?? [])]);
        }
      }
    };
    walk(tree.children, []);
    group = [];
  };
  doc.forEach((node, pos) => {
    if (node.type.name === 'para' && node.attrs.block === 'code' && (!group.length || group[0].node.attrs.lang === node.attrs.lang)) {
      group.push({ pos, node });
    } else {
      flush();
      if (node.type.name === 'para' && node.attrs.block === 'code') group.push({ pos, node });
    }
  });
  flush();
  return DecorationSet.create(doc, decos);
}

export function highlightPlugin() {
  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: (_c, state) => highlightDecos(state.doc),
      apply: (tr, set, _old, state) => (tr.docChanged || tr.getMeta(highlightKey) ? highlightDecos(state.doc) : set),
    },
    props: { decorations: (state) => highlightKey.getState(state) },
    view(view) {
      const hasCode = (s: EditorState) => {
        let found = false;
        s.doc.forEach((n) => {
          if (n.attrs.block === 'code') found = true;
        });
        return found;
      };
      const kick = () => view.dispatch(view.state.tr.setMeta(highlightKey, true));
      if (hasCode(view.state)) loadLowlight(kick);
      return {
        update(v) {
          if (!lowlight && hasCode(v.state)) loadLowlight(kick);
        },
      };
    },
  });
}

// ------------------------------------------------------------------ locks

/** Rejects local edits that touch locked ranges (the server enforces this too). */
export function lockPlugin(getRanges: () => { from: number; to: number }[]) {
  return new Plugin({
    filterTransaction(tr) {
      if (!tr.docChanged || tr.getMeta('remote')) return true;
      const ranges = getRanges();
      if (!ranges.length) return true;
      let ok = true;
      tr.steps.forEach((step) => {
        step.getMap().forEach((from, to) => {
          for (const r of ranges) if (from < r.to && to > r.from) ok = false;
        });
      });
      return ok;
    },
  });
}
