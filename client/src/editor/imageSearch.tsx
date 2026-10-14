import { useEffect, useState } from 'react';
import { api, errorText } from '../api.ts';
import { Modal, Spinner } from '../components/ui.tsx';

export interface StockImage {
  id: string;
  title: string;
  url: string;
  thumb: string;
  credit: string;
  source: string;
}

/** Search openly licensed photos (Openverse) and insert one with attribution. */
export function ImageSearch({ onPick, onClose, initial = '' }: { onPick(img: StockImage): void; onClose(): void; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<StockImage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const search = async (query: string, p = 1) => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ results: StockImage[] }>(`/media/search?q=${encodeURIComponent(query)}&page=${p}`);
      setResults(p === 1 ? r.results : [...(results ?? []), ...r.results]);
      setPage(p);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initial) void search(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="Free stock photos" onClose={onClose} wide>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. mountains, office, coffee" autoFocus />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Search
        </button>
      </form>
      <p className="muted small">Openly licensed images from Openverse. The photographer and licence are added as a credit under the image.</p>
      {error && <div className="alert">{error}</div>}
      {busy && !results && <Spinner label="Searching…" />}
      {results && !results.length && <p className="muted">No images found. Try another word.</p>}
      {results && (
        <div className="stock-grid">
          {results.map((r) => (
            <button key={r.id} type="button" className="stock-item" onClick={() => onPick(r)} title={`${r.title} — ${r.credit}`}>
              <img src={r.thumb} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
              <span>{r.credit}</span>
            </button>
          ))}
        </div>
      )}
      {results && results.length >= 24 * page && (
        <button className="btn btn-outline" type="button" disabled={busy} onClick={() => void search(q, page + 1)}>
          {busy ? 'Loading…' : 'More results'}
        </button>
      )}
    </Modal>
  );
}
