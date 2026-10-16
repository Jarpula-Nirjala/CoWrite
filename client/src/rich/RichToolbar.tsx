import type { EditorState } from 'prosemirror-state';
import { useState, type ReactNode } from 'react';
import { Dropdown, Icon } from '../components/ui.tsx';
import { clearFormatting, currentPara, indent, isMarkActive, markValue, setBlock, setMarkValue, setParaAttrs, toggleMark } from './commands.ts';
import type { RichHandle } from './RichEditor.tsx';
import { FONT_NAMES } from './schema.ts';
import { MIcon } from '../components/MIcon.tsx';
import { mdiFormatAlignCenter, mdiFormatAlignJustify, mdiFormatAlignLeft, mdiFormatAlignRight } from '../lib/mdi.ts';

const COLORS = ['#111418', '#5f6368', '#b3261e', '#c15f3c', '#a8842f', '#2e7d5b', '#1f6f8b', '#1f3a68', '#6b4c9a', '#9c3d6b'];
const HIGHLIGHTS = ['#fff59d', '#ffe0b2', '#c8e6c9', '#bbdefb', '#e1bee7', '#f8bbd0', '#eeeeee'];
const SIZES = ['10', '12', '14', '16', '18', '20', '24', '28', '32', '40', '48'];
const FONT_LABEL: Record<string, string> = {
  serif: 'Times New Roman',
  georgia: 'Georgia',
  sans: 'Arial',
  verdana: 'Verdana',
  mono: 'Courier New',
  garamond: 'Garamond',
  trebuchet: 'Trebuchet',
  dyslexic: 'OpenDyslexic',
  hand: 'Handwriting (Caveat)',
};

const STYLES: { label: string; block: string; level?: number }[] = [
  { label: 'Normal text', block: 'p' },
  { label: 'Heading 1', block: 'h', level: 1 },
  { label: 'Heading 2', block: 'h', level: 2 },
  { label: 'Heading 3', block: 'h', level: 3 },
  { label: 'Quote', block: 'quote' },
  { label: 'Callout', block: 'callout' },
  { label: 'Code', block: 'code' },
];

export function RichToolbar({
  state,
  handle,
  disabled,
  onUndo,
  onRedo,
  extra,
  people = [],
}: {
  state: EditorState | null;
  handle: RichHandle | null;
  disabled: boolean;
  onUndo(): void;
  onRedo(): void;
  extra?: React.ReactNode;
  /** People who can be assigned tasks. */
  people?: { id: string; name: string }[];
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  if (!state || !handle) return <div className="doc-toolbar" />;
  const para = currentPara(state);
  const styleLabel = STYLES.find((s) => s.block === para?.attrs.block && (s.level === undefined || s.level === para?.attrs.level))?.label ?? 'Normal text';
  const font = markValue(state, 'font') ?? 'serif';
  const size = markValue(state, 'size') ?? '';
  const run = handle.run;
  const btn = (label: string, icon: string, onClick: () => void, active = false, text?: ReactNode) => (
    <button
      type="button"
      className={`tool ${active ? 'on' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {text ? <span className="tool-text">{text}</span> : <Icon name={icon} />}
    </button>
  );

  const insert = (label: string, action: () => void) => (
    <button
      role="menuitem"
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
      key={label}
    >
      {label}
    </button>
  );

  return (
    <div className="doc-toolbar rich-toolbar" role="toolbar" aria-label="Formatting">
      <div className="tool-group">
        {btn('Undo my last change (Ctrl+Z)', 'undo', onUndo)}
        {btn('Redo (Ctrl+Y)', 'redo', onRedo)}
      </div>
      <div className="tool-group">
        <Dropdown className="tool tool-select" ariaLabel="Paragraph style" label={<span className="tool-select-label">{styleLabel} ▾</span>}>
          {(close) =>
            STYLES.map((s) => (
              <button
                key={s.label}
                role="menuitem"
                type="button"
                className={`style-option style-${s.block}${s.level ?? ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  close();
                  run(setBlock(s.block, s.level ? { level: s.level } : s.block === 'callout' ? { emoji: '💡', tone: 'info' } : {}));
                }}
              >
                {s.label}
              </button>
            ))
          }
        </Dropdown>
        <select
          className="tool-select-native"
          value={font}
          disabled={disabled}
          onChange={(e) => run(setMarkValue('font', e.target.value === 'serif' ? null : e.target.value))}
          aria-label="Font"
        >
          {FONT_NAMES.map((f) => (
            <option key={f} value={f}>
              {FONT_LABEL[f]}
            </option>
          ))}
        </select>
        <select className="tool-select-native narrow" value={size} disabled={disabled} onChange={(e) => run(setMarkValue('size', e.target.value || null))} aria-label="Font size">
          <option value="">Size</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="tool-group">
        {btn('Bold (Ctrl+B)', 'bold', () => run(toggleMark('b')), isMarkActive(state, 'b'))}
        {btn('Italic (Ctrl+I)', 'italic', () => run(toggleMark('i')), isMarkActive(state, 'i'))}
        {btn('Underline (Ctrl+U)', '', () => run(toggleMark('u')), isMarkActive(state, 'u'), 'U')}
        {btn('Strikethrough', 'strike', () => run(toggleMark('s')), isMarkActive(state, 's'))}
        <Dropdown className="tool" ariaLabel="Text colour" label={<span className="tool-text color-a" style={{ borderBottomColor: markValue(state, 'color') ?? '#111418' }}>A</span>}>
          {(close) => (
            <div className="swatches">
              {COLORS.map((c) => (
                <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => (close(), run(setMarkValue('color', c === '#111418' ? null : c)))} />
              ))}
            </div>
          )}
        </Dropdown>
        <Dropdown className="tool" ariaLabel="Highlight" label={<span className="tool-text hl-a" style={{ background: markValue(state, 'bg') ?? 'transparent' }}>ab</span>}>
          {(close) => (
            <div className="swatches">
              {HIGHLIGHTS.map((c) => (
                <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`Highlight ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => (close(), run(setMarkValue('bg', c)))} />
              ))}
              <button type="button" className="swatch none" aria-label="No highlight" onMouseDown={(e) => e.preventDefault()} onClick={() => (close(), run(setMarkValue('bg', null)))}>
                ✕
              </button>
            </div>
          )}
        </Dropdown>
        <div className="dropdown">
          {btn('Link', 'link', () => {
            setHref(markValue(state, 'link') ?? 'https://');
            setLinkOpen(!linkOpen);
          }, isMarkActive(state, 'link'))}
          {linkOpen && (
            <form
              className="menu link-pop"
              onSubmit={(e) => {
                e.preventDefault();
                run(setMarkValue('link', href.trim() && href.trim() !== 'https://' ? href.trim() : null));
                setLinkOpen(false);
              }}
            >
              <input className="input" value={href} onChange={(e) => setHref(e.target.value)} autoFocus aria-label="Link address" />
              <div className="row-actions">
                <button className="btn btn-primary btn-sm" type="submit">
                  Apply
                </button>
                <button className="btn btn-text btn-sm" type="button" onClick={() => (run(setMarkValue('link', null)), setLinkOpen(false))}>
                  Remove link
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      <div className="tool-group">
        {(['left', 'center', 'right', 'justify'] as const).map((a) =>
          btn(`Align ${a}`, '', () => run(setParaAttrs({ align: a === 'left' ? null : a })), (para?.attrs.align ?? 'left') === a, <MIcon path={a === 'left' ? mdiFormatAlignLeft : a === 'center' ? mdiFormatAlignCenter : a === 'right' ? mdiFormatAlignRight : mdiFormatAlignJustify} size={18} />),
        )}
      </div>
      <div className="tool-group">
        {btn('Bulleted list', 'ul', () => run(setBlock('li')), para?.attrs.block === 'li')}
        {btn('Numbered list', 'ol', () => run(setBlock('oli')), para?.attrs.block === 'oli')}
        {btn('Checklist', 'check', () => run(setBlock('task')), para?.attrs.block === 'task')}
        {btn('Decrease indent (Shift+Tab)', '', () => run(indent(-1)), false, '⇠')}
        {btn('Increase indent (Tab)', '', () => run(indent(1)), false, '⇢')}
        {btn('Clear formatting', '', () => run(clearFormatting), false, 'T̸')}
      </div>
      <div className="tool-group">
        <Dropdown className="tool tool-insert" ariaLabel="Insert" label={<span className="tool-select-label">+ Insert ▾</span>}>
          {(close) => (
            <div className="insert-menu">
              <span className="menu-group">Media</span>
              {insert('Image (upload)', () => (close(), handle.pickFile('image')))}
              {insert('Free stock photo', () => (close(), document.dispatchEvent(new CustomEvent('cowrite:image-search'))))}
              {insert('Image from link', () => (close(), handle.openDialog('image-url')))}
              {insert('Video / embed', () => (close(), handle.openDialog('embed')))}
              {insert('Map', () => (close(), handle.openDialog('map')))}
              {insert('Link preview card', () => (close(), handle.openDialog('link')))}
              {insert('Voice note', () => (close(), handle.openDialog('record')))}
              {insert('File attachment', () => (close(), handle.pickFile('file')))}
              {insert('Drawing', () => (close(), handle.insertAtom('drawing', { strokes: [], h: 320 })))}
              <span className="menu-group">Blocks</span>
              {insert('Table', () => (close(), handle.insertAtom('table', { rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', ''], ['', '', '']], header: true })))}
              {insert('Equation', () => (close(), handle.insertAtom('math', { tex: 'a^2 + b^2 = c^2' })))}
              {insert('Diagram', () => (close(), handle.insertAtom('mermaid', { code: 'graph LR\n  Idea --> Draft --> Review --> Publish' })))}
              {insert('Table of contents', () => (close(), handle.insertAtom('toc', {})))}
              {insert('Summary card', () => (close(), handle.insertAtom('summary', { text: '' })))}
              {insert('Signature', () => (close(), handle.insertAtom('signature', {})))}
              {insert('Divider', () => (close(), handle.insertAtom('hr', {})))}
              {insert('Page break', () => (close(), handle.insertAtom('pagebreak', {})))}
              <span className="menu-group">Inline</span>
              {insert('Emoji', () => (close(), handle.openDialog('emoji')))}
              {insert('Icon', () => (close(), handle.openDialog('icon')))}
            </div>
          )}
        </Dropdown>
      </div>
      {para?.attrs.block === 'task' && !disabled && (
        <div className="tool-group task-tools" aria-label="Task details">
          <label className="task-field" title="Assign this task">
            <Icon name="users" size={14} />
            <select
              value={(para.attrs.assignee as { id: string } | null)?.id ?? ''}
              onChange={(e) => {
                const p = people.find((x) => x.id === e.target.value);
                run(setParaAttrs({ assignee: p ? { id: p.id, name: p.name } : null }));
                handle.focus();
              }}
              aria-label="Assignee"
            >
              <option value="">Assign…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="task-field" title="Due date">
            <Icon name="calendar" size={14} />
            <input
              type="date"
              value={(para.attrs.due as string | null) ?? ''}
              onChange={(e) => {
                run(setParaAttrs({ due: e.target.value || null }));
              }}
              aria-label="Due date"
            />
          </label>
        </div>
      )}
      {extra}
    </div>
  );
}
