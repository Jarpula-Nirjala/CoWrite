import { useMemo } from 'react';
import { Modal } from '../components/ui.tsx';

interface Node {
  text: string;
  level: number;
  at: number;
  children: Node[];
  x: number;
  y: number;
}

const COLORS = ['#1f3a68', '#b3541e', '#2e7d32', '#6a1b9a', '#0a66c2', '#c62828', '#a8842f'];
const COL = 230;
const ROW = 44;

/** The document's headings as a mind map (left to right). Click a node to jump there. */
export function MindMap({ title, headings, onJump, onClose }: { title: string; headings: { level: number; text: string; at: number }[]; onJump(at: number): void; onClose(): void }) {
  const { root, width, height } = useMemo(() => {
    const root: Node = { text: title, level: 0, at: 0, children: [], x: 0, y: 0 };
    const stack: Node[] = [root];
    for (const h of headings) {
      const node: Node = { text: h.text || 'Untitled', level: h.level, at: h.at, children: [], x: 0, y: 0 };
      while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    // Leaves get consecutive rows; parents sit in the middle of their children.
    let row = 0;
    let depth = 0;
    const place = (n: Node, d: number) => {
      depth = Math.max(depth, d);
      n.x = d * COL;
      if (!n.children.length) n.y = row++ * ROW;
      else {
        n.children.forEach((c) => place(c, d + 1));
        n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2;
      }
    };
    place(root, 0);
    return { root, width: (depth + 1) * COL + 40, height: Math.max(1, row) * ROW + 40 };
  }, [title, headings]);

  const links: React.ReactNode[] = [];
  const nodes: React.ReactNode[] = [];
  const walk = (n: Node, color: string, key: string) => {
    n.children.forEach((c, i) => {
      const col = n.level === 0 ? COLORS[i % COLORS.length] : color;
      const x1 = n.x + 190;
      const x2 = c.x;
      links.push(<path key={`${key}-${i}-l`} d={`M${x1} ${n.y} C${x1 + 30} ${n.y}, ${x2 - 30} ${c.y}, ${x2} ${c.y}`} stroke={col} strokeWidth={n.level === 0 ? 3 : 2} fill="none" opacity={0.7} />);
      walk(c, col, `${key}-${i}`);
    });
    const label = n.text.length > 26 ? `${n.text.slice(0, 25)}…` : n.text;
    nodes.push(
      <g key={key} className="mm-node" transform={`translate(${n.x} ${n.y})`} onClick={() => n.level > 0 && (onJump(n.at), onClose())} role={n.level ? 'button' : undefined}>
        <title>{n.text}</title>
        <rect x={0} y={-16} width={190} height={32} rx={16} fill={n.level === 0 ? '#1f3a68' : '#fff'} stroke={n.level === 0 ? '#1f3a68' : color} strokeWidth={2} />
        <text x={95} y={5} textAnchor="middle" fontSize={n.level === 0 ? 15 : 13.5} fontWeight={n.level <= 1 ? 700 : 400} fill={n.level === 0 ? '#fff' : '#1b1f24'} fontFamily="Georgia, serif">
          {label}
        </text>
      </g>,
    );
  };
  walk(root, COLORS[0], 'r');

  return (
    <Modal title="Mind map" onClose={onClose} wide>
      {!headings.length ? (
        <p className="panel-empty muted">Add headings (Heading 1, 2, 3) to see the document as a mind map.</p>
      ) : (
        <>
          <p className="muted small">Your headings as a map. Click any branch to jump to that part of the document.</p>
          <div className="mindmap">
            <svg viewBox={`-20 -30 ${width} ${height}`} width={Math.min(width, 1400)} style={{ maxWidth: '100%', height: 'auto' }}>
              {links}
              {nodes}
            </svg>
          </div>
        </>
      )}
    </Modal>
  );
}
