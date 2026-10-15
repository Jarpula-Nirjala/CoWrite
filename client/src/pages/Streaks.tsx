import { useEffect, useState } from 'react';
import { Link } from '../router.ts';
import { localPrefs } from '../lib/prefs.ts';
import { Glyph } from '../components/Glyph.tsx';

export interface Writing {
  today: number;
  streak: number;
  longest: number;
  calendar: { day: string; chars: number }[];
}

// One hue, light to dark (sequential), so intensity reads as "more writing".
const STEPS = ['#e9eef6', '#c3d3ea', '#8eaedb', '#5583c4', '#1f3a68'];
const CHARS_PER_WORD = 6;

/** Streak, daily goal ring and a six-month writing calendar. */
export function StreakPanel({ writing }: { writing: Writing }) {
  const [goal, setGoal] = useState(() => localPrefs().dailyGoal);
  useEffect(() => {
    const on = () => setGoal(localPrefs().dailyGoal);
    window.addEventListener('cowrite:prefs', on);
    return () => window.removeEventListener('cowrite:prefs', on);
  }, []);
  const words = Math.round(writing.today / CHARS_PER_WORD);
  const pct = goal > 0 ? Math.min(1, words / goal) : 0;
  const R = 46;
  const C = 2 * Math.PI * R;
  const max = Math.max(1, ...writing.calendar.map((d) => d.chars));
  const level = (c: number) => (c === 0 ? 0 : Math.min(4, 1 + Math.floor((c / max) * 3.999)));

  // Columns are weeks (Monday first), rows are weekdays.
  const first = new Date(`${writing.calendar[0]?.day}T00:00:00Z`);
  const pad = (first.getUTCDay() + 6) % 7;
  const cells = [...Array.from({ length: pad }, () => null), ...writing.calendar];
  const weeks = Math.ceil(cells.length / 7);

  return (
    <section className="panel streaks">
      <div className="streak-top">
        <div className="goal-ring" role="img" aria-label={`${words} of ${goal} words today`}>
          <svg viewBox="0 0 110 110" width="120" height="120">
            <circle cx="55" cy="55" r={R} fill="none" stroke="var(--border)" strokeWidth="10" />
            <circle cx="55" cy="55" r={R} fill="none" stroke={pct >= 1 ? '#1e7a4c' : '#1f3a68'} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 55 55)" />
          </svg>
          <span className="goal-text">
            <strong>{words.toLocaleString()}</strong>
            <span className="muted small">of {goal.toLocaleString()} words</span>
          </span>
        </div>
        <div className="streak-stats">
          <div className="streak-big">
            <span aria-hidden>
              <Glyph e={writing.streak > 0 ? '🔥' : '✏️'} size={40} />
            </span>
            <strong>{writing.streak}</strong>
            <span>day{writing.streak === 1 ? '' : 's'} in a row</span>
          </div>
          <p className="muted small">
            Longest streak: {writing.longest} day{writing.longest === 1 ? '' : 's'}. {pct >= 1 ? 'Goal reached today.' : writing.streak > 0 && writing.today === 0 ? 'Write something today to keep your streak.' : 'Words are estimated from characters typed.'}{' '}
            <Link to="/account">Change goal</Link>
          </p>
        </div>
      </div>
      <h3>Last six months</h3>
      <div className="contrib" style={{ gridTemplateColumns: `repeat(${weeks}, 12px)` }} role="img" aria-label="Writing calendar">
        {Array.from({ length: weeks * 7 }, (_, i) => {
          // Fill column by column.
          const w = Math.floor(i / 7);
          const d = i % 7;
          const c = cells[w * 7 + d];
          return <span key={i} className="contrib-cell" style={{ gridColumn: w + 1, gridRow: d + 1, background: c ? STEPS[level(c.chars)] : 'transparent' }} title={c ? `${c.day}: ${c.chars ? `≈${Math.round(c.chars / CHARS_PER_WORD)} words` : 'no writing'}` : undefined} />;
        })}
      </div>
      <div className="contrib-legend small muted">
        Less
        {STEPS.map((s) => (
          <span key={s} className="contrib-cell" style={{ background: s }} />
        ))}
        More
      </div>
    </section>
  );
}
