import { useState } from 'react';
import type { Role } from '../../../shared/protocol.ts';
import { api, errorText, type DocDetails } from '../api.ts';
import { SITE_THEMES } from '../pages/SitePage.tsx';

/** Turn the document into a mini website: pick a design, publish, share the link. */
export function WebsitePanel({
  docId,
  meta,
  role,
  site,
  onSite,
  onMeta,
}: {
  docId: string;
  meta: DocDetails | null;
  role: Role | null;
  site: { theme?: string; accent?: string | null } | undefined;
  onSite(s: { theme: string; accent: string | null }): void;
  onMeta(m: DocDetails): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!meta) return <p className="panel-empty muted">Websites can be made from documents saved to an account.</p>;
  const owner = role === 'owner';
  const theme = site?.theme ?? 'clean';
  const url = `${location.origin}/site/${docId}`;
  return (
    <div className="website-panel">
      <p className="muted small">Turn this document into a one-page website. The first heading becomes the hero, the next headings become the navigation and sections, and the first image becomes the cover. Forms work on the site too.</p>
      <h4>Design</h4>
      <div className="site-themes">
        {SITE_THEMES.map((t) => (
          <button key={t.id} className={`site-theme ${theme === t.id ? 'on' : ''}`} disabled={role !== 'owner' && role !== 'editor'} onClick={() => onSite({ theme: t.id, accent: site?.accent ?? null })} type="button">
            <span className="site-swatch" style={{ background: t.hero }} />
            {t.name}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Accent colour</span>
        <input type="color" value={site?.accent || SITE_THEMES.find((t) => t.id === theme)!.accent} disabled={role !== 'owner' && role !== 'editor'} onChange={(e) => onSite({ theme, accent: e.target.value })} />
      </label>
      <h4>Publish</h4>
      {meta.encrypted ? (
        <p className="notice small">End-to-end encrypted documents cannot be published.</p>
      ) : meta.published ? (
        <>
          <p className="small">
            <span className="ai-badge on">● Live</span> Anyone with the link can view the website.
          </p>
          <div className="inline-form">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Website link" />
            <button className="btn btn-outline btn-sm" onClick={() => void navigator.clipboard?.writeText(url)} type="button">
              Copy
            </button>
          </div>
          <div className="row-actions">
            <a className="btn btn-primary btn-sm" href={`/site/${docId}`} target="_blank" rel="noreferrer">
              Open website ↗
            </a>
            <a className="btn btn-text btn-sm" href={`/p/${docId}`} target="_blank" rel="noreferrer">
              Blog view
            </a>
          </div>
        </>
      ) : (
        <p className="muted small">Not published yet.</p>
      )}
      {owner && !meta.encrypted && (
        <button
          className={`btn btn-sm ${meta.published ? 'btn-text danger' : 'btn-primary'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api<{ document: DocDetails }>(`/docs/${docId}`, { method: 'PATCH', body: { published: !meta.published } });
              onMeta({ ...meta, published: r.document.published });
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
          type="button"
        >
          {meta.published ? 'Unpublish' : '🌐 Publish website'}
        </button>
      )}
      {!owner && !meta.published && <p className="muted small">Only the owner can publish.</p>}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}
