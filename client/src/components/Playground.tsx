import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { SimNetwork, type SimReplica } from '../sim.ts';
import { CollabEditor, type RemoteCursor } from './CollabEditor.tsx';
import { Inspector } from './Inspector.tsx';

const PEOPLE = [
  { name: 'Alice', color: '#e5484d' },
  { name: 'Bob', color: '#3e63dd' },
  { name: 'Carol', color: '#30a46c' },
];

const SEED = `Three replicas, one unreliable network.
Type in any pane. Then take Bob offline, edit both sides, and reconnect.
`;

const RACE_WORDS = ['apples ', 'bananas ', 'cherries '];

export function Playground() {
  const net = useMemo(() => new SimNetwork(PEOPLE, SEED), []);
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const [latency, setLatency] = useState(net.latency);
  const [inspected, setInspected] = useState(0);
  const racing = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const off = net.subscribe(bump);
    return () => {
      off();
      if (racing.current) clearInterval(racing.current);
      net.dispose();
    };
  }, [net]);

  const cursorsFor = (r: SimReplica): RemoteCursor[] =>
    net.replicas
      .filter((p) => p !== r && r.seen.has(p.doc.site))
      .map((p) => ({ site: p.doc.site, name: p.name, color: p.color, sel: r.seen.get(p.doc.site)! }));

  // Everyone types a different word at the very same spot, one key at a time.
  const race = () => {
    if (racing.current) return;
    const typists = net.replicas.filter((r) => r.online);
    const at = typists.map((r) => r.doc.idBefore(0));
    let step = 0;
    racing.current = setInterval(() => {
      let typed = false;
      typists.forEach((r, i) => {
        const word = RACE_WORDS[net.replicas.indexOf(r)];
        if (step >= word.length) return;
        const pos = Math.max(0, r.doc.posAfter(at[i]));
        const ops = r.doc.insert(pos, word[step]);
        at[i] = ops[0].id;
        net.sendOps(r, ops);
        net.sendSelection(r, [at[i], at[i]]);
        typed = true;
      });
      step++;
      if (!typed && racing.current) {
        clearInterval(racing.current);
        racing.current = null;
      }
    }, 140);
  };

  const converged = net.converged();
  const offline = net.replicas.filter((r) => !r.online).map((r) => r.name);
  let status: string;
  if (offline.length) status = `${offline.join(' & ')} offline: replicas may differ until reconnect`;
  else if (!converged) status = `Syncing… ${net.inFlight} message${net.inFlight === 1 ? '' : 's'} in flight`;
  else status = 'Converged: all replicas hold identical text';

  return (
    <div className="playground">
      <div className="controls" role="group" aria-label="Network controls">
        <label className="control">
          <span>
            Latency <strong>{latency} ms</strong>
          </span>
          <input
            type="range"
            min={0}
            max={3000}
            step={100}
            value={latency}
            onChange={(e) => {
              net.latency = Number(e.target.value);
              setLatency(net.latency);
            }}
          />
        </label>
        <label className="control check">
          <input
            type="checkbox"
            defaultChecked={net.jitter}
            onChange={(e) => {
              net.jitter = e.target.checked;
            }}
          />
          <span>Random jitter (messages race)</span>
        </label>
        <button className="btn" onClick={race} type="button">
          Run concurrent typing race
        </button>
        <div className={`sync-badge ${offline.length ? 'warn' : converged ? 'ok' : 'busy'}`} role="status">
          <span className="dot" />
          {status}
        </div>
      </div>

      <div className="replicas">
        {net.replicas.map((r) => (
          <section key={r.name} className={`replica ${r.online ? '' : 'is-offline'}`} style={{ borderTopColor: r.color }}>
            <header className="replica-head">
              <span className="avatar" style={{ background: r.color }}>
                {r.name[0]}
              </span>
              <strong>{r.name}</strong>
              <span className="muted small">
                {r.doc.length} chars · {r.doc.size - r.doc.length} tombstones
              </span>
              <label className="switch">
                <input type="checkbox" checked={r.online} onChange={(e) => net.setOnline(r, e.target.checked)} />
                <span>{r.online ? 'Online' : 'Offline'}</span>
              </label>
            </header>
            <CollabEditor
              doc={r.doc}
              version={tick}
              cursors={cursorsFor(r)}
              onLocalOps={(ops) => net.sendOps(r, ops)}
              onSelection={(sel) => net.sendSelection(r, sel)}
              label={`${r.name}'s editor`}
              minRows={6}
            />
          </section>
        ))}
      </div>

      <div className="inspector-wrap">
        <div className="inspector-head">
          <h3>Inside the CRDT</h3>
          <div className="tabs" role="tablist">
            {net.replicas.map((r, i) => (
              <button
                key={r.name}
                role="tab"
                aria-selected={inspected === i}
                className={inspected === i ? 'tab active' : 'tab'}
                onClick={() => setInspected(i)}
                type="button"
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          Every character ever typed, in RGA order, labelled with its id <code>site:clock</code>. Deleted characters stay
          as tombstones (struck out) so concurrent inserts can still find their neighbours.
        </p>
        <Inspector doc={net.replicas[inspected].doc} colors={Object.fromEntries(PEOPLE.map((p) => [p.name.toLowerCase(), p.color]))} />
      </div>
    </div>
  );
}
