import { useEffect, useState, type ReactNode } from 'react';
import { api, errorText } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Spinner } from '../components/ui.tsx';
import { Link, navigate } from '../router.ts';

interface ActivityData {
  days: { day: string; edits: number; mine: number }[];
  collaborators: { name: string; edits: number }[];
  topDocs: { id: string; title: string; edits: number }[];
  totals: { owned: number; shared: number; comments: number; written: number };
}

// Validated categorical pair (lightness, chroma, CVD separation, contrast all pass).
const MINE = '#2a5fa8';
const OTHERS = '#b07a1e';

const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Stacked daily bars: my edits at the base, everyone else's on top. */
function DailyChart({ days }: { days: ActivityData['days'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { l: 40, r: 8, t: 12, b: 28 };
  const max = Math.max(1, ...days.map((d) => d.edits));
  const nice = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / p) * p;
  })();
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / days.length;
  const bw = Math.max(4, slot - 4);
  const y = (v: number) => pad.t + plotH - (v / nice) * plotH;
  const ticks = [0, nice / 2, nice];

  const bar = (x: number, top: number, bottom: number, color: string, rounded: boolean) => {
    const h = Math.max(0, bottom - top);
    if (h <= 0) return null;
    const r = rounded ? Math.min(4, h, bw / 2) : 0;
    // Rounded at the data end only; square at the base.
    const d = `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${bottom} Z`;
    return <path d={d} fill={color} />;
  };

  const h = hover !== null ? days[hover] : null;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Edits per day over the last 30 days, split into your edits and other people's">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} className="axis" textAnchor="end">
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad.l + i * slot + (slot - bw) / 2;
          const others = d.edits - d.mine;
          const mineTop = y(d.mine);
          return (
            <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.45}>
              {bar(x, mineTop, y(0), MINE, others <= 0)}
              {/* 2px surface gap between stacked segments */}
              {others > 0 && bar(x, y(d.edits), mineTop - (d.mine > 0 ? 2 : 0), OTHERS, true)}
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
        {[0, Math.floor(days.length / 2), days.length - 1].map((i) => (
          <text key={i} x={pad.l + i * slot + slot / 2} y={H - 8} className="axis" textAnchor="middle">
            {shortDay(days[i].day)}
          </text>
        ))}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${((pad.l + (hover! + 0.5) * slot) / W) * 100}%` }}>
          <strong>{shortDay(h.day)}</strong>
          <span>
            <i style={{ background: MINE }} /> Mine: {h.mine.toLocaleString()}
          </span>
          <span>
            <i style={{ background: OTHERS }} /> Others: {(h.edits - h.mine).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

function BarList({ rows, color }: { rows: { label: ReactNode; value: number; key: string }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted small">No activity in the last 30 days.</p>;
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </span>
          <span className="bar-value">{r.value.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

export function Activity() {
  const { user, ready } = useAuth();
  const [data, setData] = useState<ActivityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    document.title = 'Activity · CoWrite';
  }, []);
  useEffect(() => {
    if (ready && !user) navigate(`/signin?next=${encodeURIComponent('/activity')}`, { replace: true });
    if (user) api<ActivityData>('/activity').then(setData, (e) => setError(errorText(e)));
  }, [ready, user]);

  const total30 = data?.days.reduce((n, d) => n + d.edits, 0) ?? 0;
  const mine30 = data?.days.reduce((n, d) => n + d.mine, 0) ?? 0;
  const activeDays = data?.days.filter((d) => d.mine > 0).length ?? 0;

  return (
    <div className="page">
      <SiteHeader />
      <main className="container activity">
        <p className="kicker">Insights</p>
        <h1>Your activity</h1>
        <p className="muted">Edits across every document you own or collaborate on, over the last 30 days. One edit is one character typed or deleted.</p>
        {error && <div className="alert">{error}</div>}
        {!data ? (
          <Spinner />
        ) : (
          <>
            <dl className="tiles">
              <div className="tile">
                <dt>Your edits (30 days)</dt>
                <dd>{mine30.toLocaleString()}</dd>
              </div>
              <div className="tile">
                <dt>All edits (30 days)</dt>
                <dd>{total30.toLocaleString()}</dd>
              </div>
              <div className="tile">
                <dt>Days you wrote</dt>
                <dd>{activeDays} / 30</dd>
              </div>
              <div className="tile">
                <dt>Documents</dt>
                <dd>
                  {data.totals.owned} <span className="tile-sub">owned · {data.totals.shared} shared</span>
                </dd>
              </div>
              <div className="tile">
                <dt>Characters written, all time</dt>
                <dd>{data.totals.written.toLocaleString()}</dd>
              </div>
              <div className="tile">
                <dt>Comments made</dt>
                <dd>{data.totals.comments.toLocaleString()}</dd>
              </div>
            </dl>

            <section className="panel">
              <div className="row-between">
                <h2>Edits per day</h2>
                <button className="btn btn-text btn-sm" onClick={() => setTable(!table)} type="button">
                  {table ? 'Show chart' : 'Show as table'}
                </button>
              </div>
              <div className="legend" aria-hidden={table}>
                <span>
                  <i style={{ background: MINE }} /> Mine
                </span>
                <span>
                  <i style={{ background: OTHERS }} /> Others
                </span>
              </div>
              {table ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Mine</th>
                        <th>Others</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.days.map((d) => (
                        <tr key={d.day}>
                          <td>{shortDay(d.day)}</td>
                          <td>{d.mine.toLocaleString()}</td>
                          <td>{(d.edits - d.mine).toLocaleString()}</td>
                          <td>{d.edits.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <DailyChart days={data.days} />
              )}
            </section>

            <div className="two-col">
              <section className="panel">
                <h2>Top collaborators</h2>
                <BarList color={MINE} rows={data.collaborators.map((c) => ({ key: c.name, label: c.name, value: c.edits }))} />
              </section>
              <section className="panel">
                <h2>Most active documents</h2>
                <BarList
                  color={MINE}
                  rows={data.topDocs.map((d) => ({
                    key: d.id,
                    label: <Link to={`/d/${d.id}`}>{d.title}</Link>,
                    value: d.edits,
                  }))}
                />
              </section>
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
