import { useEffect, useMemo, useState } from 'react';
import { errorText, type DocKind } from '../api.ts';
import { useAuth } from '../auth.tsx';
import type { Obj } from '../kinds/objects.ts';
import type { El, SlideFields } from '../kinds/slides/model.ts';
import { readDeckFields } from '../kinds/slides/model.ts';
import { SlideView } from '../kinds/slides/SlideView.tsx';
import { themeById } from '../kinds/slides/themes.ts';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { SmartCreate } from '../components/SmartCreate.tsx';
import { Preview } from '../components/TemplateGallery.tsx';
import { Dropdown, Icon, Modal } from '../components/ui.tsx';
import { createAndOpen } from '../lib/create.ts';
import { CATEGORIES, GALLERY, type GalleryItem } from '../lib/gallery.ts';
import { MORE_TAGS, TEMPLATE_TAGS } from '../lib/proTemplates.ts';
import { navigate, useSearch } from '../router.ts';

const STARTERS = ['blank', 'gdoc-paperback', 'gdoc-report-simple', 'gdoc-report-luxe', 'gdoc-mla', 'gdoc-book-report', 'gdoc-class-notes', 'gdoc-lab-report'];
const KIND_FILTERS: { id: DocKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'slides', label: '📊 Slides' },
  { id: 'doc', label: '📄 Docs' },
  { id: 'sheet', label: '📈 Sheets' },
  { id: 'board', label: '🧩 Whiteboards' },
  { id: 'kanban', label: '🗂️ Boards' },
];
const same = (s: string) => Promise.resolve(s);

/** Template centre: AI Smart Create, Google-style document starters and WPS-style categories. */
export function Templates() {
  const { user } = useAuth();
  const search = useSearch();
  const [tab, setTab] = useState<string>('Featured');
  useEffect(() => {
    const cat = new URLSearchParams(search).get('cat') ?? 'Featured';
    setTab(([...TEMPLATE_TAGS, ...MORE_TAGS, ...CATEGORIES, 'All'] as string[]).includes(cat) ? cat : 'Featured');
  }, [search]);
  const [kind, setKind] = useState<DocKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GalleryItem | null>(null);

  useEffect(() => {
    document.title = 'Templates · CoWrite';
  }, []);

  const use = async (item: GalleryItem) => {
    if (!user) return navigate('/signin?next=/templates');
    setBusy(true);
    setError(null);
    try {
      await createAndOpen(item.title, item.kind, item.build());
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const items = useMemo(() => {
    const words = q.toLowerCase().trim();
    return GALLERY.filter((g) => {
      if (kind !== 'all' && g.kind !== kind) return false;
      if (words) return `${g.name} ${g.description} ${(g.tags ?? []).join(' ')}`.toLowerCase().includes(words);
      if (tab === 'All') return true;
      if ((CATEGORIES as string[]).includes(tab)) return g.category === tab;
      return g.tags?.includes(tab);
    });
  }, [tab, kind, q]);

  const inMore = !(TEMPLATE_TAGS as readonly string[]).includes(tab);

  return (
    <div className="page">
      <SiteHeader />
      <main className="templates-page">
        <section className="tpl-hero">
          <div className="container">
            <p className="kicker">Templates</p>
            <h1>Start with something beautiful</h1>
            <p className="muted">Professionally designed documents and presentations, or describe what you need and let AI build it.</p>
            <SmartCreate />
          </div>
        </section>

        <section className="container tpl-starters" aria-label="Start a new document">
          <h2>Start a new document</h2>
          <div className="starter-row">
            {STARTERS.map((id) => GALLERY.find((g) => g.id === id))
              .filter((g): g is GalleryItem => !!g)
              .map((g) => (
                <button key={g.id} className="starter" disabled={busy} onClick={() => void use(g)} type="button">
                  <span className="starter-page">{g.id === 'blank' ? <span className="starter-plus">+</span> : <Preview item={g} />}</span>
                  <span className="starter-name">{g.id === 'blank' ? 'Blank document' : g.name.split(' · ')[0]}</span>
                  {g.name.includes(' · ') && <span className="starter-sub">{g.name.split(' · ')[1]}</span>}
                </button>
              ))}
          </div>
        </section>

        <section className="container tpl-browse" aria-label="Create with template">
          <div className="row-between tpl-browse-head">
            <h2>Create with template</h2>
            <label className="tpl-search">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
            </label>
          </div>
          <nav className="tpl-tabs" aria-label="Categories">
            {TEMPLATE_TAGS.map((t) => (
              <button key={t} className={tab === t && !q ? 'on' : ''} onClick={() => (setTab(t), setQ(''))} type="button">
                {t}
              </button>
            ))}
            <Dropdown label={<>{inMore && !q ? tab : 'More'} ▾</>} className={`tpl-more ${inMore && !q ? 'on' : ''}`} align="left" ariaLabel="More categories">
              {(close) => (
                <>
                  {[...MORE_TAGS, ...CATEGORIES, 'All'].map((t) => (
                    <button key={t} role="menuitem" onClick={() => (setTab(t), setQ(''), close())} type="button">
                      {t === 'All' ? 'All templates' : t}
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
          </nav>
          <div className="tpl-kinds">
            {KIND_FILTERS.map((k) => (
              <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)} type="button">
                {k.label}
              </button>
            ))}
            <span className="muted small">{items.length} templates</span>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="tpl-grid">
            {items.map((g) => (
              <article key={g.id} className={`tpl-card kind-${g.kind}`}>
                <button className="tpl-thumb" onClick={() => (g.kind === 'slides' ? setPreview(g) : void use(g))} disabled={busy} type="button" aria-label={`Use ${g.name}`}>
                  <span className="gallery-preview">
                    <Preview item={g} />
                  </span>
                  <span className="tpl-use">{g.kind === 'slides' ? 'Preview' : 'Use template'}</span>
                </button>
                <div className="tpl-meta">
                  <strong>{g.name}</strong>
                  <span className="muted small">{g.description}</span>
                  {g.tags && (
                    <span className="tpl-tags">
                      {g.tags.slice(0, 2).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </span>
                  )}
                </div>
              </article>
            ))}
            {!items.length && <p className="muted">No templates here yet. Try another category, or describe what you need in Smart Create above.</p>}
          </div>
        </section>
      </main>
      <SiteFooter />
      {preview && <DeckPreview item={preview} busy={busy} onUse={() => void use(preview)} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** Every slide of a deck template, before using it. */
function DeckPreview({ item, busy, onUse, onClose }: { item: GalleryItem; busy: boolean; onUse(): void; onClose(): void }) {
  const content = useMemo(() => item.build(), [item]);
  const deck = readDeckFields((content.settings ?? {}) as Record<string, unknown>);
  const objects = content.objects ?? [];
  const slides = objects
    .filter((o) => o.key.startsWith('slide:'))
    .map((o) => ({ id: o.key.slice(6), key: o.key, f: o.fields as unknown as SlideFields }))
    .sort((a, b) => (a.f.order < b.f.order ? -1 : 1));
  const [cur, setCur] = useState(0);
  const els = (sid: string): Obj<El>[] => objects.filter((o) => o.key.startsWith('el:') && o.fields.slide === sid).map((o) => ({ id: o.key.slice(3), key: o.key, f: o.fields as unknown as El }));
  const theme = themeById(deck.theme);
  const main = slides[cur];
  const width = Math.min(720, window.innerWidth - 80);
  return (
    <Modal title={item.name} onClose={onClose} wide>
      <div className="deck-preview">
        <div className="deck-main">{main && <SlideView slide={main} els={els(main.id)} theme={theme} deck={deck} width={width} index={cur} total={slides.length} resolve={same} />}</div>
        <div className="deck-strip">
          {slides.map((s, i) => (
            <button key={s.id} className={i === cur ? 'on' : ''} onClick={() => setCur(i)} type="button" aria-label={`Slide ${i + 1}`}>
              <SlideView slide={s} els={els(s.id)} theme={theme} deck={{ ...deck, numbers: false }} width={128} index={i} total={slides.length} resolve={same} />
            </button>
          ))}
        </div>
        <div className="row-between">
          <span className="muted small">
            {slides.length} slides · {theme.name} theme · {item.description}
          </span>
          <button className="btn btn-primary" disabled={busy} onClick={onUse} type="button">
            Use this template
          </button>
        </div>
      </div>
    </Modal>
  );
}
