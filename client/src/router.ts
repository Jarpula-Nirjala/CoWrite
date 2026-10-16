import { createElement, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const EVENT = 'cowrite:navigate';

function scrollToHash(hash: string): void {
  if (!hash) {
    requestAnimationFrame(() => window.scrollTo(0, 0));
    return;
  }
  // The page may still be loading (pages load on demand): keep looking for the target for a moment,
  // then scroll once it is there and again after images above it have settled.
  const id = decodeURIComponent(hash.slice(1));
  const started = Date.now();
  const tryScroll = () => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => el.getBoundingClientRect().top > 120 && el.scrollIntoView({ block: 'start' }), 700);
    } else if (Date.now() - started < 4000) setTimeout(tryScroll, 60);
  };
  requestAnimationFrame(tryScroll);
}

export function navigate(to: string, { replace = false } = {}): void {
  const url = new URL(to, window.location.href);
  const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  if (!samePage) window.dispatchEvent(new Event(EVENT));
  scrollToHash(url.hash);
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    if (window.location.hash) scrollToHash(window.location.hash);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return path;
}

/** The current query string, updated on in-app navigation. */
export function useSearch(): string {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => {
    const update = () => setSearch(window.location.search);
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return search;
}

export function queryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** In-app link: plain clicks navigate without a reload; modified clicks behave normally. */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return createElement('a', { href: to, onClick: handle, ...rest });
}
