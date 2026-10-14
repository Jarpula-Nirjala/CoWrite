import { Link } from '../router.ts';

/** The CoWrite wordmark; `compact` shows just the "C" mark (editor header). */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={compact ? 'brand brand-compact' : 'brand'} to="/" aria-label="CoWrite home">
      {compact ? (
        <img src="/apple-touch-icon.png" alt="CoWrite" width={36} height={36} />
      ) : (
        <picture>
          <source srcSet="/logo.webp" type="image/webp" />
          <img src="/logo.png" alt="CoWrite" width={157} height={40} />
        </picture>
      )}
    </Link>
  );
}
