import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Attrs } from '../../../../shared/crdt.ts';
import { Dropdown, Icon } from '../../components/ui.tsx';
import { ImageSearch } from '../../editor/imageSearch.tsx';
import { downscale, pickFile } from '../../editor/useFiles.ts';
import { api as http, errorText } from '../../api.ts';
import { throttle } from '../api.ts';
import type { KindProps } from '../KindPage.tsx';
import { uid, useObjects } from '../objects.ts';
import { loadImage } from '../slides/export.ts';
import { arrowEnds, bounds, INK, STICKY_COLORS, strokePath, wrapText, type BoardSettings, type Item, type ItemKind } from './model.ts';

type Tool = 'select' | 'hand' | 'pen' | 'highlighter' | 'eraser' | 'sticky' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'frame';
type View = { x: number; y: number; z: number };
type Box = { x: number; y: number; w: number; h: number };

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'v', icon: 'M5 3l14 8-6 2-2 6z' },
  { id: 'hand', label: 'Pan', key: 'h', icon: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.3-2L8 14' },
  { id: 'pen', label: 'Pen', key: 'p', icon: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3' },
  { id: 'highlighter', label: 'Highlighter', key: 'i', icon: 'M9 15l-3 5h6l1-2M9 15l7-11 4 3-7 11z' },
  { id: 'eraser', label: 'Eraser', key: 'e', icon: 'M8 20h12M5 16l9-9 5 5-8 8H8z' },
  { id: 'sticky', label: 'Sticky note', key: 's', icon: 'M5 4h14v10l-5 6H5zM14 20v-6h5' },
  { id: 'rect', label: 'Rectangle', key: 'r', icon: 'M4 6h16v12H4z' },
  { id: 'ellipse', label: 'Ellipse', key: 'o', icon: 'M12 19c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7 3.6 7 8 7z' },
  { id: 'diamond', label: 'Diamond', key: 'd', icon: 'M12 3l9 9-9 9-9-9z' },
  { id: 'text', label: 'Text', key: 't', icon: 'M5 6V4h14v2M12 4v16M9 20h6' },
  { id: 'arrow', label: 'Connector', key: 'a', icon: 'M4 20L20 4M11 4h9v9' },
  { id: 'frame', label: 'Frame', key: 'f', icon: 'M7 3v18M17 3v18M3 7h18M3 17h18' },
];

const FONT = "'Segoe UI', Arial, sans-serif";
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default function BoardEditor(p: KindProps) {
  const { api, canEdit, client } = p;
  const { doc, version } = api;
  const raw = useObjects<Item>(doc, 'item', version);
  const settings = useMemo(() => ({ bg: 'dots', ...(doc.getObject('settings') ?? {}) }) as BoardSettings, [doc, version]);
  const [over, setOver] = useState<Record<string, Partial<Item>>>({});
  const items = useMemo(() => raw.map((o) => (over[o.id] ? { ...o, f: { ...o.f, ...over[o.id] } } : o)).sort((a, b) => a.f.z - b.f.z), [raw, over]);
  const byId = useMemo(() => new Map(items.map((o) => [o.id, o.f])), [items]);
  const maxZ = items.reduce((m, o) => Math.max(m, o.f.z), 0);

  const [tool, setTool] = useState<Tool>(canEdit ? 'select' : 'hand');
  const [ink, setInk] = useState(INK[0]);
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]);
  const [penWidth, setPenWidth] = useState(3);
  const [view, setView] = useState<View>({ x: -80, y: -60, z: 1 });
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Item> | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [space, setSpace] = useState(false);
  const [imageSearch, setImageSearch] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const clipboard = useRef<Item[]>([]);
  const [size, setSize] = useState({ w: 1000, h: 700 });

  useEffect(() => {
    const n = svg.current;
    if (!n) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(n);
    return () => ro.disconnect();
  }, []);

  const toWorld = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (cx - r.left) / view.z + view.x, y: (cy - r.top) / view.z + view.y };
  };

  // ------------------------------------------------------------ presence
  const sendPointer = useMemo(() => throttle((x: number, y: number) => client.setExt({ x, y, focus: 'board' }), 60), [client]);
  const remotes = p.peers.filter((peer) => peer.ext?.focus === 'board' && peer.ext.x !== undefined);
  const followed = p.follow ? remotes.find((r) => r.site === p.follow) : null;
  useEffect(() => {
    if (!followed) return;
    setView((v) => ({ ...v, x: followed.ext!.x! - size.w / 2 / v.z, y: followed.ext!.y! - size.h / 2 / v.z }));
  }, [followed?.ext?.x, followed?.ext?.y, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ zoom & pan
  useEffect(() => {
    const n = svg.current;
    if (!n) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = n.getBoundingClientRect();
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const z = Math.max(0.1, Math.min(4, v.z * Math.exp(-e.deltaY * 0.0015)));
          const wx = (e.clientX - r.left) / v.z + v.x;
          const wy = (e.clientY - r.top) / v.z + v.y;
          return { z, x: wx - (e.clientX - r.left) / z, y: wy - (e.clientY - r.top) / z };
        }
        return { ...v, x: v.x + e.deltaX / v.z, y: v.y + e.deltaY / v.z };
      });
    };
    n.addEventListener('wheel', onWheel, { passive: false });
    return () => n.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (k: number) =>
    setView((v) => {
      const z = Math.max(0.1, Math.min(4, v.z * k));
      const cx = v.x + size.w / 2 / v.z;
      const cy = v.y + size.h / 2 / v.z;
      return { z, x: cx - size.w / 2 / z, y: cy - size.h / 2 / z };
    });

  const fit = () => {
    if (!items.length) return setView({ x: -80, y: -60, z: 1 });
    const bs = items.map((o) => bounds(o.f, byId));
    const x1 = Math.min(...bs.map((b) => b.x));
    const y1 = Math.min(...bs.map((b) => b.y));
    const x2 = Math.max(...bs.map((b) => b.x + b.w));
    const y2 = Math.max(...bs.map((b) => b.y + b.h));
    const z = Math.max(0.1, Math.min(2, Math.min(size.w / (x2 - x1 + 120), size.h / (y2 - y1 + 120))));
    setView({ z, x: (x1 + x2) / 2 - size.w / 2 / z, y: (y1 + y2) / 2 - size.h / 2 / z });
  };

  // ------------------------------------------------------------ edits
  const setItem = (id: string, f: Partial<Item>) => api.set(`item:${id}`, f as Attrs);
  const addItem = (f: Partial<Item>) => {
    const id = uid();
    api.set(`item:${id}`, { z: f.kind === 'frame' ? Math.min(0, ...items.map((o) => o.f.z)) - 1 : maxZ + 1, ...f } as Attrs);
    return id;
  };
  const removeIds = (ids: string[]) =>
    api.group(() => {
      for (const id of ids) api.remove(`item:${id}`);
      // Connectors attached to removed items go too.
      for (const o of items) if (o.f.kind === 'arrow' && (ids.includes(o.f.from ?? '') || ids.includes(o.f.to ?? ''))) api.remove(o.key);
    });

  const placeImage = async (src: string) => {
    const c = { x: view.x + size.w / 2 / view.z, y: view.y + size.h / 2 / view.z };
    let w = 360;
    let h = 240;
    try {
      const img = await loadImage(await p.resolve(src));
      const k = Math.min(420 / img.width, 320 / img.height);
      w = Math.round(img.width * k);
      h = Math.round(img.height * k);
    } catch {
      // keep defaults
    }
    const id = addItem({ kind: 'image', src, x: c.x - w / 2, y: c.y - h / 2, w, h });
    setSelected([id]);
    setTool('select');
  };

  // ------------------------------------------------------------ pointer
  const hitAt = (wx: number, wy: number, skip: (i: Item) => boolean = () => false) => {
    for (let k = items.length - 1; k >= 0; k--) {
      const o = items[k];
      if (skip(o.f) || o.f.kind === 'arrow' || o.f.kind === 'pen') continue;
      const b = bounds(o.f, byId);
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return o;
    }
    return null;
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (editing) {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    const start = toWorld(e.clientX, e.clientY);
    const px = e.clientX;
    const py = e.clientY;
    const target = (e.target as Element).closest('[data-id]');
    const hitId = target?.getAttribute('data-id') ?? null;
    const handle = (e.target as Element).getAttribute('data-handle');
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const drag = (move: (ev: PointerEvent, w: { x: number; y: number }) => void, up: (ev: PointerEvent, w: { x: number; y: number }) => void) => {
      const onMove = (ev: PointerEvent) => move(ev, toWorld(ev.clientX, ev.clientY));
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        up(ev, toWorld(ev.clientX, ev.clientY));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    // Pan
    if (e.button === 1 || tool === 'hand' || space || !canEdit) {
      const v0 = view;
      drag(
        (ev) => setView({ ...v0, x: v0.x - (ev.clientX - px) / v0.z, y: v0.y - (ev.clientY - py) / v0.z }),
        () => {},
      );
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'select') {
      if (hitId && byId.has(hitId)) {
        let ids = selected;
        if (e.shiftKey) ids = selected.includes(hitId) ? selected.filter((x) => x !== hitId) : [...selected, hitId];
        else if (!selected.includes(hitId)) ids = [hitId];
        setSelected(ids);
        // Moving a frame carries what is inside it.
        const carry = new Set(ids);
        for (const id of ids) {
          const f = byId.get(id)!;
          if (f.kind !== 'frame') continue;
          for (const o of items) {
            const b = bounds(o.f, byId);
            if (o.f.kind !== 'arrow' && b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h) carry.add(o.id);
          }
        }
        const base = new Map([...carry].map((id) => [id, { ...byId.get(id)! }]));
        let moved = false;
        let latest: Record<string, Partial<Item>> = {};
        const commit = throttle((o: Record<string, Partial<Item>>) => Object.entries(o).forEach(([k, f]) => setItem(k, f)), 120);
        drag(
          (ev, w) => {
            const dx = w.x - start.x;
            const dy = w.y - start.y;
            if (!moved && Math.abs(ev.clientX - px) + Math.abs(ev.clientY - py) < 3) return;
            if (!moved) {
              moved = true;
              api.begin();
            }
            const out: Record<string, Partial<Item>> = {};
            for (const [k, b] of base) {
              if (handle && k === hitId) {
                const nw = Math.max(20, b.w + dx);
                const nh = b.kind === 'image' || ev.shiftKey ? (nw * b.h) / b.w : Math.max(20, b.h + dy);
                const sx = nw / b.w;
                const sy = nh / b.h;
                out[k] = b.kind === 'pen' ? { w: nw, h: nh, pts: b.pts!.map((v, i) => Math.round(v * (i % 2 ? sy : sx) * 10) / 10) } : { w: nw, h: nh };
              } else if (!handle) {
                out[k] = b.kind === 'arrow' ? { x: b.x + (b.from ? 0 : dx), y: b.y + (b.from ? 0 : dy), x2: (b.x2 ?? 0) + (b.to ? 0 : dx), y2: (b.y2 ?? 0) + (b.to ? 0 : dy) } : { x: Math.round(b.x + dx), y: Math.round(b.y + dy) };
              }
            }
            latest = out;
            setOver(out);
            commit(out);
          },
          () => {
            if (moved) {
              commit(latest);
              commit.flush();
              api.end();
            }
            setOver({});
          },
        );
        return;
      }
      // Marquee
      if (!e.shiftKey) setSelected([]);
      drag(
        (_ev, w) => setMarquee({ x: Math.min(start.x, w.x), y: Math.min(start.y, w.y), w: Math.abs(w.x - start.x), h: Math.abs(w.y - start.y) }),
        (_ev, w) => {
          const m = { x: Math.min(start.x, w.x), y: Math.min(start.y, w.y), w: Math.abs(w.x - start.x), h: Math.abs(w.y - start.y) };
          setMarquee(null);
          if (m.w < 3 && m.h < 3) return;
          const ids = items
            .filter((o) => {
              const b = bounds(o.f, byId);
              return b.x >= m.x && b.y >= m.y && b.x + b.w <= m.x + m.w && b.y + b.h <= m.y + m.h;
            })
            .map((o) => o.id);
          setSelected((s) => [...new Set([...s, ...ids])]);
        },
      );
      return;
    }

    if (tool === 'pen' || tool === 'highlighter') {
      const pts = [start.x, start.y];
      setDraft({ kind: 'pen', pts: [...pts], color: ink, width: tool === 'highlighter' ? penWidth * 5 : penWidth, highlighter: tool === 'highlighter' });
      drag(
        (_ev, w) => {
          const lx = pts[pts.length - 2];
          const ly = pts[pts.length - 1];
          if (Math.hypot(w.x - lx, w.y - ly) < 2 / view.z) return;
          pts.push(Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10);
          setDraft((d) => d && { ...d, pts: [...pts] });
        },
        () => {
          setDraft(null);
          const xs = pts.filter((_, i) => i % 2 === 0);
          const ys = pts.filter((_, i) => i % 2 === 1);
          const x = Math.min(...xs);
          const y = Math.min(...ys);
          const rel = pts.map((v, i) => Math.round((v - (i % 2 ? y : x)) * 10) / 10);
          addItem({ kind: 'pen', x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y), pts: rel, color: ink, width: tool === 'highlighter' ? penWidth * 5 : penWidth, highlighter: tool === 'highlighter' });
        },
      );
      return;
    }

    if (tool === 'eraser') {
      api.begin();
      const gone = new Set<string>();
      const erase = (w: { x: number; y: number }) => {
        const r = 8 / view.z;
        for (const o of items) {
          if (gone.has(o.id) || o.f.kind !== 'pen') continue;
          const f = o.f;
          if (w.x < f.x - r || w.x > f.x + f.w + r || w.y < f.y - r || w.y > f.y + f.h + r) continue;
          for (let i = 0; i < f.pts!.length; i += 2) {
            if (Math.hypot(f.x + f.pts![i] - w.x, f.y + f.pts![i + 1] - w.y) < r + (f.width ?? 3) / 2) {
              gone.add(o.id);
              api.remove(o.key);
              break;
            }
          }
        }
      };
      erase(start);
      drag((_ev, w) => erase(w), () => api.end());
      return;
    }

    if (tool === 'sticky' || tool === 'text') {
      const id =
        tool === 'sticky'
          ? addItem({ kind: 'sticky', x: start.x - 90, y: start.y - 90, w: 180, h: 180, fill: stickyColor, text: '', size: 18 })
          : addItem({ kind: 'text', x: start.x, y: start.y - 16, w: 260, h: 40, text: '', size: 24, color: ink });
      setSelected([id]);
      setEditing(id);
      setTool('select');
      return;
    }

    if (tool === 'rect' || tool === 'ellipse' || tool === 'diamond' || tool === 'frame') {
      const kind: ItemKind = tool;
      setDraft({ kind, x: start.x, y: start.y, w: 0, h: 0, color: ink });
      drag(
        (ev, w) => {
          let ww = w.x - start.x;
          let hh = w.y - start.y;
          if (ev.shiftKey) ww = hh = Math.max(Math.abs(ww), Math.abs(hh)) * Math.sign(ww || 1);
          setDraft({ kind, x: Math.min(start.x, start.x + ww), y: Math.min(start.y, start.y + hh), w: Math.abs(ww), h: Math.abs(hh), color: ink });
        },
        (_ev, w) => {
          setDraft(null);
          let box = { x: Math.min(start.x, w.x), y: Math.min(start.y, w.y), w: Math.abs(w.x - start.x), h: Math.abs(w.y - start.y) };
          if (box.w < 8 && box.h < 8) box = kind === 'frame' ? { x: start.x, y: start.y, w: 640, h: 420 } : { x: start.x - 80, y: start.y - 50, w: 160, h: 100 };
          const id = addItem({ kind, ...box, color: ink, fill: kind === 'frame' ? null : '#ffffff', text: kind === 'frame' ? 'Frame' : '', size: kind === 'frame' ? 18 : 18 });
          setSelected([id]);
          setTool('select');
        },
      );
      return;
    }

    if (tool === 'arrow') {
      const from = hitAt(start.x, start.y);
      setDraft({ kind: 'arrow', x: start.x, y: start.y, x2: start.x, y2: start.y, color: ink, from: from?.id ?? null });
      drag(
        (_ev, w) => setDraft((d) => d && { ...d, x2: w.x, y2: w.y }),
        (_ev, w) => {
          setDraft(null);
          if (Math.hypot(w.x - start.x, w.y - start.y) < 10) return;
          const to = hitAt(w.x, w.y, (i) => i === from?.f);
          const id = addItem({ kind: 'arrow', x: start.x, y: start.y, x2: w.x, y2: w.y, w: 0, h: 0, from: from?.id ?? null, to: to?.id ?? null, color: ink, width: 2, text: '' });
          setSelected([id]);
        },
      );
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    sendPointer(Math.round(w.x), Math.round(w.y));
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!canEdit) return;
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
    const f = id ? byId.get(id) : null;
    if (id && f && f.kind !== 'pen' && f.kind !== 'image') {
      setSelected([id]);
      setEditing(id);
    } else if (!id) {
      const w = toWorld(e.clientX, e.clientY);
      const nid = addItem({ kind: 'sticky', x: w.x - 90, y: w.y - 90, w: 180, h: 180, fill: stickyColor, text: '', size: 18 });
      setSelected([nid]);
      setEditing(nid);
    }
  };

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || editing) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === ' ') {
        e.preventDefault();
        setSpace(true);
        return;
      }
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        api.redo();
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        zoomBy(1.2);
      } else if (mod && k === '-') {
        e.preventDefault();
        zoomBy(1 / 1.2);
      } else if (mod && k === '0') {
        e.preventDefault();
        fit();
      } else if (!canEdit) return;
      else if (mod && k === 'a') {
        e.preventDefault();
        setSelected(items.map((o) => o.id));
      } else if (mod && k === 'c') clipboard.current = selected.map((id) => ({ ...byId.get(id)! }));
      else if (mod && k === 'v') {
        e.preventDefault();
        const ids: string[] = [];
        api.group(() => clipboard.current.forEach((f, i) => ids.push(addItem({ ...f, x: f.x + 30, y: f.y + 30, x2: f.x2 !== undefined ? f.x2 + 30 : undefined, y2: f.y2 !== undefined ? f.y2 + 30 : undefined, from: null, to: null, z: maxZ + 1 + i }))));
        setSelected(ids);
      } else if (mod && k === 'd') {
        e.preventDefault();
        const ids: string[] = [];
        api.group(() => selected.forEach((id, i) => ids.push(addItem({ ...byId.get(id)!, x: byId.get(id)!.x + 24, y: byId.get(id)!.y + 24, from: null, to: null, z: maxZ + 1 + i }))));
        setSelected(ids);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault();
        removeIds(selected);
        setSelected([]);
      } else if (e.key === 'Escape') {
        setSelected([]);
        setTool('select');
      } else if (e.key === 'Enter' && selected.length === 1) {
        e.preventDefault();
        setEditing(selected[0]);
      } else if (e.key.startsWith('Arrow') && selected.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        api.group(() => selected.forEach((id) => setItem(id, { x: byId.get(id)!.x + dx, y: byId.get(id)!.y + dy })));
      } else if (!mod) {
        const t = TOOLS.find((x) => x.key === k);
        if (t) setTool(t.id);
      }
    };
    const up = (e: KeyboardEvent) => e.key === ' ' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  // ------------------------------------------------------------ export
  const exportPng = async () => {
    if (!items.length || !world.current) return p.flash('The board is empty.');
    setBusy('Rendering board…');
    try {
      const bs = items.map((o) => bounds(o.f, byId));
      const x1 = Math.min(...bs.map((b) => b.x)) - 40;
      const y1 = Math.min(...bs.map((b) => b.y)) - 40;
      const w = Math.max(...bs.map((b) => b.x + b.w)) + 40 - x1;
      const h = Math.max(...bs.map((b) => b.y + b.h)) + 40 - y1;
      const clone = world.current.cloneNode(true) as SVGGElement;
      clone.removeAttribute('transform');
      clone.querySelectorAll('.board-ui').forEach((n) => n.remove());
      for (const img of clone.querySelectorAll('image')) {
        const href = img.getAttribute('href');
        if (!href) continue;
        const src = /^https?:/.test(href) && !href.startsWith(location.origin) ? `/api/media/proxy?url=${encodeURIComponent(href)}` : href;
        const blob = await (await fetch(src)).blob();
        const data = await new Promise<string>((ok) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result));
          r.readAsDataURL(blob);
        });
        img.setAttribute('href', data);
      }
      const defs = svg.current!.querySelector('defs')!.outerHTML;
      const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="${x1} ${y1} ${w} ${h}">${defs}<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="#ffffff"/>${clone.outerHTML}</svg>`;
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
      const c = document.createElement('canvas');
      c.width = w * 2;
      c.height = h * 2;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${p.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Whiteboard'}.png`;
        a.click();
      }, 'image/png');
    } catch (e) {
      p.flash(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const summarize = async () => {
    const text = items
      .filter((o) => o.f.text?.trim())
      .map((o) => `${o.f.kind === 'frame' ? '## ' : '- '}${o.f.text!.trim()}`)
      .join('\n');
    if (!text) return p.flash('Add some sticky notes or text first.');
    setBusy('AI is reading the board…');
    try {
      const r = await http<{ text: string }>(`/docs/${p.roomId}/ai/tool`, { method: 'POST', body: { tool: 'board-summary', input: { text } }, share: p.share });
      const lines = wrapText(r.text, 520, 16, FONT);
      const c = { x: view.x + size.w / 2 / view.z, y: view.y + size.h / 2 / view.z };
      const id = addItem({ kind: 'text', x: c.x - 270, y: c.y - 100, w: 560, h: lines.length * 22 + 20, text: r.text, size: 16, color: '#1b1f24' });
      setSelected([id]);
    } catch (e) {
      p.flash(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------ render
  const sel = selected.map((id) => byId.get(id)).filter(Boolean) as Item[];
  const first = sel[0];
  const editItem = editing ? byId.get(editing) : null;
  const cursor = space || tool === 'hand' || !canEdit ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  const gridSize = 24 * view.z;

  return (
    <div className="board-editor">
      <div className="board-top" role="toolbar" aria-label="Whiteboard toolbar">
        {canEdit && (
          <>
            <button className="tb-btn" onClick={api.undo} disabled={!api.canUndo} title="Undo" type="button">
              <Icon name="undo" size={16} />
            </button>
            <button className="tb-btn" onClick={api.redo} disabled={!api.canRedo} title="Redo" type="button">
              <Icon name="redo" size={16} />
            </button>
            <span className="tb-sep" />
            <span className="small muted">Ink</span>
            {INK.map((c) => (
              <button
                key={c}
                className={`swatch ${ink === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setInk(c);
                  if (sel.length) api.group(() => selected.forEach((id) => setItem(id, { color: c })));
                }}
                aria-label={`Ink ${c}`}
                type="button"
              />
            ))}
            <select className="tb-select" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} aria-label="Pen width">
              {[1, 2, 3, 5, 8, 12].map((w) => (
                <option key={w} value={w}>
                  {w}px
                </option>
              ))}
            </select>
            <span className="tb-sep" />
            <span className="small muted">Notes</span>
            {STICKY_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${stickyColor === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setStickyColor(c);
                  const fills = sel.filter((i) => i.kind !== 'pen' && i.kind !== 'arrow' && i.kind !== 'text');
                  if (fills.length) api.group(() => selected.forEach((id) => byId.get(id)!.kind !== 'pen' && setItem(id, { fill: c })));
                }}
                aria-label={`Note colour ${c}`}
                type="button"
              />
            ))}
            <span className="tb-sep" />
            <Dropdown label={<><Icon name="upload" size={15} /> Image</>} className="tb-btn wide" align="left">
              {(close) => (
                <div className="menu-col">
                  <button
                    className="menu-item"
                    onClick={async () => {
                      close();
                      const f = await pickFile('image/*');
                      if (!f) return;
                      setBusy('Uploading…');
                      try {
                        const up = await p.upload(await downscale(f), f.name);
                        await placeImage(up.src);
                      } catch (err) {
                        p.flash((err as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                    type="button"
                  >
                    Upload from computer
                  </button>
                  <button className="menu-item" onClick={() => (close(), setImageSearch(true))} type="button">
                    Search free photos
                  </button>
                </div>
              )}
            </Dropdown>
            {first && (
              <>
                <span className="tb-sep" />
                {first.kind !== 'pen' && first.kind !== 'image' && (
                  <select className="tb-select" value={first.size ?? 18} onChange={(e) => api.group(() => selected.forEach((id) => setItem(id, { size: Number(e.target.value) })))} aria-label="Text size">
                    {[12, 14, 16, 18, 24, 32, 48, 64].map((s) => (
                      <option key={s} value={s}>
                        {s}px
                      </option>
                    ))}
                  </select>
                )}
                {first.kind === 'arrow' && (
                  <button className={`tb-btn wide ${first.dashed ? 'active' : ''}`} onClick={() => api.group(() => selected.forEach((id) => setItem(id, { dashed: !first.dashed })))} type="button">
                    Dashed
                  </button>
                )}
                <button className="tb-btn wide" onClick={() => api.group(() => selected.forEach((id, i) => setItem(id, { z: maxZ + 1 + i })))} type="button">
                  Front
                </button>
                <button className="tb-btn wide" onClick={() => api.group(() => selected.forEach((id, i) => setItem(id, { z: Math.min(...items.map((o) => o.f.z)) - selected.length + i })))} type="button">
                  Back
                </button>
                <button className="tb-btn" onClick={() => (removeIds(selected), setSelected([]))} title="Delete" type="button">
                  <Icon name="trash" size={15} />
                </button>
              </>
            )}
          </>
        )}
        <span className="tb-flex" />
        <select className="tb-select" value={settings.bg} onChange={(e) => api.set('settings', { bg: e.target.value })} disabled={!canEdit} aria-label="Background">
          <option value="dots">Dot grid</option>
          <option value="grid">Squares</option>
          <option value="lines">Ruled</option>
          <option value="plain">Plain</option>
        </select>
        {p.aiEnabled && canEdit && (
          <button className="tb-btn wide" onClick={summarize} type="button" title="Turn the notes on this board into a written summary">
            <Icon name="sparkle" size={15} /> Summarize
          </button>
        )}
        <button className="tb-btn wide" onClick={exportPng} type="button">
          <Icon name="download" size={15} /> PNG
        </button>
      </div>

      <div className="board-wrap">
        {canEdit && (
          <div className="board-tools" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
            {TOOLS.map((t) => (
              <button key={t.id} className={`tool-btn ${tool === t.id ? 'active' : ''}`} onClick={() => setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`} aria-pressed={tool === t.id} type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
                  <path d={t.icon} />
                </svg>
              </button>
            ))}
          </div>
        )}
        <svg
          ref={svg}
          className={`board-svg bg-${settings.bg}`}
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          <defs>
            <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
            </marker>
            <filter id="sticky-shadow" x="-10%" y="-10%" width="130%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity=".18" />
            </filter>
            <pattern id="bg-pat" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" x={-view.x * view.z} y={-view.y * view.z}>
              {settings.bg === 'dots' && <circle cx={1} cy={1} r={1.1} fill="#c5cad3" />}
              {settings.bg === 'grid' && <path d={`M${gridSize} 0H0V${gridSize}`} fill="none" stroke="#e3e6eb" />}
              {settings.bg === 'lines' && <path d={`M0 ${gridSize - 0.5}H${gridSize}`} stroke="#c9d8ef" />}
            </pattern>
          </defs>
          {settings.bg !== 'plain' && <rect width="100%" height="100%" fill="url(#bg-pat)" className="board-bg" />}
          <g ref={world} transform={`scale(${view.z}) translate(${-view.x} ${-view.y})`}>
            {items.map((o) => (
              <ItemView key={o.id} id={o.id} f={o.f} byId={byId} resolve={p.resolve} hideText={editing === o.id} />
            ))}
            {draft && <ItemView id="draft" f={{ x: 0, y: 0, w: 0, h: 0, z: 0, ...draft } as Item} byId={byId} resolve={p.resolve} draft />}
            <g className="board-ui">
              {sel.map((f, i) => {
                const b = bounds(f, byId);
                return (
                  <g key={selected[i]}>
                    <rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} fill="none" stroke="#2c6bd6" strokeWidth={1.5 / view.z} strokeDasharray={f.kind === 'arrow' ? `${4 / view.z}` : undefined} />
                    {sel.length === 1 && f.kind !== 'arrow' && canEdit && (
                      <rect data-id={selected[i]} data-handle="se" x={b.x + b.w + 4 - 6 / view.z} y={b.y + b.h + 4 - 6 / view.z} width={12 / view.z} height={12 / view.z} fill="#fff" stroke="#2c6bd6" strokeWidth={1.5 / view.z} style={{ cursor: 'nwse-resize' }} />
                    )}
                  </g>
                );
              })}
              {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="#2c6bd622" stroke="#2c6bd6" strokeWidth={1 / view.z} />}
              {remotes.map((r) => (
                <g key={r.site} transform={`translate(${r.ext!.x} ${r.ext!.y}) scale(${1 / view.z})`} className="board-cursor">
                  <path d="M0 0 L14 6 L8 7.5 L6 14 Z" fill={r.color} stroke="#fff" strokeWidth="1.2" />
                  <rect x="12" y="14" rx="4" width={r.name.length * 7 + 12} height="20" fill={r.color} />
                  <text x="18" y="28" fontSize="12" fill="#fff" fontFamily={FONT}>
                    {r.name}
                  </text>
                </g>
              ))}
            </g>
          </g>
        </svg>
        {editItem && editing && (
          <TextEditor
            item={editItem}
            view={view}
            onDone={(text) => {
              const it = byId.get(editing);
              if (it && it.text !== text) {
                const patch: Partial<Item> = { text };
                if (it.kind === 'text') patch.h = Math.max(30, wrapText(text || ' ', it.w - 8, it.size ?? 24, FONT).length * (it.size ?? 24) * 1.3 + 10);
                if (it.kind === 'text' && !text.trim()) api.remove(`item:${editing}`);
                else setItem(editing, patch);
              }
              setEditing(null);
            }}
          />
        )}
        <div className="board-zoom">
          <button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" type="button">
            −
          </button>
          <button onClick={fit} title="Fit to content (Ctrl+0)" type="button">
            {Math.round(view.z * 100)}%
          </button>
          <button onClick={() => zoomBy(1.2)} aria-label="Zoom in" type="button">
            +
          </button>
        </div>
        {!items.length && (
          <div className="board-hint">
            <strong>Infinite whiteboard</strong>
            <span>Double-click anywhere for a sticky note · P to draw · A for connectors · Ctrl+scroll to zoom · Space+drag to pan</span>
          </div>
        )}
      </div>
      {busy && (
        <div className="toast" role="status">
          {busy}
        </div>
      )}
      {imageSearch && (
        <ImageSearch
          onClose={() => setImageSearch(false)}
          onPick={(img) => {
            setImageSearch(false);
            void placeImage(img.url);
          }}
        />
      )}
    </div>
  );
}

function useUrl(src: string | null | undefined, resolve: (s: string) => Promise<string>) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    resolve(src).then((u) => alive && setUrl(u), () => {});
    return () => {
      alive = false;
    };
  }, [src, resolve]);
  return url;
}

function Label({ f, cx, cy, width, color }: { f: Item; cx: number; cy: number; width: number; color: string }) {
  const size = f.size ?? 18;
  const lines = wrapText(f.text ?? '', Math.max(10, width), size, FONT);
  const lh = size * 1.3;
  const top = cy - ((lines.length - 1) * lh) / 2;
  return (
    <text x={cx} fontSize={size} fill={color} fontFamily={FONT} textAnchor="middle" dominantBaseline="central">
      {lines.map((l, i) => (
        <tspan key={i} x={cx} y={top + i * lh}>
          {l || ' '}
        </tspan>
      ))}
    </text>
  );
}

function ItemView({ id, f, byId, resolve, draft = false, hideText = false }: { id: string; f: Item; byId: Map<string, Item>; resolve(s: string): Promise<string>; draft?: boolean; hideText?: boolean }) {
  const url = useUrl(f.kind === 'image' ? f.src : null, resolve);
  const color = f.color ?? '#1b1f24';
  const common = { 'data-id': draft ? undefined : id, opacity: draft ? 0.7 : 1 };
  const text = !hideText && f.text;
  switch (f.kind) {
    case 'pen':
      return (
        <path
          {...common}
          d={strokePath(draft ? f.pts! : f.pts!.map((v, i) => v + (i % 2 ? f.y : f.x)))}
          fill="none"
          stroke={color}
          strokeWidth={f.width ?? 3}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={f.highlighter ? 0.35 : 1}
        />
      );
    case 'sticky':
      return (
        <g {...common}>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} fill={f.fill ?? '#fff3a3'} filter="url(#sticky-shadow)" rx={3} />
          {text && <Label f={f} cx={f.x + f.w / 2} cy={f.y + f.h / 2} width={f.w - 20} color="#1b1f24" />}
        </g>
      );
    case 'rect':
    case 'ellipse':
    case 'diamond': {
      const fill = f.fill ?? '#ffffff';
      const shape =
        f.kind === 'rect' ? (
          <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={8} fill={fill} stroke={color} strokeWidth={2} />
        ) : f.kind === 'ellipse' ? (
          <ellipse cx={f.x + f.w / 2} cy={f.y + f.h / 2} rx={f.w / 2} ry={f.h / 2} fill={fill} stroke={color} strokeWidth={2} />
        ) : (
          <path d={`M${f.x + f.w / 2} ${f.y} L${f.x + f.w} ${f.y + f.h / 2} L${f.x + f.w / 2} ${f.y + f.h} L${f.x} ${f.y + f.h / 2}Z`} fill={fill} stroke={color} strokeWidth={2} />
        );
      return (
        <g {...common}>
          {shape}
          {text && <Label f={f} cx={f.x + f.w / 2} cy={f.y + f.h / 2} width={f.w * (f.kind === 'rect' ? 0.9 : 0.7)} color={color} />}
        </g>
      );
    }
    case 'frame':
      return (
        <g {...common}>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="#ffffff" fillOpacity={0.55} stroke="#9aa3b0" strokeWidth={1.5} rx={6} />
          {!hideText && (
            <text x={f.x + 4} y={f.y - 10} fontSize={f.size ?? 18} fontWeight={600} fill="#4a5260" fontFamily={FONT}>
              {f.text || 'Frame'}
            </text>
          )}
        </g>
      );
    case 'text': {
      const size = f.size ?? 24;
      const lines = wrapText(f.text ?? '', f.w - 8, size, FONT);
      return (
        <g {...common}>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="transparent" />
          {text && (
            <text x={f.x + 4} fontSize={size} fill={color} fontFamily={FONT}>
              {lines.map((l, i) => (
                <tspan key={i} x={f.x + 4} y={f.y + size + i * size * 1.3}>
                  {l || ' '}
                </tspan>
              ))}
            </text>
          )}
        </g>
      );
    }
    case 'arrow': {
      const { p1, p2 } = draft ? { p1: { x: f.x, y: f.y }, p2: { x: f.x2 ?? f.x, y: f.y2 ?? f.y } } : arrowEnds(f, byId);
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      return (
        <g {...common}>
          <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={14} />
          <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={f.width ?? 2} strokeDasharray={f.dashed ? '8 6' : undefined} markerEnd="url(#arrowhead)" />
          {text && (
            <>
              <rect x={mx - (f.text!.length * 4 + 8)} y={my - 12} width={f.text!.length * 8 + 16} height={24} rx={4} fill="#fff" />
              <text x={mx} y={my} fontSize={14} textAnchor="middle" dominantBaseline="central" fill={color} fontFamily={FONT}>
                {f.text}
              </text>
            </>
          )}
        </g>
      );
    }
    case 'image':
      return (
        <g {...common}>
          {url ? <image href={url} x={f.x} y={f.y} width={f.w} height={f.h} preserveAspectRatio="xMidYMid slice" /> : <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="#eef0f3" />}
        </g>
      );
    default:
      return null;
  }
}

function TextEditor({ item, view, onDone }: { item: Item; view: View; onDone(text: string): void }) {
  const [value, setValue] = useState(item.text ?? '');
  const size = (item.size ?? 18) * view.z;
  const arrow = item.kind === 'arrow';
  const frame = item.kind === 'frame';
  const box = arrow
    ? { x: ((item.x + (item.x2 ?? item.x)) / 2 - 100), y: ((item.y + (item.y2 ?? item.y)) / 2 - 16), w: 200, h: 32 }
    : frame
      ? { x: item.x, y: item.y - 36, w: Math.max(200, item.w / 2), h: 32 }
      : { x: item.x, y: item.y, w: item.w, h: Math.max(item.h, 40) };
  const centered = item.kind === 'sticky' || item.kind === 'rect' || item.kind === 'ellipse' || item.kind === 'diamond' || arrow;
  return (
    <textarea
      className={`board-text-edit ${centered ? 'centered' : ''}`}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey || arrow || frame))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        e.stopPropagation();
      }}
      placeholder={item.kind === 'sticky' ? 'Write an idea…' : 'Type…'}
      style={{
        left: (box.x - view.x) * view.z,
        top: (box.y - view.y) * view.z,
        width: box.w * view.z,
        height: box.h * view.z,
        fontSize: arrow ? 14 * view.z : size,
        padding: item.kind === 'sticky' ? 10 * view.z : 4 * view.z,
      }}
    />
  );
}
