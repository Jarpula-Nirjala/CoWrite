import type { User } from '../api.ts';
import { PAPERS, THEMES, type DocSettings } from '../rich/settings.ts';

/** Page setup, paper and theme for the document (shared with collaborators). */
export function PagePanel({ settings, onChange, canEdit, user }: { settings: DocSettings; onChange(p: Partial<DocSettings>): void; canEdit: boolean; user: User | null }) {
  const brand = user?.brand;
  const set = <K extends keyof DocSettings>(k: K, v: DocSettings[K]) => onChange({ [k]: v } as Partial<DocSettings>);
  return (
    <fieldset className="page-panel" disabled={!canEdit}>
      <h4>Theme</h4>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} type="button" className={`theme-card theme-${t.id} ${settings.theme === t.id ? 'on' : ''}`} onClick={() => set('theme', t.id)} title={t.description}>
            <span className="theme-sample">Aa</span>
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      <h4>Paper</h4>
      <div className="paper-grid">
        {PAPERS.map((p) => (
          <button key={p.id} type="button" className={`paper-swatch paper-${p.id} ${settings.paper === p.id ? 'on' : ''}`} onClick={() => set('paper', p.id)}>
            {p.name}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Lines</span>
        <select className="input" value={settings.lines} onChange={(e) => set('lines', e.target.value as DocSettings['lines'])}>
          <option value="none">None</option>
          <option value="ruled">Ruled (notebook)</option>
          <option value="college">College ruled (narrow)</option>
          <option value="grid">Grid (squared)</option>
          <option value="dotted">Dotted (bullet journal)</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.marginLine} onChange={(e) => set('marginLine', e.target.checked)} /> Red margin line
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.dateHeader} onChange={(e) => set('dateHeader', e.target.checked)} /> Diary date at the top
      </label>

      <h4>Page</h4>
      <div className="two-fields">
        <label className="field">
          <span>Size</span>
          <select className="input" value={settings.page} onChange={(e) => set('page', e.target.value as DocSettings['page'])}>
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
            <option value="wide">Wide</option>
            <option value="full">Full width</option>
          </select>
        </label>
        <label className="field">
          <span>Margins</span>
          <select className="input" value={settings.margins} onChange={(e) => set('margins', e.target.value as DocSettings['margins'])}>
            <option value="narrow">Narrow</option>
            <option value="normal">Normal</option>
            <option value="wide">Wide</option>
          </select>
        </label>
        <label className="field">
          <span>Line spacing</span>
          <select className="input" value={settings.spacing} onChange={(e) => set('spacing', e.target.value as DocSettings['spacing'])}>
            <option value="1">Single</option>
            <option value="1.15">1.15</option>
            <option value="1.5">1.5</option>
            <option value="2">Double</option>
          </select>
        </label>
        <label className="field">
          <span>Body font</span>
          <select className="input" value={settings.font} onChange={(e) => set('font', e.target.value)}>
            <option value="serif">Times New Roman</option>
            <option value="georgia">Georgia</option>
            <option value="garamond">Garamond</option>
            <option value="sans">Arial</option>
            <option value="verdana">Verdana</option>
            <option value="hand">Handwriting</option>
            <option value="dyslexic">OpenDyslexic</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={settings.pageGuides} onChange={(e) => set('pageGuides', e.target.checked)} /> Show page boundaries
      </label>

      <h4>Header &amp; footer</h4>
      <label className="field">
        <span>Header</span>
        <input className="input" value={settings.header} onChange={(e) => set('header', e.target.value.slice(0, 120))} placeholder="e.g. Company name · Confidential" />
      </label>
      <label className="field">
        <span>Footer</span>
        <input className="input" value={settings.footer} onChange={(e) => set('footer', e.target.value.slice(0, 120))} placeholder="e.g. Prepared by…" />
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.pageNumbers} onChange={(e) => set('pageNumbers', e.target.checked)} /> Page numbers when printing / PDF
      </label>

      <h4>Brand</h4>
      {brand?.logo || brand?.accent || brand?.name ? (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => onChange({ logo: brand.logo ?? null, accent: brand.accent ?? null, brandName: brand.name ?? '', ...(brand.font ? { font: brand.font } : {}) })}
        >
          Apply my brand kit
        </button>
      ) : (
        <p className="muted small">Set up a brand kit (logo, colour, font) in Account settings to apply it here in one click.</p>
      )}
      {(settings.logo || settings.accent || settings.brandName) && (
        <button type="button" className="btn btn-text btn-sm" onClick={() => onChange({ logo: null, accent: null, brandName: '' })}>
          Remove branding
        </button>
      )}
      <p className="muted small">Print with Ctrl+P (or “Save as PDF”) to get these page settings, header, footer and page numbers.</p>
    </fieldset>
  );
}
