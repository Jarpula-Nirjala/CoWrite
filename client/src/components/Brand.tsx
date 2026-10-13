import { navigate } from '../router.ts';

export function Brand() {
  return (
    <a className="brand" href="/" onClick={(e) => (e.preventDefault(), navigate('/'))}>
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M9 9h14M9 15h14M9 21h8" stroke="var(--accent-text)" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="20" y="18" width="2.5" height="8" rx="1" fill="#e5484d" />
      </svg>
      CoWrite
    </a>
  );
}
