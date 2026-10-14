import { insertChip, setBlock } from './commands.ts';
import type { RichHandle } from './RichEditor.tsx';

export interface SlashItem {
  id: string;
  label: string;
  group: string;
  icon: string;
  keywords: string;
  needsAi?: boolean;
  run(h: RichHandle): void;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Everything the “/” menu can insert. */
export const SLASH_ITEMS: SlashItem[] = [
  { id: 'p', label: 'Text', group: 'Basic', icon: 'list', keywords: 'paragraph plain', run: (h) => h.run(setBlock('p')) },
  { id: 'h1', label: 'Heading 1', group: 'Basic', icon: 'list', keywords: 'title h1 big', run: (h) => h.run(setBlock('h', { level: 1 })) },
  { id: 'h2', label: 'Heading 2', group: 'Basic', icon: 'list', keywords: 'subtitle h2', run: (h) => h.run(setBlock('h', { level: 2 })) },
  { id: 'h3', label: 'Heading 3', group: 'Basic', icon: 'list', keywords: 'h3 small heading', run: (h) => h.run(setBlock('h', { level: 3 })) },
  { id: 'li', label: 'Bulleted list', group: 'Basic', icon: 'ul', keywords: 'bullet unordered list', run: (h) => h.run(setBlock('li')) },
  { id: 'oli', label: 'Numbered list', group: 'Basic', icon: 'ol', keywords: 'ordered number list', run: (h) => h.run(setBlock('oli')) },
  { id: 'task', label: 'To-do / task', group: 'Basic', icon: 'check', keywords: 'todo checkbox task checklist assign', run: (h) => h.run(setBlock('task')) },
  { id: 'quote', label: 'Quote', group: 'Basic', icon: 'quote', keywords: 'blockquote citation', run: (h) => h.run(setBlock('quote')) },
  { id: 'callout', label: 'Callout', group: 'Basic', icon: 'sparkle', keywords: 'note tip warning info box', run: (h) => h.run(setBlock('callout', { emoji: '💡', tone: 'info' })) },
  { id: 'code', label: 'Code block', group: 'Basic', icon: 'code', keywords: 'code snippet programming syntax', run: (h) => h.run(setBlock('code')) },
  { id: 'image', label: 'Image upload', group: 'Media', icon: 'upload', keywords: 'picture photo upload', run: (h) => h.pickFile('image') },
  { id: 'image-search', label: 'Free stock photo', group: 'Media', icon: 'search', keywords: 'image search unsplash stock photo web', run: () => document.dispatchEvent(new CustomEvent('cowrite:image-search')) },
  { id: 'image-url', label: 'Image from link', group: 'Media', icon: 'link', keywords: 'image url', run: (h) => h.openDialog('image-url') },
  { id: 'embed', label: 'Embed video / media', group: 'Media', icon: 'play', keywords: 'youtube vimeo loom spotify figma twitter codepen gist embed video', run: (h) => h.openDialog('embed') },
  { id: 'map', label: 'Map', group: 'Media', icon: 'eye', keywords: 'google maps location place address', run: (h) => h.openDialog('map') },
  { id: 'link', label: 'Link preview card', group: 'Media', icon: 'link', keywords: 'bookmark url website card unfurl', run: (h) => h.openDialog('link') },
  { id: 'audio', label: 'Voice note', group: 'Media', icon: 'mic', keywords: 'audio record voice microphone', run: (h) => h.openDialog('record') },
  { id: 'file', label: 'File attachment', group: 'Media', icon: 'file', keywords: 'attach pdf document upload file', run: (h) => h.pickFile('file') },
  { id: 'drawing', label: 'Drawing', group: 'Media', icon: 'branch', keywords: 'sketch draw pen whiteboard doodle', run: (h) => h.insertAtom('drawing', { strokes: [], h: 320 }) },
  { id: 'table', label: 'Table', group: 'Advanced', icon: 'table', keywords: 'grid rows columns table', run: (h) => h.insertAtom('table', { rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', ''], ['', '', '']], header: true }) },
  { id: 'math', label: 'Equation', group: 'Advanced', icon: 'code', keywords: 'math latex formula equation katex', run: (h) => h.insertAtom('math', { tex: 'e^{i\\pi} + 1 = 0' }) },
  { id: 'math-inline', label: 'Inline equation', group: 'Advanced', icon: 'code', keywords: 'math inline latex', run: (h) => h.run(insertChip('math', { tex: prompt('LaTeX for the inline equation', 'x^2') ?? 'x^2' })) },
  { id: 'mermaid', label: 'Diagram (flowchart)', group: 'Advanced', icon: 'branch', keywords: 'mermaid flowchart diagram sequence gantt chart', run: (h) => h.insertAtom('mermaid', { code: 'graph LR\n  Idea --> Draft --> Review --> Publish' }) },
  { id: 'toc', label: 'Table of contents', group: 'Advanced', icon: 'list', keywords: 'toc contents outline index', run: (h) => h.insertAtom('toc', {}) },
  { id: 'summary', label: 'Summary card', group: 'Advanced', icon: 'sparkle', keywords: 'summary tldr ai abstract', run: (h) => h.insertAtom('summary', { text: '' }) },
  { id: 'signature', label: 'Signature', group: 'Advanced', icon: 'keyboard', keywords: 'sign signature esign approve', run: (h) => h.insertAtom('signature', {}) },
  { id: 'hr', label: 'Divider', group: 'Advanced', icon: 'hr', keywords: 'line separator hr rule', run: (h) => h.insertAtom('hr', {}) },
  { id: 'pagebreak', label: 'Page break', group: 'Advanced', icon: 'file', keywords: 'page break print new page', run: (h) => h.insertAtom('pagebreak', {}) },
  { id: 'date', label: 'Today’s date', group: 'Inline', icon: 'clock', keywords: 'date today time', run: (h) => h.run(insertChip('date', { date: today() })) },
  { id: 'emoji', label: 'Emoji', group: 'Inline', icon: 'star', keywords: 'emoji smiley icon', run: (h) => h.openDialog('emoji') },
  { id: 'icon', label: 'Icon', group: 'Inline', icon: 'star', keywords: 'icon symbol', run: (h) => h.openDialog('icon') },
];
