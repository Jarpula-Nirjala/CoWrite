import { useEffect, useState } from 'react';
import { EMBED } from '../../../shared/crdt.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText } from '../api.ts';
import { createAndOpen } from '../lib/create.ts';
import { AppLogo } from './AppLogo.tsx';
import { GoogleGate } from './GoogleGate.tsx';
import { Spinner } from './ui.tsx';
import * as ic from '@mdi/js';
import { MIcon } from './MIcon.tsx';

interface Video {
  id: string;
  title: string;
  channel: string;
  published: string;
  thumb: string;
}
interface Channel {
  id: string;
  title: string;
  thumb: string;
}
type Feed = { kind: 'trending' } | { kind: 'mine' } | { kind: 'liked' } | { kind: 'search'; q: string } | { kind: 'channel'; id: string; title: string };

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  for (const [n, u] of [
    [31_536_000, 'year'],
    [2_592_000, 'month'],
    [604_800, 'week'],
    [86_400, 'day'],
    [3600, 'hour'],
  ] as const)
    if (s >= n) return `${Math.floor(s / n)} ${u}${Math.floor(s / n) > 1 ? 's' : ''} ago`;
  return 'just now';
};
const decode = (s: string) => {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
};

/** YouTube inside CoWrite: trending, subscriptions, liked and your own videos, search, and a player. */
export function YouTubeApp() {
  return (
    <GoogleGate feature="youtube" tab="youtube">
      <Tube />
    </GoogleGate>
  );
}

function Tube() {
  const [feed, setFeed] = useState<Feed>({ kind: 'trending' });
  const [q, setQ] = useState('');
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [playing, setPlaying] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    api<{ channels: Channel[] }>('/integrations/google/youtube?feed=subs').then((r) => setChannels(r.channels ?? []), () => {});
  }, []);
  useEffect(() => {
    setVideos(null);
    setError(null);
    const qs =
      feed.kind === 'search' ? `q=${encodeURIComponent(feed.q)}` : feed.kind === 'channel' ? `channel=${encodeURIComponent(feed.id)}` : feed.kind === 'mine' ? '' : `feed=${feed.kind}`;
    api<{ videos: Video[]; noChannel?: boolean }>(`/integrations/google/youtube?${qs}`).then(
      (r) => {
        setVideos(r.videos ?? []);
        if (r.noChannel) setError('You have no YouTube channel yet.');
      },
      (e) => (setVideos([]), setError(errorText(e))),
    );
  }, [feed]);

  const notes = (v: Video) =>
    void createAndOpen(decode(v.title), 'doc', {
      tokens: [
        ...markdownToTokens(`# ${decode(v.title)}\n*${v.channel}* · https://www.youtube.com/watch?v=${v.id}`),
        { ch: EMBED, a: { atom: 'embed', src: `https://www.youtube-nocookie.com/embed/${v.id}`, kind: 'YouTube', ratio: 56.25, url: `https://www.youtube.com/watch?v=${v.id}` } },
        { ch: '\n' },
        ...markdownToTokens('## Notes\n- '),
      ],
      settings: { theme: 'simple', font: 'sans' },
    });
  const nav = (f: Feed) => (setFeed(f), setPlaying(null));
  const title = feed.kind === 'trending' ? 'Trending' : feed.kind === 'mine' ? 'Your videos' : feed.kind === 'liked' ? 'Liked videos' : feed.kind === 'channel' ? feed.title : `Results for “${feed.q}”`;

  return (
    <div className={`yt ${collapsed ? 'yt-collapsed' : ''}`}>
      <header className="yt-top">
        <button className="gm-icon" onClick={() => setCollapsed(!collapsed)} aria-label="Guide" title="Guide" type="button">
          <MIcon path={ic.mdiMenu} size={24} />
        </button>
        <span className="yt-brand">
          <AppLogo name="youtube" size={28} /> <b>YouTube</b>
        </span>
        <form
          className="yt-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) nav({ kind: 'search', q: q.trim() });
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search YouTube" />
          <button type="submit" aria-label="Search">
            <MIcon path={ic.mdiMagnify} size={24} />
          </button>
        </form>
      </header>
      <aside className="yt-side">
        {(
          [
            ['trending', ic.mdiFire, 'Trending'],
            ['mine', ic.mdiPlayBoxMultipleOutline, 'Your videos'],
            ['liked', ic.mdiThumbUpOutline, 'Liked videos'],
          ] as const
        ).map(([k, icon, label]) => (
          <button key={k} className={feed.kind === k ? 'on' : ''} onClick={() => nav({ kind: k })} type="button" title={label}>
            <span className="gm-ico">
              <MIcon path={icon} size={24} />
            </span>
            <span className="gm-lname">{label}</span>
          </button>
        ))}
        {channels.length > 0 && <p className="gm-sub">Subscriptions</p>}
        {channels.map((c) => (
          <button key={c.id} className={feed.kind === 'channel' && feed.id === c.id ? 'on' : ''} onClick={() => nav({ kind: 'channel', id: c.id, title: c.title })} type="button" title={c.title}>
            <img className="yt-chan" src={c.thumb} alt="" loading="lazy" />
            <span className="gm-lname">{c.title}</span>
          </button>
        ))}
      </aside>
      <main className="yt-main">
        {playing ? (
          <div className="yt-player">
            <button className="btn btn-text btn-sm" onClick={() => setPlaying(null)} type="button">
              <MIcon path={ic.mdiArrowLeft} size={18} /> Back to {title}
            </button>
            <div className="yt-frame">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${playing.id}?autoplay=1&rel=0`}
                title={decode(playing.title)}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
            <h3>{decode(playing.title)}</h3>
            <p className="muted">
              {playing.channel} · {ago(playing.published)}
            </p>
            <span className="row-actions">
              <button className="yt-pill" onClick={() => notes(playing)} type="button">
                <MIcon path={ic.mdiNoteEditOutline} /> Take notes in CoWrite
              </button>
              <button className="yt-pill" onClick={() => void navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${playing.id}`)} type="button">
                <MIcon path={ic.mdiShareOutline} /> Share
              </button>
            </span>
            {videos && videos.length > 1 && (
              <>
                <p className="gm-sub">Up next</p>
                <div className="yt-grid small">
                  {videos
                    .filter((v) => v.id !== playing.id)
                    .slice(0, 8)
                    .map((v) => (
                      <Card key={v.id} v={v} onPlay={() => setPlaying(v)} />
                    ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <h3 className="yt-title">{title}</h3>
            {error && <p className="muted">{error}</p>}
            {!videos ? (
              <Spinner />
            ) : (
              <div className="yt-grid">
                {videos.map((v) => (
                  <Card key={v.id} v={v} onPlay={() => setPlaying(v)} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Card({ v, onPlay }: { v: Video; onPlay(): void }) {
  return (
    <button className="yt-card" onClick={onPlay} type="button">
      <img src={v.thumb} alt="" loading="lazy" />
      <b>{decode(v.title)}</b>
      <small className="muted">
        {v.channel} · {ago(v.published)}
      </small>
    </button>
  );
}
