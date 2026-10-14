import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import type { Attrs } from '../../../../shared/crdt.ts';
import { Dropdown, Icon } from '../../components/ui.tsx';
import { ImageSearch } from '../../editor/imageSearch.tsx';
import { downscale, pickFile } from '../../editor/useFiles.ts';
import { throttle } from '../api.ts';
import type { KindProps } from '../KindPage.tsx';
import { keyBetween, uid, useObjects, type Obj } from '../objects.ts';
import { exportDeckPdf, exportDeckPptx, exportSlidePng, type DeckData } from './export.ts';
import { layoutElements, readDeck, type El, type SlideFields } from './model.ts';
import { SlideView, type Remote } from './SlideView.tsx';
import { LAYOUTS, SLIDE_THEMES, themeById, type LayoutId } from './themes.ts';

type Box = { x: number; y: number; w: number; h: number };

const FONTS: { label: string; value: string | null }[] = [
  { label: 'Theme font', value: null },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Garamond', value: 'Garamond, Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Segoe UI', value: "'Segoe UI', Arial, sans-serif" },
  { label: 'Trebuchet', value: "'Trebuchet MS', sans-serif" },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'Handwriting', value: "'Caveat', cursive" },
];

const SWATCHES = ['#ffffff', '#f4f1ea', '#111418', '#1f3a68', '#0a66c2', '#1aa3c8', '#3d7a4a', '#c8a24a', '#e06666', '#b3261e', '#6b3fa0', '#ff9a6b'];

const SHAPES: { id: NonNullable<El['shape']>; label: string }[] = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'round', label: 'Rounded box' },
  { id: 'ellipse', label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'star', label: 'Star' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'line', label: 'Line' },
];

const preview = (layout: LayoutId): { slide: Obj<SlideFields>; els: Obj<El>[] } => ({
  slide: { id: 'p', key: 'slide:p', f: { order: 'a', layout } },
  els: layoutElements(layout, 'p').map((e, i) => ({ id: String(i), key: `el:${i}`, f: e as El })),
});

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default function SlidesEditor(p: KindProps) {
  const { api, canEdit, client } = p;
  const { doc, version } = api;
  const slides = useObjects<SlideFields>(doc, 'slide', version);
  const allEls = useObjects<El>(doc, 'el', version);
  const deck = useMemo(() => readDeck(doc), [doc, version]);
  const theme = themeById(deck.theme);
  const [curId, setCur] = useState<string | null>(null);
  const cur = slides.find((s) => s.id === curId) ?? slides[0] ?? null;
  const curIndex = cur ? slides.indexOf(cur) : -1;
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [over, setOver] = useState<Record<string, Box>>({});
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [presenting, setPresenting] = useState<number | null>(null);
  const [imageSearch, setImageSearch] = useState<null | { target: 'new' | 'bg' | string }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const clipboard = useRef<El[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 900, h: 600 });

  const els = useMemo(() => allEls.filter((e) => cur && e.f.slide === cur.id).map((e) => (over[e.id] ? { ...e, f: { ...e.f, ...over[e.id] } } : e)), [allEls, cur, over]);
  const elsBySlide = useMemo(() => {
    const m = new Map<string, Obj<El>[]>();
    for (const e of allEls) m.set(e.f.slide, [...(m.get(e.f.slide) ?? []), e]);
    return m;
  }, [allEls]);
  const sel = els.filter((e) => selected.includes(e.id));
  const first = sel[0]?.f;
  const maxZ = els.reduce((m, e) => Math.max(m, e.f.z), 0);

  useEffect(() => {
    const n = stage.current;
    if (!n) return;
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(n);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(320, Math.min(stageSize.w - 40, ((stageSize.h - 30) * 16) / 9));
  const scale = width / 960;

  // Drop the selection when the slide changes or elements disappear.
  useEffect(() => {
    setSelected((s) => s.filter((id) => els.some((e) => e.id === id)));
  }, [els]);
  useEffect(() => {
    setSelected([]);
    setEditing(null);
  }, [cur?.id]);

  // ------------------------------------------------------------ presence

  const sendPresence = useMemo(() => throttle((x: number | undefined, y: number | undefined, focus: string) => client.setExt({ x, y, focus }), 70), [client]);
  useEffect(() => {
    if (cur) sendPresence(undefined, undefined, `${cur.id}|${selected[0] ?? ''}`);
  }, [cur, selected, sendPresence]);
  const remotes: Remote[] = useMemo(
    () =>
      p.peers
        .filter((peer) => peer.ext?.focus?.startsWith(`${cur?.id}|`))
        .map((peer) => ({ site: peer.site, name: peer.name, color: peer.color, focus: peer.ext!.focus!.split('|')[1] || null, x: peer.ext!.x, y: peer.ext!.y })),
    [p.peers, cur?.id],
  );
  const followed = p.follow ? p.peers.find((x) => x.site === p.follow) : null;
  const followSlide = followed?.ext?.focus?.split('|')[0];
  useEffect(() => {
    if (followSlide && slides.some((s) => s.id === followSlide)) setCur(followSlide);
  }, [followSlide, slides]);

  // ------------------------------------------------------------ edits

  const setEl = (id: string, f: Partial<El>) => api.set(`el:${id}`, f as Attrs);
  const setSel = (f: Partial<El>) => api.group(() => selected.forEach((id) => setEl(id, f)));

  const addSlide = (layout: LayoutId, after: Obj<SlideFields> | null | undefined = cur) => {
    const i = after ? slides.indexOf(after) : slides.length - 1;
    const prev = slides[i]?.f.order ?? null;
    const next = slides[i + 1]?.f.order ?? null;
    let id = '';
    api.group(() => {
      id = uid();
      api.set(`slide:${id}`, { order: keyBetween(prev, next), layout, notes: '' });
      for (const el of layoutElements(layout, id)) api.set(`el:${uid()}`, el as Attrs);
    });
    setCur(id);
  };

  const duplicateSlide = (s: Obj<SlideFields>) => {
    const i = slides.indexOf(s);
    const id = uid();
    api.group(() => {
      api.set(`slide:${id}`, { ...s.f, order: keyBetween(s.f.order, slides[i + 1]?.f.order ?? null) } as Attrs);
      for (const e of elsBySlide.get(s.id) ?? []) api.set(`el:${uid()}`, { ...e.f, slide: id } as Attrs);
    });
    setCur(id);
  };

  const deleteSlide = (s: Obj<SlideFields>) => {
    const i = slides.indexOf(s);
    api.group(() => {
      for (const e of elsBySlide.get(s.id) ?? []) api.remove(e.key);
      api.remove(s.key);
    });
    setCur(slides[i + 1]?.id ?? slides[i - 1]?.id ?? null);
  };

  const moveSlide = (id: string, to: number) => {
    const rest = slides.filter((s) => s.id !== id);
    api.set(`slide:${id}`, { order: keyBetween(rest[to - 1]?.f.order ?? null, rest[to]?.f.order ?? null) });
  };

  const addEl = (f: Partial<El>) => {
    if (!cur) return;
    const id = uid();
    api.set(`el:${id}`, { slide: cur.id, z: maxZ + 1, ...f } as Attrs);
    setSelected([id]);
    return id;
  };

  const addText = () => {
    const id = addEl({ kind: 'text', role: 'body', x: 280, y: 220, w: 400, h: 90, size: 28, text: 'Your text here', align: 'left' });
    if (id) setEditing(id);
  };

  const addShape = (shape: NonNullable<El['shape']>) =>
    addEl(shape === 'line' ? { kind: 'shape', shape, x: 330, y: 260, w: 300, h: 20, strokeW: 4 } : { kind: 'shape', shape, x: 380, y: 170, w: 200, h: shape === 'arrow' ? 120 : 200, fill: theme.accent });

  const imageBox = async (src: string, resolve: (s: string) => Promise<string>): Promise<Box> => {
    try {
      const url = await resolve(src);
      const img = await new Promise<HTMLImageElement>((ok, no) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = no;
        i.src = url;
      });
      const k = Math.min(520 / img.width, 360 / img.height);
      const w = Math.round(img.width * k);
      const h = Math.round(img.height * k);
      return { x: (960 - w) / 2, y: (540 - h) / 2, w, h };
    } catch {
      return { x: 260, y: 120, w: 440, h: 300 };
    }
  };

  const placeImage = async (src: string, target: 'new' | 'bg' | string, credit?: string) => {
    if (target === 'bg') {
      if (cur) api.set(cur.key, { bgImage: src });
    } else if (target === 'new') addEl({ kind: 'image', src, fit: 'cover', credit, ...(await imageBox(src, p.resolve)) });
    else setEl(target, { src, credit });
  };

  const uploadImage = async (target: 'new' | 'bg' | string) => {
    const file = await pickFile('image/*');
    if (!file) return;
    setBusy('Uploading image…');
    try {
      const up = await p.upload(await downscale(file), file.name);
      await placeImage(up.src, target);
    } catch (e) {
      p.flash((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const imageFromLink = (target: 'new' | 'bg' | string) => {
    const url = window.prompt('Paste an image link (https://…)')?.trim();
    if (url && /^https?:\/\//.test(url)) void placeImage(url, target);
  };

  const removeSelected = () => api.group(() => selected.forEach((id) => api.remove(`el:${id}`)));

  const duplicateSelected = (dx = 20) => {
    const ids: string[] = [];
    api.group(() => {
      sel.forEach((e, i) => {
        const id = uid();
        ids.push(id);
        api.set(`el:${id}`, { ...e.f, x: e.f.x + dx, y: e.f.y + dx, z: maxZ + 1 + i } as Attrs);
      });
    });
    setSelected(ids);
  };

  const paste = () => {
    if (!cur || !clipboard.current.length) return;
    const ids: string[] = [];
    api.group(() =>
      clipboard.current.forEach((f, i) => {
        const id = uid();
        ids.push(id);
        api.set(`el:${id}`, { ...f, slide: cur.id, x: f.x + 16, y: f.y + 16, z: maxZ + 1 + i } as Attrs);
      }),
    );
    setSelected(ids);
  };

  const arrange = (dir: 'front' | 'back') => {
    const zs = els.map((e) => e.f.z);
    const base = dir === 'front' ? Math.max(...zs) + 1 : Math.min(...zs) - sel.length;
    api.group(() => sel.forEach((e, i) => setEl(e.id, { z: base + i })));
  };

  // ------------------------------------------------------------ dragging

  const onElPointerDown = (e: RPointerEvent, id: string, handle?: string) => {
    if (!canEdit || editing === id || e.button !== 0) return;
    e.stopPropagation();
    let ids = selected;
    if (e.shiftKey) ids = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    else if (!selected.includes(id)) ids = [id];
    setSelected(ids);
    if (editing) setEditing(null);
    const start = new Map(els.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.f.x, y: x.f.y, w: x.f.w, h: x.f.h, kind: x.f.kind }]));
    const px = e.clientX;
    const py = e.clientY;
    let moved = false;
    let latest: Record<string, Box> = {};
    const commit = throttle((boxes: Record<string, Box>) => {
      for (const [k, b] of Object.entries(boxes)) setEl(k, { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
    }, 120);
    const others = els.filter((x) => !ids.includes(x.id));
    const vLines = [0, 480, 960, ...others.flatMap((o) => [o.f.x, o.f.x + o.f.w / 2, o.f.x + o.f.w])];
    const hLines = [0, 270, 540, ...others.flatMap((o) => [o.f.y, o.f.y + o.f.h / 2, o.f.y + o.f.h])];

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - px) / scale;
      const dy = (ev.clientY - py) / scale;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      if (!moved) {
        moved = true;
        api.begin();
      }
      const out: Record<string, Box> = {};
      const g = { v: [] as number[], h: [] as number[] };
      for (const [k, b] of start) {
        let { x, y, w, h } = b;
        if (!handle) {
          x += dx;
          y += dy;
          if (start.size === 1 && !ev.altKey) {
            const snap = (pos: number[], lines: number[], acc: number[]) => {
              for (const [i, v] of pos.entries()) {
                const hit = lines.find((l) => Math.abs(l - v) < 6 / scale);
                if (hit !== undefined) {
                  acc.push(hit);
                  return hit - v + (i === 0 ? 0 : 0);
                }
              }
              return 0;
            };
            x += snap([x, x + w / 2, x + w], vLines, g.v);
            y += snap([y, y + h / 2, y + h], hLines, g.h);
          }
        } else {
          if (handle.includes('e')) w = b.w + dx;
          if (handle.includes('w')) {
            w = b.w - dx;
            x = b.x + dx;
          }
          if (handle.includes('s')) h = b.h + dy;
          if (handle.includes('n')) {
            h = b.h - dy;
            y = b.y + dy;
          }
          if (handle.length === 2 && (b.kind === 'image' || ev.shiftKey)) {
            const r = b.w / b.h;
            if (w / h > r) w = h * r;
            else h = w / r;
            if (handle.includes('w')) x = b.x + b.w - w;
            if (handle.includes('n')) y = b.y + b.h - h;
          }
          if (w < 16) {
            if (handle.includes('w')) x -= 16 - w;
            w = 16;
          }
          if (h < 12) {
            if (handle.includes('n')) y -= 12 - h;
            h = 12;
          }
        }
        out[k] = { x, y, w, h };
      }
      latest = out;
      setOver(out);
      setGuides(g);
      commit(out);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        commit.flush();
        commit(latest);
        commit.flush();
        api.end();
      }
      setOver({});
      setGuides({ v: [], h: [] });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onDouble = (id: string) => {
    if (!canEdit) return;
    const el = els.find((e) => e.id === id)?.f;
    if (!el) return;
    if (el.kind === 'image') void uploadImage(id);
    else setEditing(id);
  };

  // ------------------------------------------------------------ keyboard

  useEffect(() => {
    if (presenting !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || editing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        api.redo();
        return;
      }
      if (e.key === 'F5' || (mod && e.key === 'Enter')) {
        e.preventDefault();
        setPresenting(Math.max(0, curIndex));
        return;
      }
      if (!canEdit) {
        if (e.key === 'ArrowDown' || e.key === 'PageDown') setCur(slides[curIndex + 1]?.id ?? cur?.id ?? null);
        if (e.key === 'ArrowUp' || e.key === 'PageUp') setCur(slides[curIndex - 1]?.id ?? cur?.id ?? null);
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        paste();
        return;
      }
      if (mod && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        addSlide('title-content');
        return;
      }
      if (!selected.length) {
        if (e.key === 'ArrowDown' || e.key === 'PageDown') setCur(slides[curIndex + 1]?.id ?? cur?.id ?? null);
        if (e.key === 'ArrowUp' || e.key === 'PageUp') setCur(slides[curIndex - 1]?.id ?? cur?.id ?? null);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && e.key.toLowerCase() === 'c') {
        clipboard.current = sel.map((x) => ({ ...x.f }));
      } else if (mod && e.key.toLowerCase() === 'x') {
        clipboard.current = sel.map((x) => ({ ...x.f }));
        removeSelected();
      } else if (e.key === 'Escape') setSelected([]);
      else if (e.key === 'Enter' && sel.length === 1 && sel[0].f.kind !== 'image') {
        e.preventDefault();
        setEditing(sel[0].id);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        api.group(() => sel.forEach((x) => setEl(x.id, { x: x.f.x + dx, y: x.f.y + dy })));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------ export

  const data: DeckData = { slides, els: allEls, deck };
  const runExport = async (what: 'pptx' | 'pdf' | 'png') => {
    setBusy(what === 'pptx' ? 'Building PowerPoint file…' : what === 'pdf' ? 'Building PDF…' : 'Rendering slide…');
    try {
      if (what === 'pptx') await exportDeckPptx(p.title, data, p.resolve);
      else if (what === 'pdf') await exportDeckPdf(p.title, data, p.resolve);
      else await exportSlidePng(p.title, data, Math.max(0, curIndex), p.resolve);
    } catch (e) {
      p.flash(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------ render

  if (!slides.length) {
    return (
      <div className="slides-empty">
        <h2>This presentation has no slides yet</h2>
        {canEdit ? (
          <>
            <p className="muted">Pick a theme and add your first slide.</p>
            <div className="theme-grid">
              {SLIDE_THEMES.map((t) => (
                <button key={t.id} className={`theme-card ${t.id === deck.theme ? 'active' : ''}`} onClick={() => api.set('settings', { theme: t.id })} type="button">
                  <SlideView {...preview('title')} theme={t} deck={{ ...deck, logo: null, footer: '' }} width={180} index={0} total={1} resolve={p.resolve} />
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-primary" onClick={() => addSlide('title', null)} type="button">
              <Icon name="plus" size={15} /> Add title slide
            </button>
          </>
        ) : (
          <p className="muted">The owner has not added any slides.</p>
        )}
      </div>
    );
  }

  return (
    <div className="slides-editor">
      {canEdit && (
        <div className="slides-toolbar" role="toolbar" aria-label="Slides toolbar">
          <button className="tb-btn" onClick={api.undo} disabled={!api.canUndo} title="Undo (Ctrl+Z)" type="button">
            <Icon name="undo" size={16} />
          </button>
          <button className="tb-btn" onClick={api.redo} disabled={!api.canRedo} title="Redo (Ctrl+Y)" type="button">
            <Icon name="redo" size={16} />
          </button>
          <span className="tb-sep" />
          <Dropdown label={<><Icon name="plus" size={15} /> New slide</>} className="btn btn-primary btn-sm" align="left">
            {(close) => (
              <div className="layout-menu">
                {LAYOUTS.map((l) => (
                  <button key={l.id} className="layout-item" onClick={() => (addSlide(l.id), close())} type="button">
                    <SlideView {...preview(l.id)} theme={theme} deck={{ ...deck, logo: null, footer: '', numbers: false }} width={132} index={0} total={1} resolve={p.resolve} />
                    <span>{l.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
          <span className="tb-sep" />
          <button className="tb-btn wide" onClick={addText} type="button" title="Text box">
            <span className="tb-glyph">T</span> Text
          </button>
          <Dropdown label={<><Icon name="upload" size={15} /> Image</>} className="tb-btn wide" align="left">
            {(close) => (
              <div className="menu-col">
                <button className="menu-item" onClick={() => (close(), void uploadImage('new'))} type="button">
                  Upload from computer
                </button>
                <button className="menu-item" onClick={() => (close(), setImageSearch({ target: 'new' }))} type="button">
                  Search free photos
                </button>
                <button className="menu-item" onClick={() => (close(), imageFromLink('new'))} type="button">
                  From a link
                </button>
              </div>
            )}
          </Dropdown>
          <Dropdown label={<><span className="tb-glyph">◆</span> Shape</>} className="tb-btn wide" align="left">
            {(close) => (
              <div className="shape-menu">
                {SHAPES.map((s) => (
                  <button key={s.id} className="shape-item" onClick={() => (addShape(s.id), close())} title={s.label} type="button">
                    <svg viewBox="0 0 40 30" width="40" height="30">
                      <ShapeIcon shape={s.id} color={theme.accent} />
                    </svg>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
          <span className="tb-sep" />
          <Dropdown label={<><span className="swatch" style={{ background: theme.titleBg ?? theme.bg }} /> Theme</>} className="tb-btn wide" align="left">
            {(close) => (
              <div className="theme-grid in-menu">
                {SLIDE_THEMES.map((t) => (
                  <button key={t.id} className={`theme-card ${t.id === deck.theme ? 'active' : ''}`} onClick={() => (api.set('settings', { theme: t.id }), close())} type="button">
                    <SlideView {...preview('title')} theme={t} deck={{ ...deck, logo: null, footer: '', numbers: false }} width={150} index={0} total={1} resolve={p.resolve} />
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
          <Dropdown label="Background" className="tb-btn wide" align="left">
            {(close) => (
              <div className="menu-col bg-menu">
                <div className="swatches">
                  {SWATCHES.map((c) => (
                    <button key={c} className="swatch big" style={{ background: c }} onClick={() => cur && api.set(cur.key, { bg: c, bgImage: null })} aria-label={c} type="button" />
                  ))}
                  <label className="swatch big custom" title="Custom colour">
                    <input type="color" onChange={(e) => cur && api.set(cur.key, { bg: e.target.value, bgImage: null })} />
                  </label>
                </div>
                <button className="menu-item" onClick={() => (close(), void uploadImage('bg'))} type="button">
                  Background picture…
                </button>
                <button className="menu-item" onClick={() => (close(), setImageSearch({ target: 'bg' }))} type="button">
                  Free photo background…
                </button>
                <button className="menu-item" onClick={() => cur && api.set(cur.key, { bg: null, bgImage: null })} type="button">
                  Reset to theme
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    if (!cur) return;
                    api.group(() => slides.forEach((s) => s.id !== cur.id && api.set(s.key, { bg: cur.f.bg ?? null, bgImage: cur.f.bgImage ?? null })));
                    close();
                  }}
                  type="button"
                >
                  Apply to all slides
                </button>
              </div>
            )}
          </Dropdown>
          <Dropdown label="Deck" className="tb-btn wide" align="left">
            {() => (
              <div className="menu-col deck-menu">
                <label className="field">
                  <span>Footer text</span>
                  <input defaultValue={deck.footer} maxLength={80} onBlur={(e) => api.set('settings', { footer: e.target.value })} placeholder="e.g. Company · Confidential" />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={deck.numbers} onChange={(e) => api.set('settings', { numbers: e.target.checked })} /> Slide numbers
                </label>
                <div className="row-actions">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={async () => {
                      const f = await pickFile('image/*');
                      if (!f) return;
                      try {
                        const up = await p.upload(await downscale(f, 600), f.name);
                        api.set('settings', { logo: up.src });
                      } catch (e) {
                        p.flash((e as Error).message);
                      }
                    }}
                    type="button"
                  >
                    {deck.logo ? 'Change logo' : 'Add logo'}
                  </button>
                  {deck.logo && (
                    <button className="btn btn-ghost btn-sm" onClick={() => api.set('settings', { logo: null })} type="button">
                      Remove logo
                    </button>
                  )}
                </div>
              </div>
            )}
          </Dropdown>
          <span className="tb-flex" />
          <ExportMenu run={runExport} />
          <button className="btn btn-primary btn-sm" onClick={() => setPresenting(Math.max(0, curIndex))} type="button" title="Present (F5)">
            <Icon name="play" size={14} /> Present
          </button>
        </div>
      )}
      {!canEdit && (
        <div className="slides-toolbar">
          <span className="muted small">View only</span>
          <span className="tb-flex" />
          <ExportMenu run={runExport} />
          <button className="btn btn-primary btn-sm" onClick={() => setPresenting(Math.max(0, curIndex))} type="button">
            <Icon name="play" size={14} /> Present
          </button>
        </div>
      )}
      {canEdit && first && (
        <FormatBar
          el={first}
          multi={sel.length > 1}
          onChange={setSel}
          onDelete={removeSelected}
          onDuplicate={() => duplicateSelected()}
          onArrange={arrange}
          onReplaceImage={() => void uploadImage(sel[0].id)}
          accent={theme.accent}
        />
      )}

      <div className="slides-body">
        <ol className="slide-strip" aria-label="Slides">
          {slides.map((s, i) => {
            const here = p.peers.filter((peer) => peer.ext?.focus?.startsWith(`${s.id}|`));
            return (
              <li
                key={s.id}
                className={`strip-item ${s.id === cur?.id ? 'active' : ''}`}
                draggable={canEdit}
                onDragStart={(e) => e.dataTransfer.setData('text/x-slide', s.id)}
                onDragOver={(e) => e.dataTransfer.types.includes('text/x-slide') && e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData('text/x-slide');
                  if (id && id !== s.id) moveSlide(id, i);
                }}
              >
                <span className="strip-num">{i + 1}</span>
                <button className="strip-thumb" onClick={() => setCur(s.id)} aria-label={`Slide ${i + 1}`} type="button">
                  <SlideView slide={s} els={elsBySlide.get(s.id) ?? []} theme={theme} deck={deck} width={168} index={i} total={slides.length} resolve={p.resolve} />
                </button>
                {here.length > 0 && (
                  <span className="strip-peers">
                    {here.map((peer) => (
                      <span key={peer.site} className="strip-peer" style={{ background: peer.color }} title={peer.name} />
                    ))}
                  </span>
                )}
                {canEdit && (
                  <span className="strip-actions">
                    <button onClick={() => duplicateSlide(s)} title="Duplicate slide" type="button">
                      ⧉
                    </button>
                    {slides.length > 1 && (
                      <button onClick={() => deleteSlide(s)} title="Delete slide" type="button">
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
          {canEdit && (
            <li>
              <button className="strip-add" onClick={() => addSlide('title-content', slides.at(-1))} type="button">
                <Icon name="plus" size={16} /> Add slide
              </button>
            </li>
          )}
        </ol>

        <div className="slide-workspace">
          <div className="slide-stage" ref={stage} onPointerDown={(e) => e.target === e.currentTarget && setSelected([])}>
            {cur && (
              <div className="slide-canvas" style={{ width }}>
                <SlideView
                  slide={cur}
                  els={els}
                  theme={theme}
                  deck={deck}
                  width={width}
                  index={curIndex}
                  total={slides.length}
                  resolve={p.resolve}
                  editable={canEdit}
                  selected={selected}
                  editing={editing}
                  remotes={remotes}
                  onElPointerDown={onElPointerDown}
                  onElDoubleClick={onDouble}
                  onTextCommit={(id, text) => {
                    const el = els.find((e) => e.id === id);
                    if (el && el.f.text !== text) setEl(id, { text });
                    setEditing(null);
                  }}
                  onBackgroundPointerDown={() => {
                    setSelected([]);
                    setEditing(null);
                  }}
                  onPointerMove={(x, y) => cur && sendPresence(Math.round(x), Math.round(y), `${cur.id}|${selected[0] ?? ''}`)}
                />
                {(guides.v.length > 0 || guides.h.length > 0) && (
                  <svg className="slide-guides" viewBox="0 0 960 540" preserveAspectRatio="none">
                    {guides.v.map((x, i) => (
                      <line key={`v${i}`} x1={x} x2={x} y1={0} y2={540} />
                    ))}
                    {guides.h.map((y, i) => (
                      <line key={`h${i}`} x1={0} x2={960} y1={y} y2={y} />
                    ))}
                  </svg>
                )}
              </div>
            )}
          </div>
          {cur && <Notes key={cur.id} value={cur.f.notes ?? ''} readOnly={!canEdit} onCommit={(notes) => api.set(cur.key, { notes })} />}
        </div>
      </div>

      {busy && (
        <div className="toast" role="status">
          {busy}
        </div>
      )}
      {imageSearch && (
        <ImageSearch
          onClose={() => setImageSearch(null)}
          onPick={(img) => {
            const t = imageSearch.target;
            setImageSearch(null);
            void placeImage(img.url, t, img.credit);
          }}
        />
      )}
      {presenting !== null && (
        <Presenter
          index={presenting}
          setIndex={setPresenting}
          slides={slides}
          elsBySlide={elsBySlide}
          deck={deck}
          resolve={p.resolve}
          onExit={(i) => {
            setPresenting(null);
            setCur(slides[i]?.id ?? null);
          }}
        />
      )}
    </div>
  );
}

function ShapeIcon({ shape, color }: { shape: NonNullable<El['shape']>; color: string }) {
  switch (shape) {
    case 'ellipse':
      return <ellipse cx="20" cy="15" rx="13" ry="12" fill={color} />;
    case 'round':
      return <rect x="5" y="4" width="30" height="22" rx="6" fill={color} />;
    case 'triangle':
      return <path d="M20 3 L35 27 L5 27Z" fill={color} />;
    case 'diamond':
      return <path d="M20 2 L34 15 L20 28 L6 15Z" fill={color} />;
    case 'star':
      return <path d="M20 2l4 9 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill={color} />;
    case 'arrow':
      return <path d="M4 11h20V5l12 10-12 10v-6H4z" fill={color} />;
    case 'line':
      return <line x1="4" y1="15" x2="36" y2="15" stroke={color} strokeWidth="3" />;
    default:
      return <rect x="5" y="4" width="30" height="22" fill={color} />;
  }
}

function ExportMenu({ run }: { run(what: 'pptx' | 'pdf' | 'png'): void }) {
  return (
    <Dropdown label={<><Icon name="download" size={15} /> Export</>} className="tb-btn wide">
      {(close) => (
        <div className="menu-col">
          <button className="menu-item" onClick={() => (close(), run('pptx'))} type="button">
            PowerPoint (.pptx)
          </button>
          <button className="menu-item" onClick={() => (close(), run('pdf'))} type="button">
            PDF (all slides)
          </button>
          <button className="menu-item" onClick={() => (close(), run('png'))} type="button">
            This slide as PNG
          </button>
        </div>
      )}
    </Dropdown>
  );
}

function FormatBar({
  el,
  multi,
  onChange,
  onDelete,
  onDuplicate,
  onArrange,
  onReplaceImage,
  accent,
}: {
  el: El;
  multi: boolean;
  onChange(f: Partial<El>): void;
  onDelete(): void;
  onDuplicate(): void;
  onArrange(d: 'front' | 'back'): void;
  onReplaceImage(): void;
  accent: string;
}) {
  const text = el.kind === 'text' || el.kind === 'shape';
  const size = el.size ?? 24;
  return (
    <div className="slides-format" role="toolbar" aria-label="Format selection">
      {text && (
        <>
          <select className="tb-select" value={el.font ?? ''} onChange={(e) => onChange({ font: e.target.value || null })} aria-label="Font">
            {FONTS.map((f) => (
              <option key={f.label} value={f.value ?? ''}>
                {f.label}
              </option>
            ))}
          </select>
          <button className="tb-btn" onClick={() => onChange({ size: Math.max(8, size - 2) })} aria-label="Smaller text" type="button">
            A−
          </button>
          <input className="tb-num" type="number" min={8} max={200} value={size} onChange={(e) => onChange({ size: Math.max(8, Math.min(200, Number(e.target.value) || 24)) })} aria-label="Font size" />
          <button className="tb-btn" onClick={() => onChange({ size: Math.min(200, size + 2) })} aria-label="Bigger text" type="button">
            A+
          </button>
          <button className={`tb-btn ${el.bold ? 'active' : ''}`} onClick={() => onChange({ bold: !el.bold })} aria-label="Bold" type="button">
            <Icon name="bold" size={15} />
          </button>
          <button className={`tb-btn ${el.italic ? 'active' : ''}`} onClick={() => onChange({ italic: !el.italic })} aria-label="Italic" type="button">
            <Icon name="italic" size={15} />
          </button>
          <button className={`tb-btn ${el.underline ? 'active' : ''}`} onClick={() => onChange({ underline: !el.underline })} aria-label="Underline" type="button">
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <label className="tb-color" title="Text colour">
            <span style={{ borderBottomColor: el.color ?? '#333' } as CSSProperties}>A</span>
            <input type="color" value={el.color ?? '#333333'} onChange={(e) => onChange({ color: e.target.value })} />
          </label>
          <span className="tb-sep" />
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} className={`tb-btn ${(el.align ?? 'left') === a ? 'active' : ''}`} onClick={() => onChange({ align: a })} aria-label={`Align ${a}`} type="button">
              <AlignIcon a={a} />
            </button>
          ))}
          <select className="tb-select" value={el.valign ?? 'top'} onChange={(e) => onChange({ valign: e.target.value as El['valign'] })} aria-label="Vertical alignment">
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
          {el.kind === 'text' && (
            <button className={`tb-btn ${el.list ? 'active' : ''}`} onClick={() => onChange({ list: !el.list })} aria-label="Bullets" type="button">
              <Icon name="ul" size={15} />
            </button>
          )}
        </>
      )}
      {el.kind === 'shape' && (
        <>
          <span className="tb-sep" />
          {el.shape !== 'line' && (
            <label className="tb-color" title="Fill">
              Fill <input type="color" value={el.fill ?? accent} onChange={(e) => onChange({ fill: e.target.value })} />
            </label>
          )}
          <label className="tb-color" title="Outline">
            Line <input type="color" value={el.stroke ?? accent} onChange={(e) => onChange({ stroke: e.target.value, strokeW: el.strokeW || 3 })} />
          </label>
          <select className="tb-select" value={el.strokeW ?? (el.shape === 'line' ? 4 : 0)} onChange={(e) => onChange({ strokeW: Number(e.target.value) })} aria-label="Outline width">
            {[0, 1, 2, 3, 4, 6, 8, 12].map((w) => (
              <option key={w} value={w}>
                {w ? `${w}px` : 'No line'}
              </option>
            ))}
          </select>
        </>
      )}
      {el.kind === 'image' && !multi && (
        <>
          <button className="btn btn-outline btn-sm" onClick={onReplaceImage} type="button">
            Replace image
          </button>
          <select className="tb-select" value={el.fit ?? 'cover'} onChange={(e) => onChange({ fit: e.target.value as El['fit'] })} aria-label="Image fit">
            <option value="cover">Fill box</option>
            <option value="contain">Fit inside</option>
          </select>
          {el.credit && <span className="muted small credit">{el.credit}</span>}
        </>
      )}
      <span className="tb-sep" />
      <label className="tb-range" title="Opacity">
        <span className="small">Opacity</span>
        <input type="range" min={10} max={100} value={Math.round((el.opacity ?? 1) * 100)} onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} />
      </label>
      <button className="tb-btn wide" onClick={() => onArrange('front')} type="button" title="Bring to front">
        Front
      </button>
      <button className="tb-btn wide" onClick={() => onArrange('back')} type="button" title="Send to back">
        Back
      </button>
      <button className="tb-btn" onClick={onDuplicate} title="Duplicate (Ctrl+D)" type="button">
        ⧉
      </button>
      <button className="tb-btn" onClick={onDelete} title="Delete" type="button">
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

function AlignIcon({ a }: { a: 'left' | 'center' | 'right' }) {
  const d = a === 'left' ? 'M4 6h16M4 10h10M4 14h16M4 18h10' : a === 'center' ? 'M4 6h16M7 10h10M4 14h16M7 18h10' : 'M4 6h16M10 10h10M4 14h16M10 18h10';
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d={d} />
    </svg>
  );
}

function Notes({ value, readOnly, onCommit }: { value: string; readOnly: boolean; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <div className="slide-notes">
      <label htmlFor="speaker-notes" className="small muted">
        Speaker notes
      </label>
      <textarea
        id="speaker-notes"
        value={draft}
        readOnly={readOnly}
        placeholder={readOnly ? 'No notes' : 'Click to add speaker notes — only you see them while presenting'}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          clearTimeout(timer.current);
          if (draft !== value) onCommit(draft);
        }}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onCommit(v), 700);
        }}
      />
    </div>
  );
}

function Presenter({
  index,
  setIndex,
  slides,
  elsBySlide,
  deck,
  resolve,
  onExit,
}: {
  index: number;
  setIndex(i: number): void;
  slides: Obj<SlideFields>[];
  elsBySlide: Map<string, Obj<El>[]>;
  deck: ReturnType<typeof readDeck>;
  resolve(s: string): Promise<string>;
  onExit(i: number): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [notes, setNotes] = useState(false);
  const [started] = useState(Date.now());
  const [, tick] = useState(0);
  const theme = themeById(deck.theme);
  const i = Math.min(index, slides.length - 1);
  const go = useCallback((n: number) => setIndex(Math.max(0, Math.min(slides.length - 1, n))), [setIndex, slides.length]);

  useEffect(() => {
    root.current?.requestFullscreen?.().catch(() => {});
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    const t = setInterval(() => tick((n) => n + 1), 1000);
    window.addEventListener('resize', onResize);
    const onFs = () => !document.fullscreenElement && onExit(i);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearInterval(t);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) go(i + 1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) go(i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(slides.length - 1);
      else if (e.key.toLowerCase() === 'n') setNotes((n) => !n);
      else if (e.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen();
        onExit(i);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, i, slides.length, onExit]);

  const avail = notes ? size.h * 0.72 : size.h;
  const w = Math.min(size.w, (avail * 16) / 9);
  const s = slides[i];
  const secs = Math.floor((Date.now() - started) / 1000);
  return (
    <div className="presenter" ref={root} onClick={(e) => (e.target as HTMLElement).closest('.presenter-bar, .presenter-notes') || go(i + 1)}>
      <div className="presenter-stage" style={{ height: avail }}>
        <SlideView slide={s} els={elsBySlide.get(s.id) ?? []} theme={theme} deck={deck} width={w} index={i} total={slides.length} resolve={resolve} />
      </div>
      {notes && (
        <div className="presenter-notes">
          <strong>
            Slide {i + 1} of {slides.length}
          </strong>
          {slides[i + 1] && <span className="muted"> · Next: {(elsBySlide.get(slides[i + 1].id) ?? []).find((e) => e.f.role === 'title')?.f.text ?? `slide ${i + 2}`}</span>}
          <p>{s.f.notes || 'No speaker notes for this slide.'}</p>
        </div>
      )}
      <div className="presenter-bar">
        <button onClick={() => go(i - 1)} aria-label="Previous slide" type="button">
          ‹
        </button>
        <span>
          {i + 1} / {slides.length}
        </span>
        <button onClick={() => go(i + 1)} aria-label="Next slide" type="button">
          ›
        </button>
        <span className="presenter-time">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </span>
        <button onClick={() => setNotes((n) => !n)} type="button">
          {notes ? 'Hide notes' : 'Notes (N)'}
        </button>
        <button
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            onExit(i);
          }}
          type="button"
        >
          Exit (Esc)
        </button>
      </div>
    </div>
  );
}

