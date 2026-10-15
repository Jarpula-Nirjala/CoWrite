import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api.ts';
import type { Token } from '../../../shared/crdt.ts';
import type { Obj } from '../kinds/objects.ts';
import { Sheet, display } from '../kinds/sheet/formula.ts';
import { readDeckFields, type El, type SlideFields } from '../kinds/slides/model.ts';
import { SlideView } from '../kinds/slides/SlideView.tsx';
import { themeById } from '../kinds/slides/themes.ts';
import { CATEGORIES, GALLERY, type Category, type GalleryItem } from '../lib/gallery.ts';
import { DEFAULT_SETTINGS, paperProps, type DocSettings } from '../rich/settings.ts';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import { Modal } from './ui.tsx';

const KIND_ICON: Record<string, string> = { doc: '📄', slides: '📊', board: '🧩', kanban: '🗂️', sheet: '📈' };
const same = (s: string) => Promise.resolve(s);

/** The “New from template” dialog with live previews of every template. */
export function TemplateGallery({
  onPick,
  onPickTeam,
  onClose,
  busy,
  initial,
}: {
  onPick(item: GalleryItem): void;
  onPickTeam?(t: { id: string; title: string }): void;
  onClose(): void;
  busy: boolean;
  initial?: Category;
}) {
  const [cat, setCat] = useState<Category | 'All' | 'Team'>(initial ?? 'All');
  const [q, setQ] = useState('');
  const [team, setTeam] = useState<{ id: string; title: string; kind: string; workspace: string }[]>([]);
  useEffect(() => {
    if (onPickTeam) api<{ templates: typeof team }>('/templates/team').then((r) => setTeam(r.templates), () => {});
  }, [onPickTeam]);
  const items = GALLERY.filter((g) => (cat === 'All' || cat === 'Team' || g.category === cat) && (!q || `${g.name} ${g.description}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Modal title="Start from a template" onClose={onClose} wide>
      <div className="gallery-head">
        <div className="gallery-tabs" role="tablist">
          {([...(team.length ? ['Team' as const] : []), 'All' as const, ...CATEGORIES]).map((c) => (
            <button key={c} role="tab" aria-selected={cat === c} className={`gallery-tab ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)} type="button">
              {c === 'Team' ? '👥 Team templates' : c}
            </button>
          ))}
        </div>
        <input className="gallery-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
      </div>
      <div className="gallery-grid">
        {cat === 'Team' &&
          team
            .filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()))
            .map((t) => (
              <button key={t.id} className="gallery-card" disabled={busy} onClick={() => onPickTeam?.(t)} type="button">
                <span className="gallery-preview team-preview">
                  <span>{KIND_ICON[t.kind] ?? '📄'}</span>
                </span>
                <span className="gallery-name">{t.title}</span>
                <span className="muted small">From the “{t.workspace}” workspace</span>
              </button>
            ))}
        {cat !== 'Team' && items.map((g) => (
          <button key={g.id} className="gallery-card" disabled={busy} onClick={() => onPick(g)} type="button">
            <span className="gallery-preview">
              <Preview item={g} />
            </span>
            <span className="gallery-name">
              <span aria-hidden>{KIND_ICON[g.kind]}</span> {g.name}
            </span>
            <span className="muted small">{g.description}</span>
          </button>
        ))}
        {cat !== 'Team' && !items.length && <p className="muted">No templates match “{q}”.</p>}
      </div>
    </Modal>
  );
}

export function Preview({ item }: { item: GalleryItem }) {
  const content = useMemo(() => item.build(), [item]);
  const objects = content.objects ?? [];
  switch (item.kind) {
    case 'doc': {
      const settings: DocSettings = { ...DEFAULT_SETTINGS, ...(content.settings ?? {}) };
      const tokens: Token[] = content.tokens.slice(0, 900).map((t, i) => ({ id: ['tpl', i + 1], ch: t.ch, attrs: (t.a ?? {}) as Token['attrs'] }));
      const paper = paperProps(settings);
      return (
        <span className="tpl-doc-wrap">
          <article className={`${paper.className} tpl-doc`} style={paper.style} data-font={settings.font}>
            {(settings.brandName || settings.header) && (
              <header className="paper-header">
                <span className="paper-brand">{settings.brandName}</span>
                <span className="paper-header-text">{settings.header}</span>
              </header>
            )}
            {settings.dateHeader && <div className="diary-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>}
            <StaticDoc tokens={tokens} resolve={same} />
          </article>
        </span>
      );
    }
    case 'slides': {
      const deck = readDeckFields((content.settings ?? {}) as Record<string, unknown>);
      const slides = objects.filter((o) => o.key.startsWith('slide:')).map((o) => ({ id: o.key.slice(6), key: o.key, f: o.fields as unknown as SlideFields }));
      const first = slides.sort((a, b) => (a.f.order < b.f.order ? -1 : 1))[0];
      if (!first) return null;
      const els: Obj<El>[] = objects.filter((o) => o.key.startsWith('el:') && o.fields.slide === first.id).map((o) => ({ id: o.key.slice(3), key: o.key, f: o.fields as unknown as El }));
      return (
        <span className="tpl-center">
          <SlideView slide={first} els={els} theme={themeById(deck.theme, deck.custom)} deck={{ ...deck, numbers: false }} width={236} index={0} total={slides.length} resolve={same} />
          {slides.length > 1 && <span className="tpl-badge">{slides.length} slides</span>}
        </span>
      );
    }
    case 'board':
      return <BoardPreview objects={objects} bg={String((content.settings as Record<string, unknown> | undefined)?.bg ?? 'dots')} />;
    case 'kanban': {
      const cols = objects.filter((o) => o.key.startsWith('col:'));
      return (
        <span className="tpl-kanban">
          {cols.map((c) => {
            const n = objects.filter((o) => o.fields.col === c.key.slice(4)).length;
            return (
              <span key={c.key} className="tpl-col" style={{ '--col': String(c.fields.color) } as CSSProperties}>
                <b>{String(c.fields.title)}</b>
                {Array.from({ length: Math.max(1, Math.min(3, n)) }, (_, i) => (
                  <i key={i} className={n ? '' : 'ghost'} />
                ))}
              </span>
            );
          })}
        </span>
      );
    }
    case 'sheet': {
      const cells = new Map(objects.filter((o) => o.key.startsWith('cell:')).map((o) => [o.key.slice(5), o.fields as { v?: string; b?: boolean; bg?: string; color?: string; fmt?: string }]));
      const sheet = new Sheet((r) => cells.get(r)?.v);
      const cols = ['A', 'B', 'C', 'D', 'E'];
      return (
        <span className="tpl-sheet">
          <table>
            <tbody>
              {Array.from({ length: 7 }, (_, r) => (
                <tr key={r}>
                  {cols.map((c) => {
                    const cell = cells.get(`${c}${r + 1}`);
                    return (
                      <td key={c} style={{ background: cell?.bg, color: cell?.color, fontWeight: cell?.b ? 700 : 400 }}>
                        {cell?.v ? display(sheet.value(`${c}${r + 1}`), cell.fmt) : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {objects.some((o) => o.key.startsWith('chart:')) && <span className="tpl-badge">with chart</span>}
        </span>
      );
    }
    default:
      return null;
  }
}

function BoardPreview({ objects, bg }: { objects: { key: string; fields: Record<string, unknown> }[]; bg: string }) {
  const items = objects.map((o) => ({ id: o.key.slice(5), ...(o.fields as { kind: string; x: number; y: number; w: number; h: number; fill?: string; text?: string; from?: string; to?: string }) }));
  const boxes = items.filter((i) => i.kind !== 'arrow');
  if (!boxes.length) return <span className={`tpl-board bg-${bg}`} />;
  const x1 = Math.min(...boxes.map((b) => b.x)) - 40;
  const y1 = Math.min(...boxes.map((b) => b.y)) - 60;
  const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + 40;
  const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + 40;
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <span className={`tpl-board bg-${bg}`}>
      <svg viewBox={`${x1} ${y1} ${x2 - x1} ${y2 - y1}`} preserveAspectRatio="xMidYMid meet">
        {items
          .filter((i) => i.kind === 'frame')
          .map((i) => (
            <g key={i.id}>
              <rect x={i.x} y={i.y} width={i.w} height={i.h} rx={8} fill="#fff" stroke="#9aa3b0" strokeWidth={3} />
              <text x={i.x + 6} y={i.y - 14} fontSize={28} fill="#4a5260" fontFamily="Segoe UI, Arial">
                {i.text}
              </text>
            </g>
          ))}
        {items
          .filter((i) => i.kind === 'arrow')
          .map((i) => {
            const a = byId.get(i.from ?? '');
            const b = byId.get(i.to ?? '');
            return a && b ? <line key={i.id} x1={a.x + a.w / 2} y1={a.y + a.h / 2} x2={b.x + b.w / 2} y2={b.y + b.h / 2} stroke="#6b7785" strokeWidth={4} /> : null;
          })}
        {items
          .filter((i) => i.kind !== 'frame' && i.kind !== 'arrow')
          .map((i) =>
            i.kind === 'text' ? (
              <text key={i.id} x={i.x} y={i.y + 40} fontSize={44} fontWeight={600} fill="#1b1f24" fontFamily="Segoe UI, Arial">
                {i.text}
              </text>
            ) : i.kind === 'ellipse' ? (
              <ellipse key={i.id} cx={i.x + i.w / 2} cy={i.y + i.h / 2} rx={i.w / 2} ry={i.h / 2} fill={i.fill ?? '#fff'} stroke="#1f3a68" strokeWidth={4} />
            ) : i.kind === 'diamond' ? (
              <path key={i.id} d={`M${i.x + i.w / 2} ${i.y}L${i.x + i.w} ${i.y + i.h / 2}L${i.x + i.w / 2} ${i.y + i.h}L${i.x} ${i.y + i.h / 2}Z`} fill={i.fill ?? '#fff'} stroke="#1b1f24" strokeWidth={4} />
            ) : (
              <rect key={i.id} x={i.x} y={i.y} width={i.w} height={i.h} rx={i.kind === 'sticky' ? 4 : 10} fill={i.fill ?? '#fff'} stroke={i.kind === 'sticky' ? 'none' : '#0a66c2'} strokeWidth={4} />
            ),
          )}
      </svg>
    </span>
  );
}
