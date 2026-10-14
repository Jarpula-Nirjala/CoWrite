import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Attrs } from '../../../../shared/crdt.ts';
import { Dropdown, Icon } from '../../components/ui.tsx';
import { pickFile } from '../../editor/useFiles.ts';
import type { KindProps } from '../KindPage.tsx';
import { uid, useObjects } from '../objects.ts';
import { colName, display, FUNCTIONS, parseRef, ref, Sheet, type Value } from './formula.ts';

interface Cell {
  v?: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  color?: string | null;
  bg?: string | null;
  align?: 'left' | 'center' | 'right' | null;
  fmt?: string | null;
}

interface Chart {
  range: string;
  type: 'bar' | 'line' | 'pie';
  title: string;
  order: string;
}

interface SheetSettings {
  rows: number;
  cols: number;
  freeze: boolean;
}

type Pos = { c: number; r: number };

const DEFAULT_W = 104;
const FILLS = [null, '#fff2cc', '#d9ead3', '#cfe2f3', '#f4cccc', '#ead1dc', '#d9d2e9', '#fce5cd', '#1f3a68', '#efefef'];
const INKS = ['#000000', '#1f3a68', '#0a66c2', '#2e7d32', '#c62828', '#ef6c00', '#6a1b9a', '#ffffff'];

/** Moves the relative references of a formula by (dr, dc), like copying a cell. */
export function shiftFormula(raw: string, dr: number, dc: number): string {
  if (!raw.startsWith('=')) return raw;
  return raw.replace(/("(?:[^"]|"")*")|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9(])/g, (m, s, cAbs, col, rAbs, row) => {
    if (s) return s;
    let c = [...col].reduce((n: number, ch: string) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    let r = Number(row) - 1;
    if (!cAbs) c += dc;
    if (!rAbs) r += dr;
    if (c < 0 || r < 0) return '#REF!';
    return `${cAbs}${colName(c)}${rAbs}${r + 1}`;
  });
}

const csvRow = (cells: string[]) => cells.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
function parseCsv(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

export default function SheetEditor(p: KindProps) {
  const { api, canEdit, client } = p;
  const { doc, version } = api;
  const settings = useMemo(() => ({ rows: 100, cols: 26, freeze: true, ...(doc.getObject('settings') ?? {}) }) as SheetSettings, [doc, version]);
  const cells = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const o of doc.objectsWith('cell:')) m.set(o.key.slice(5), o.fields as Cell);
    return m;
  }, [doc, version]);
  const widths = useMemo(() => {
    const m = new Map<number, number>();
    for (const o of doc.objectsWith('colw:')) m.set(Number(o.key.slice(5)), Number(o.fields.w) || DEFAULT_W);
    return m;
  }, [doc, version]);
  const charts = useObjects<Chart>(doc, 'chart', version);
  const sheet = useMemo(() => new Sheet((r) => cells.get(r)?.v), [cells]);

  const [active, setActive] = useState<Pos>({ c: 0, r: 0 });
  const [anchor, setAnchor] = useState<Pos>({ c: 0, r: 0 });
  const [edit, setEdit] = useState<{ value: string; fromBar: boolean } | null>(null);
  const [colDrag, setColDrag] = useState<{ c: number; w: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const selecting = useRef(false);

  const r1 = Math.min(active.r, anchor.r);
  const r2 = Math.max(active.r, anchor.r);
  const c1 = Math.min(active.c, anchor.c);
  const c2 = Math.max(active.c, anchor.c);
  const activeRef = ref(active.c, active.r);
  const activeCell = cells.get(activeRef) ?? {};
  const inRange = (c: number, r: number) => c >= c1 && c <= c2 && r >= r1 && r <= r2;
  const colW = (c: number) => (colDrag?.c === c ? colDrag.w : (widths.get(c) ?? DEFAULT_W));

  useEffect(() => {
    client.setExt({ focus: `cell|${activeRef}` });
  }, [activeRef, client]);
  const remoteAt = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const peer of p.peers) {
      const f = peer.ext?.focus;
      if (f?.startsWith('cell|')) m.set(f.slice(5), { name: peer.name, color: peer.color });
    }
    return m;
  }, [p.peers]);

  // ------------------------------------------------------------ edits
  const setCell = (r: string, f: Cell) => api.set(`cell:${r}`, f as Attrs);
  const forRange = (fn: (r: string) => void) =>
    api.group(() => {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(ref(c, r));
    });
  const formatRange = (f: Cell) => forRange((r) => setCell(r, f));

  const commit = (value: string, move: Pos | null) => {
    if ((cells.get(activeRef)?.v ?? '') !== value) setCell(activeRef, { v: value });
    setEdit(null);
    if (move) go(move.c, move.r);
    grid.current?.focus();
  };

  const go = (c: number, r: number, extend = false) => {
    const pos = { c: Math.max(0, Math.min(settings.cols - 1, c)), r: Math.max(0, Math.min(settings.rows - 1, r)) };
    setActive(pos);
    if (!extend) setAnchor(pos);
    requestAnimationFrame(() => grid.current?.querySelector(`[data-ref="${ref(pos.c, pos.r)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };

  const clearRange = () => forRange((r) => cells.get(r)?.v && setCell(r, { v: '' }));

  const sortRange = (desc: boolean) => {
    const top = r1 === r2 ? 0 : r1;
    const bottom = r1 === r2 ? lastRow() : r2;
    const left = c1 === c2 ? 0 : c1;
    const right = c1 === c2 ? lastCol() : c2;
    // Keep a header row in place when the first row is text above numbers.
    const hasHeader = r1 === r2 && typeof sheet.value(ref(active.c, top)) === 'string' && typeof sheet.value(ref(active.c, top + 1)) === 'number';
    const start = hasHeader ? top + 1 : top;
    const rows: { key: Value; cells: (Cell | undefined)[] }[] = [];
    for (let r = start; r <= bottom; r++) {
      const row: (Cell | undefined)[] = [];
      for (let c = left; c <= right; c++) row.push(cells.get(ref(c, r)));
      rows.push({ key: sheet.value(ref(active.c, r)), cells: row });
    }
    const rank = (v: Value) => (v === null || v === '' ? 2 : typeof v === 'number' ? 0 : 1);
    rows.sort((a, b) => {
      const ra = rank(a.key);
      const rb = rank(b.key);
      if (ra !== rb) return ra - rb;
      if (ra === 2) return 0;
      const cmp = typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
      return desc ? -cmp : cmp;
    });
    api.group(() =>
      rows.forEach((row, i) =>
        row.cells.forEach((cell, j) => {
          const target = ref(left + j, start + i);
          const prev = cells.get(target);
          if (JSON.stringify(prev ?? {}) !== JSON.stringify(cell ?? {})) setCell(target, { v: '', b: false, i: false, u: false, color: null, bg: null, align: null, fmt: null, ...(cell ?? {}) });
        }),
      ),
    );
  };

  const lastRow = () => Math.max(0, ...[...cells.keys()].filter((k) => cells.get(k)?.v).map((k) => parseRef(k)!.r));
  const lastCol = () => Math.max(0, ...[...cells.keys()].filter((k) => cells.get(k)?.v).map((k) => parseRef(k)!.c));

  const fillDown = () => {
    if (r2 === r1) return;
    api.group(() => {
      for (let c = c1; c <= c2; c++) {
        const src = cells.get(ref(c, r1)) ?? {};
        for (let r = r1 + 1; r <= r2; r++) setCell(ref(c, r), { ...src, v: shiftFormula(src.v ?? '', r - r1, 0) });
      }
    });
  };

  const pasteText = (text: string) => {
    const rows = parseCsv(text.replace(/\n$/, ''), text.includes('\t') ? '\t' : ',');
    if (!rows.length) return;
    api.group(() => {
      const needRows = active.r + rows.length;
      const needCols = active.c + Math.max(...rows.map((r) => r.length));
      if (needRows > settings.rows || needCols > settings.cols) api.set('settings', { rows: Math.max(settings.rows, needRows + 10), cols: Math.max(settings.cols, needCols) });
      rows.forEach((row, i) => row.forEach((v, j) => setCell(ref(active.c + j, active.r + i), { v })));
    });
    setAnchor({ c: active.c + Math.max(...rows.map((r) => r.length)) - 1, r: active.r + rows.length - 1 });
  };

  const exportCsv = () => {
    const out: string[] = [];
    for (let r = 0; r <= lastRow(); r++) {
      const row: string[] = [];
      for (let c = 0; c <= lastCol(); c++) row.push(display(sheet.value(ref(c, r)), cells.get(ref(c, r))?.fmt));
      out.push(csvRow(row));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/csv' }));
    a.download = `${p.title || 'Sheet'}.csv`;
    a.click();
  };

  const importCsv = async () => {
    const f = await pickFile('.csv,.tsv,text/csv,text/tab-separated-values');
    if (!f) return;
    const text = await f.text();
    setActive({ c: 0, r: 0 });
    setAnchor({ c: 0, r: 0 });
    const rows = parseCsv(text, f.name.endsWith('.tsv') ? '\t' : ',');
    api.group(() => {
      api.set('settings', { rows: Math.max(settings.rows, rows.length + 20), cols: Math.max(settings.cols, ...rows.map((r) => r.length)) });
      rows.forEach((row, i) => row.forEach((v, j) => v && setCell(ref(j, i), { v })));
    });
    p.flash(`Imported ${rows.length} rows.`);
  };

  const addChart = (type: Chart['type']) => {
    const range = c1 === c2 && r1 === r2 ? `A1:${colName(Math.max(1, lastCol()))}${lastRow() + 1}` : `${ref(c1, r1)}:${ref(c2, r2)}`;
    api.set(`chart:${uid()}`, { range, type, title: 'Chart', order: String(Date.now()) });
  };

  // ------------------------------------------------------------ keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const extend = e.shiftKey;
    const step = (dc: number, dr: number) => {
      e.preventDefault();
      if (mod) {
        // Jump to the edge of the data.
        let { c, r } = active;
        while (c + dc >= 0 && r + dr >= 0 && c + dc < settings.cols && r + dr < settings.rows && cells.get(ref(c + dc, r + dr))?.v) {
          c += dc;
          r += dr;
        }
        if (c === active.c && r === active.r) {
          c = dc ? (dc > 0 ? settings.cols - 1 : 0) : c;
          r = dr ? (dr > 0 ? settings.rows - 1 : 0) : r;
        }
        go(c, r, extend);
      } else go(active.c + dc, active.r + dr, extend);
    };
    if (k === 'ArrowDown') return step(0, 1);
    if (k === 'ArrowUp') return step(0, -1);
    if (k === 'ArrowLeft') return step(-1, 0);
    if (k === 'ArrowRight') return step(1, 0);
    if (k === 'Tab') {
      e.preventDefault();
      return go(active.c + (e.shiftKey ? -1 : 1), active.r);
    }
    if (mod && k.toLowerCase() === 'z') {
      e.preventDefault();
      return e.shiftKey ? api.redo() : api.undo();
    }
    if (mod && k.toLowerCase() === 'y') {
      e.preventDefault();
      return api.redo();
    }
    if (mod && k.toLowerCase() === 'a') {
      e.preventDefault();
      setAnchor({ c: 0, r: 0 });
      setActive({ c: settings.cols - 1, r: settings.rows - 1 });
      return;
    }
    if (!canEdit) return;
    if (mod && k.toLowerCase() === 'b') {
      e.preventDefault();
      return formatRange({ b: !activeCell.b });
    }
    if (mod && k.toLowerCase() === 'i') {
      e.preventDefault();
      return formatRange({ i: !activeCell.i });
    }
    if (mod && k.toLowerCase() === 'u') {
      e.preventDefault();
      return formatRange({ u: !activeCell.u });
    }
    if (mod && k.toLowerCase() === 'd') {
      e.preventDefault();
      return fillDown();
    }
    if (k === 'Enter' || k === 'F2') {
      e.preventDefault();
      return setEdit({ value: activeCell.v ?? '', fromBar: false });
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      return clearRange();
    }
    if (!mod && !e.altKey && k.length === 1) {
      e.preventDefault();
      setEdit({ value: k, fromBar: false });
    }
  };

  // ------------------------------------------------------------ render
  const rows = Array.from({ length: settings.rows }, (_, r) => r);
  const cols = Array.from({ length: settings.cols }, (_, c) => c);
  const selStats = useMemo(() => {
    if (r1 === r2 && c1 === c2) return null;
    const vals: number[] = [];
    let count = 0;
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        const v = sheet.value(ref(c, r));
        if (v !== null && v !== '') count++;
        if (typeof v === 'number') vals.push(v);
      }
    const sum = vals.reduce((s, x) => s + x, 0);
    return { count, sum, avg: vals.length ? sum / vals.length : null };
  }, [r1, r2, c1, c2, sheet]);

  return (
    <div className="sheet-editor">
      <div className="sheet-toolbar" role="toolbar" aria-label="Spreadsheet toolbar">
        {canEdit && (
          <>
            <button className="tb-btn" onClick={api.undo} disabled={!api.canUndo} title="Undo" type="button">
              <Icon name="undo" size={16} />
            </button>
            <button className="tb-btn" onClick={api.redo} disabled={!api.canRedo} title="Redo" type="button">
              <Icon name="redo" size={16} />
            </button>
            <span className="tb-sep" />
            <select className="tb-select" value={activeCell.fmt ?? ''} onChange={(e) => formatRange({ fmt: e.target.value || null })} aria-label="Number format">
              <option value="">Automatic</option>
              <option value="num">Number 1,000.00</option>
              <option value="int">Whole number</option>
              <option value="pct">Percent %</option>
              <option value="cur">Dollars $</option>
              <option value="inr">Rupees ₹</option>
            </select>
            <button className={`tb-btn ${activeCell.b ? 'active' : ''}`} onClick={() => formatRange({ b: !activeCell.b })} aria-label="Bold" type="button">
              <Icon name="bold" size={15} />
            </button>
            <button className={`tb-btn ${activeCell.i ? 'active' : ''}`} onClick={() => formatRange({ i: !activeCell.i })} aria-label="Italic" type="button">
              <Icon name="italic" size={15} />
            </button>
            <button className={`tb-btn ${activeCell.u ? 'active' : ''}`} onClick={() => formatRange({ u: !activeCell.u })} aria-label="Underline" type="button">
              <span style={{ textDecoration: 'underline' }}>U</span>
            </button>
            <Dropdown label={<span className="tb-color-a" style={{ borderBottomColor: activeCell.color ?? '#000' }}>A</span>} className="tb-btn" align="left" ariaLabel="Text colour">
              {(close) => (
                <div className="swatches pad">
                  {INKS.map((c) => (
                    <button key={c} className="swatch" style={{ background: c }} onClick={() => (formatRange({ color: c }), close())} aria-label={c} type="button" />
                  ))}
                </div>
              )}
            </Dropdown>
            <Dropdown label={<span className="tb-fill" style={{ background: activeCell.bg ?? '#fff' }} />} className="tb-btn" align="left" ariaLabel="Fill colour">
              {(close) => (
                <div className="swatches pad">
                  {FILLS.map((c) => (
                    <button key={c ?? 'none'} className={`swatch ${c ? '' : 'none'}`} style={{ background: c ?? '#fff' }} onClick={() => (formatRange({ bg: c }), close())} aria-label={c ?? 'No fill'} type="button" />
                  ))}
                </div>
              )}
            </Dropdown>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={`tb-btn ${activeCell.align === a ? 'active' : ''}`} onClick={() => formatRange({ align: a })} aria-label={`Align ${a}`} type="button">
                {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
              </button>
            ))}
            <span className="tb-sep" />
            <button className="tb-btn wide" onClick={() => sortRange(false)} title="Sort by the active column, A to Z" type="button">
              Sort A→Z
            </button>
            <button className="tb-btn wide" onClick={() => sortRange(true)} title="Sort Z to A" type="button">
              Z→A
            </button>
            <Dropdown label={<><Icon name="chart" size={15} /> Chart</>} className="tb-btn wide" align="left">
              {(close) => (
                <div className="menu-col">
                  <p className="small muted pad">Select a range with labels in the first column, then pick a chart.</p>
                  <button className="menu-item" onClick={() => (addChart('bar'), close())} type="button">
                    Bar chart
                  </button>
                  <button className="menu-item" onClick={() => (addChart('line'), close())} type="button">
                    Line chart
                  </button>
                  <button className="menu-item" onClick={() => (addChart('pie'), close())} type="button">
                    Pie chart
                  </button>
                </div>
              )}
            </Dropdown>
            <label className="check-row small">
              <input type="checkbox" checked={settings.freeze} onChange={(e) => api.set('settings', { freeze: e.target.checked })} /> Freeze row 1
            </label>
          </>
        )}
        <span className="tb-flex" />
        <Dropdown label="ƒx Functions" className="tb-btn wide">
          {() => (
            <div className="menu-col fn-menu">
              {FUNCTIONS.map((f) => (
                <code key={f}>{f}</code>
              ))}
            </div>
          )}
        </Dropdown>
        {canEdit && (
          <button className="tb-btn wide" onClick={importCsv} type="button">
            <Icon name="upload" size={15} /> Import CSV
          </button>
        )}
        <button className="tb-btn wide" onClick={exportCsv} type="button">
          <Icon name="download" size={15} /> CSV
        </button>
      </div>

      <div className="formula-bar">
        <span className="cell-name">{c1 !== c2 || r1 !== r2 ? `${ref(c1, r1)}:${ref(c2, r2)}` : activeRef}</span>
        <span className="fx">ƒx</span>
        <input
          value={edit ? edit.value : (activeCell.v ?? '')}
          readOnly={!canEdit}
          onFocus={() => !edit && canEdit && setEdit({ value: activeCell.v ?? '', fromBar: true })}
          onChange={(e) => setEdit({ value: e.target.value, fromBar: true })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(edit?.value ?? '', { c: active.c, r: active.r + 1 });
            if (e.key === 'Escape') {
              setEdit(null);
              grid.current?.focus();
            }
          }}
          onBlur={() => edit?.fromBar && commit(edit.value, null)}
          aria-label="Cell contents"
          placeholder={canEdit ? 'Type a value or a formula like =SUM(A1:A10)' : ''}
        />
      </div>

      <div
        className={`sheet-grid ${settings.freeze ? 'freeze' : ''}`}
        ref={grid}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={(e) => {
          if (edit) return;
          e.preventDefault();
          const out: string[] = [];
          for (let r = r1; r <= r2; r++) {
            const row: string[] = [];
            for (let c = c1; c <= c2; c++) row.push(cells.get(ref(c, r))?.v ?? '');
            out.push(row.join('\t'));
          }
          e.clipboardData.setData('text/plain', out.join('\n'));
        }}
        onPaste={(e) => {
          if (edit || !canEdit) return;
          e.preventDefault();
          pasteText(e.clipboardData.getData('text/plain'));
        }}
        onMouseUp={() => (selecting.current = false)}
        role="grid"
        aria-label="Spreadsheet"
      >
        <table>
          <colgroup>
            <col style={{ width: 46 }} />
            {cols.map((c) => (
              <col key={c} style={{ width: colW(c) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="corner" />
              {cols.map((c) => (
                <th key={c} className={c >= c1 && c <= c2 ? 'hl' : ''} onMouseDown={() => (setAnchor({ c, r: 0 }), setActive({ c, r: settings.rows - 1 }))}>
                  {colName(c)}
                  {canEdit && (
                    <span
                      className="col-resize"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const x0 = e.clientX;
                        const w0 = colW(c);
                        let w = w0;
                        const move = (ev: MouseEvent) => {
                          w = Math.max(40, Math.min(600, w0 + ev.clientX - x0));
                          setColDrag({ c, w });
                        };
                        const up = () => {
                          window.removeEventListener('mousemove', move);
                          window.removeEventListener('mouseup', up);
                          setColDrag(null);
                          if (w !== w0) api.set(`colw:${c}`, { w });
                        };
                        window.addEventListener('mousemove', move);
                        window.addEventListener('mouseup', up);
                      }}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r} className={r === 0 ? 'first-row' : ''}>
                <th className={r >= r1 && r <= r2 ? 'hl' : ''} onMouseDown={() => (setAnchor({ c: 0, r }), setActive({ c: settings.cols - 1, r }))}>
                  {r + 1}
                </th>
                {cols.map((c) => {
                  const k = ref(c, r);
                  const cell = cells.get(k);
                  const isActive = c === active.c && r === active.r;
                  const remote = remoteAt.get(k);
                  if (isActive && edit && !edit.fromBar) {
                    return (
                      <td key={c} className="editing" data-ref={k}>
                        <input
                          autoFocus
                          value={edit.value}
                          onChange={(e) => setEdit({ value: e.target.value, fromBar: false })}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commit(edit.value, { c: active.c, r: active.r + (e.shiftKey ? -1 : 1) });
                            } else if (e.key === 'Tab') {
                              e.preventDefault();
                              commit(edit.value, { c: active.c + (e.shiftKey ? -1 : 1), r: active.r });
                            } else if (e.key === 'Escape') {
                              setEdit(null);
                              grid.current?.focus();
                            }
                          }}
                          onBlur={() => edit && commit(edit.value, null)}
                          style={{ fontWeight: cell?.b ? 700 : 400 }}
                        />
                      </td>
                    );
                  }
                  const v = cell?.v ? sheet.value(k) : null;
                  const text = display(v, cell?.fmt);
                  const err = typeof v === 'string' && cell?.v?.startsWith('=') && v.startsWith('#');
                  const style: CSSProperties = {
                    fontWeight: cell?.b ? 700 : undefined,
                    fontStyle: cell?.i ? 'italic' : undefined,
                    textDecoration: cell?.u ? 'underline' : undefined,
                    color: cell?.color ?? undefined,
                    background: cell?.bg ?? undefined,
                    textAlign: cell?.align ?? (typeof v === 'number' || typeof v === 'boolean' ? 'right' : 'left'),
                    ...(remote ? ({ '--peer': remote.color } as CSSProperties) : {}),
                  };
                  return (
                    <td
                      key={c}
                      data-ref={k}
                      className={`${isActive ? 'active' : ''} ${inRange(c, r) && !isActive ? 'in-range' : ''} ${err ? 'err' : ''} ${remote ? 'remote' : ''}`}
                      style={style}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        selecting.current = true;
                        if (e.shiftKey) setActive({ c, r });
                        else go(c, r);
                      }}
                      onMouseEnter={() => selecting.current && setActive({ c, r })}
                      onDoubleClick={() => canEdit && setEdit({ value: cell?.v ?? '', fromBar: false })}
                      title={err ? `${v}: check the formula ${cell?.v}` : undefined}
                    >
                      {text}
                      {remote && <span className="cell-peer">{remote.name}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && (
          <div className="sheet-more">
            <button className="btn btn-outline btn-sm" onClick={() => api.set('settings', { rows: settings.rows + 50 })} type="button">
              Add 50 rows
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => api.set('settings', { cols: settings.cols + 5 })} type="button">
              Add 5 columns
            </button>
          </div>
        )}
      </div>

      <div className="sheet-status small">
        {selStats ? (
          <>
            Count {selStats.count} · Sum {display(Math.round(selStats.sum * 1e6) / 1e6, null)}
            {selStats.avg !== null && <> · Average {display(Math.round(selStats.avg * 1e4) / 1e4, null)}</>}
          </>
        ) : (
          <span className="muted">Tip: type = to start a formula · Ctrl+D fills down · paste from Excel or Google Sheets works</span>
        )}
      </div>

      {charts.length > 0 && (
        <div className="sheet-charts">
          {charts.map((ch) => (
            <ChartCard key={ch.id} chart={ch.f} sheet={sheet} readOnly={!canEdit} onSet={(f) => api.set(ch.key, f as Attrs)} onRemove={() => api.remove(ch.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

const SERIES = ['#1f3a68', '#c8a24a', '#2e7d32', '#c62828', '#6a1b9a', '#0a8a9a', '#ef6c00', '#5d6b7a'];

function ChartCard({ chart, sheet, readOnly, onSet, onRemove }: { chart: Chart; sheet: Sheet; readOnly: boolean; onSet(f: Partial<Chart>): void; onRemove(): void }) {
  const [a, b] = chart.range.split(':').map((s) => parseRef(s));
  const data = useMemo(() => {
    if (!a || !b) return null;
    const cs = [Math.min(a.c, b.c), Math.max(a.c, b.c)];
    const rs = [Math.min(a.r, b.r), Math.max(a.r, b.r)];
    let start = rs[0];
    const header = typeof sheet.value(ref(cs[0] + (cs[1] > cs[0] ? 1 : 0), rs[0])) === 'string';
    const names: string[] = [];
    if (header) start++;
    const labelCol = cs[1] > cs[0];
    for (let c = labelCol ? cs[0] + 1 : cs[0]; c <= cs[1]; c++) names.push(header ? String(sheet.value(ref(c, rs[0])) ?? colName(c)) : colName(c));
    const points: { label: string; values: number[] }[] = [];
    for (let r = start; r <= rs[1]; r++) {
      const label = labelCol ? String(sheet.value(ref(cs[0], r)) ?? '') : String(r + 1);
      const values: number[] = [];
      for (let c = labelCol ? cs[0] + 1 : cs[0]; c <= cs[1]; c++) {
        const v = sheet.value(ref(c, r));
        values.push(typeof v === 'number' ? v : 0);
      }
      if (label || values.some((v) => v)) points.push({ label, values });
    }
    return { names, points };
  }, [a, b, sheet]);

  const W = 520;
  const H = 260;
  const pad = { l: 48, r: 16, t: 16, b: 44 };
  let body: React.ReactNode = <text x={W / 2} y={H / 2} textAnchor="middle" className="muted">No numbers in {chart.range}</text>;
  if (data && data.points.length) {
    const all = data.points.flatMap((p) => p.values);
    const max = Math.max(0, ...all);
    const min = Math.min(0, ...all);
    const span = max - min || 1;
    const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
    const n = data.points.length;
    const band = (W - pad.l - pad.r) / n;
    const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);
    if (chart.type === 'pie') {
      const vals = data.points.map((p) => Math.max(0, p.values[0] ?? 0));
      const total = vals.reduce((s, v) => s + v, 0) || 1;
      let ang = -Math.PI / 2;
      const cx = 130;
      const cy = H / 2;
      const R = 100;
      body = (
        <>
          {vals.map((v, i) => {
            const a0 = ang;
            const a1 = (ang += (v / total) * Math.PI * 2);
            const large = a1 - a0 > Math.PI ? 1 : 0;
            return (
              <path key={i} d={`M${cx} ${cy} L${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} A${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)}Z`} fill={SERIES[i % SERIES.length]} stroke="#fff" strokeWidth={2}>
                <title>
                  {data.points[i].label}: {v} ({Math.round((v / total) * 100)}%)
                </title>
              </path>
            );
          })}
          {data.points.slice(0, 8).map((p, i) => (
            <g key={i} transform={`translate(260 ${40 + i * 24})`}>
              <rect width={12} height={12} rx={2} fill={SERIES[i % SERIES.length]} />
              <text x={18} y={10} fontSize={12} fill="#333">
                {p.label} · {Math.round((vals[i] / total) * 100)}%
              </text>
            </g>
          ))}
        </>
      );
    } else {
      const k = data.names.length;
      body = (
        <>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e6e8ec" />
              <text x={pad.l - 6} y={y(t) + 4} fontSize={11} textAnchor="end" fill="#6b7280">
                {Math.abs(t) >= 1000 ? `${Math.round(t / 100) / 10}k` : Math.round(t * 100) / 100}
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#9aa1ab" />
          {data.points.map((p, i) => (
            <text key={i} x={pad.l + band * (i + 0.5)} y={H - pad.b + 16} fontSize={11} textAnchor="middle" fill="#4b5563">
              {p.label.length > 10 ? `${p.label.slice(0, 9)}…` : p.label}
            </text>
          ))}
          {chart.type === 'bar'
            ? data.points.map((p, i) =>
                p.values.map((v, j) => {
                  const bw = Math.max(2, (band * 0.7) / k - 2);
                  const x = pad.l + band * i + band * 0.15 + j * (bw + 2);
                  return (
                    <rect key={`${i}-${j}`} x={x} y={Math.min(y(v), y(0))} width={bw} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={3} fill={SERIES[j % SERIES.length]}>
                      <title>
                        {p.label} · {data.names[j]}: {v}
                      </title>
                    </rect>
                  );
                }),
              )
            : data.names.map((_, j) => (
                <g key={j}>
                  <polyline points={data.points.map((p, i) => `${pad.l + band * (i + 0.5)},${y(p.values[j])}`).join(' ')} fill="none" stroke={SERIES[j % SERIES.length]} strokeWidth={2} />
                  {data.points.map((p, i) => (
                    <circle key={i} cx={pad.l + band * (i + 0.5)} cy={y(p.values[j])} r={4} fill={SERIES[j % SERIES.length]} stroke="#fff" strokeWidth={2}>
                      <title>
                        {p.label} · {data.names[j]}: {p.values[j]}
                      </title>
                    </circle>
                  ))}
                </g>
              ))}
        </>
      );
    }
  }
  return (
    <figure className="chart-card">
      <header>
        <input className="chart-title" defaultValue={chart.title} key={chart.title} readOnly={readOnly} onBlur={(e) => e.target.value !== chart.title && onSet({ title: e.target.value })} aria-label="Chart title" />
        {!readOnly && (
          <>
            <input className="chart-range" defaultValue={chart.range} key={chart.range} onBlur={(e) => /^[A-Z]+\d+:[A-Z]+\d+$/i.test(e.target.value) && onSet({ range: e.target.value.toUpperCase() })} aria-label="Data range" />
            <select value={chart.type} onChange={(e) => onSet({ type: e.target.value as Chart['type'] })} aria-label="Chart type">
              <option value="bar">Bar</option>
              <option value="line">Line</option>
              <option value="pie">Pie</option>
            </select>
            <button className="link-btn" onClick={onRemove} aria-label="Remove chart" type="button">
              ×
            </button>
          </>
        )}
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title}>
        {body}
      </svg>
      {data && data.names.length > 1 && chart.type !== 'pie' && (
        <figcaption className="chart-legend">
          {data.names.map((n, j) => (
            <span key={j}>
              <i style={{ background: SERIES[j % SERIES.length] }} /> {n}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
