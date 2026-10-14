import type { Attrs as PMAttrs, MarkType, Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { PARA_DEFAULTS, VALUE_MARKS, schema } from './schema.ts';

/** Editing commands shared by the toolbar, keyboard shortcuts and slash menu. */

export const MARK_KEYS = ['b', 'i', 'u', 's', 'code', 'sub', 'sup'] as const;

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function isMarkActive(state: EditorState, name: string): boolean {
  return markActive(state, schema.marks[name]);
}

export function markValue(state: EditorState, name: string): string | null {
  const type = schema.marks[name];
  const { $from, from, to, empty } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : [];
  let found = type.isInSet(marks);
  if (!found && !empty) {
    state.doc.nodesBetween(from, to, (n) => {
      if (!found && n.isInline) found = type.isInSet(n.marks) ?? undefined;
    });
  }
  return found ? String(found.attrs[VALUE_MARKS[name]]) : null;
}

export const toggleMark =
  (name: string): Command =>
  (state, dispatch) => {
    const type = schema.marks[name];
    const { from, to, empty } = state.selection;
    if (!dispatch) return true;
    const active = markActive(state, type);
    if (empty) {
      const marks = state.storedMarks ?? state.selection.$from.marks();
      dispatch(state.tr.setStoredMarks(active ? type.removeFromSet(marks) : type.create().addToSet(marks)));
    } else {
      dispatch(active ? state.tr.removeMark(from, to, type) : state.tr.addMark(from, to, type.create()));
    }
    return true;
  };

/** Sets (or clears, with null) a value mark: link, color, bg, font, size. */
export const setMarkValue =
  (name: string, value: string | null): Command =>
  (state, dispatch) => {
    const type = schema.marks[name];
    const { from, to, empty } = state.selection;
    if (!dispatch) return true;
    const mark = value === null ? null : type.create({ [VALUE_MARKS[name]]: value });
    if (empty) {
      const marks = type.removeFromSet(state.storedMarks ?? state.selection.$from.marks());
      dispatch(state.tr.setStoredMarks(mark ? mark.addToSet(marks) : marks));
      return true;
    }
    let tr = state.tr.removeMark(from, to, type);
    if (mark) tr = tr.addMark(from, to, mark);
    dispatch(tr);
    return true;
  };

export const clearFormatting: Command = (state, dispatch) => {
  const { from, to } = state.selection;
  if (dispatch) {
    let tr = state.tr;
    for (const m of Object.values(schema.marks)) tr = tr.removeMark(from, to, m);
    dispatch(tr);
  }
  return true;
};

/** Paragraph nodes touched by the selection. */
function selectedParas(state: EditorState): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, Math.max(to, from), (node, pos) => {
    if (node.type.name === 'para') out.push({ node, pos });
    return node.type.name === 'doc';
  });
  return out;
}

export function currentPara(state: EditorState): PMNode | null {
  const $f = state.selection.$from;
  return $f.parent.type.name === 'para' ? $f.parent : null;
}

/** Changes the block kind of the selected paragraphs (toggling back to plain text). */
export const setBlock =
  (block: string, extra: PMAttrs = {}): Command =>
  (state, dispatch) => {
    const paras = selectedParas(state);
    if (!paras.length) return false;
    if (!dispatch) return true;
    const allSame = paras.every((p) => p.node.attrs.block === block && Object.entries(extra).every(([k, v]) => p.node.attrs[k] === v));
    const tr = state.tr;
    for (const { node, pos } of paras) {
      const attrs = allSame
        ? { ...node.attrs, block: 'p', level: 0, checked: false, lang: null }
        : { ...node.attrs, block, ...(block === 'h' ? {} : { level: block === node.attrs.block ? node.attrs.level : 0 }), ...extra };
      if (block === 'code' && !allSame) {
        // Code is plain text: drop inline styles.
        for (const m of Object.values(schema.marks)) tr.removeMark(pos, pos + node.nodeSize, m);
      }
      tr.setNodeMarkup(pos, undefined, attrs);
    }
    dispatch(tr);
    return true;
  };

export const setParaAttrs =
  (attrs: PMAttrs): Command =>
  (state, dispatch) => {
    const paras = selectedParas(state);
    if (!paras.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of paras) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
      dispatch(tr);
    }
    return true;
  };

const INDENTABLE = new Set(['li', 'oli', 'task', 'p', 'quote']);
export const indent =
  (delta: number): Command =>
  (state, dispatch) => {
    const paras = selectedParas(state).filter((p) => INDENTABLE.has(p.node.attrs.block));
    if (!paras.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of paras) tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: Math.max(0, Math.min(4, node.attrs.level + delta)) });
      dispatch(tr);
    }
    return true;
  };

/** Enter: continue lists and tasks, end them on an empty item, headings become text. */
export const smartEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'para') return false;
  const para = $from.parent;
  const kind = para.attrs.block;
  if (['li', 'oli', 'task', 'quote', 'callout'].includes(kind) && para.content.size === 0) {
    if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), undefined, { ...para.attrs, block: 'p', level: 0, checked: false }));
    return true;
  }
  if (!dispatch) return true;
  const atEnd = $from.parentOffset === para.content.size;
  const nextAttrs =
    kind === 'h' && atEnd
      ? { ...PARA_DEFAULTS, align: para.attrs.align }
      : kind === 'task'
        ? { ...para.attrs, checked: false }
        : { ...para.attrs };
  dispatch(state.tr.split($from.pos, 1, [{ type: schema.nodes.para, attrs: nextAttrs }]).scrollIntoView());
  return true;
};

/** Backspace at the start of a styled block turns it back into plain text first. */
export const smartBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'para') return false;
  const para = $from.parent;
  if (para.attrs.level > 0 && ['li', 'oli', 'task'].includes(para.attrs.block)) {
    if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), undefined, { ...para.attrs, level: para.attrs.level - 1 }));
    return true;
  }
  if (para.attrs.block !== 'p') {
    if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), undefined, { ...para.attrs, block: 'p', level: 0, checked: false }));
    return true;
  }
  return false;
};

/** Inserts a block object after the current paragraph (or replacing an empty one). */
export function insertAtom(kind: string, data: Record<string, unknown> = {}): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const node = schema.nodes.atom.create({ kind, data });
    const { $from } = state.selection;
    let tr: Transaction;
    if (state.selection instanceof NodeSelection) {
      tr = state.tr.insert(state.selection.to, node);
    } else if ($from.parent.type.name === 'para' && $from.parent.content.size === 0) {
      tr = state.tr.replaceWith($from.before(), $from.after(), node);
    } else {
      const after = $from.depth > 0 ? $from.after(1) : state.selection.to;
      tr = state.tr.insert(after, node);
    }
    const pos = tr.mapping.map(state.selection.from);
    void pos;
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export function insertChip(kind: string, data: Record<string, unknown>): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.chip.create({ kind, data }), true).insertText(' '));
    return true;
  };
}

export function insertText(text: string): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.insertText(text));
    return true;
  };
}

/** Replaces the atom at `pos` with new data (node views call this). */
export function updateAtom(pos: number, data: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'atom') return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { kind: node.attrs.kind, data: { ...node.attrs.data, ...data } }));
    return true;
  };
}

export function selectAll(state: EditorState): TextSelection {
  return TextSelection.create(state.doc, 1, state.doc.content.size - 1);
}
