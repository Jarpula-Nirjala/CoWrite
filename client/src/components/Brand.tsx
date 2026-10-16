import type { CSSProperties } from 'react';
import { Link } from '../router.ts';

/** The letters of the wordmark; the "i" is drawn dotless so its dot can be a little light bulb. */
const LETTERS = ['C', 'o', 'W', 'r', 'ı', 't', 'e'];

/**
 * The CoWrite wordmark, drawn as live text rather than an image, so it takes the colours of the current
 * theme (dark ink on light themes, white on dark ones) and each letter can animate. `compact` shows the
 * "C" monogram used in the editor header.
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact)
    return (
      <Link className="brand brand-compact" to="/" aria-label="CoWrite home">
        <span className="brand-mono" aria-hidden>
          <span>C</span>
          <i className="brand-bulb" />
        </span>
      </Link>
    );
  return (
    <Link className="brand" to="/" aria-label="CoWrite home">
      <span className="brand-word" aria-hidden>
        {LETTERS.map((ch, i) => (
          <span key={i} className={`bl ${ch === 'ı' ? 'bl-i' : ''}`} style={{ '--i': i } as CSSProperties}>
            {ch}
            {ch === 'ı' && <i className="brand-bulb" />}
          </span>
        ))}
        <svg className="brand-plane" viewBox="0 0 40 24" aria-hidden>
          <path className="brand-trail" d="M1 21 C 9 21, 15 17, 21 12" />
          <path className="brand-wing" d="M18 13 L39 2 L31 21 L26 15 Z" />
          <path className="brand-fold" d="M26 15 L39 2 L24 17 Z" />
        </svg>
      </span>
    </Link>
  );
}
