export const PEER_COLORS = ['#b4442c', '#2f5d8a', '#2e7d5b', '#a8642a', '#6b4c9a', '#1f6f8b', '#9c3d6b', '#7a6a2f'];

const ADJECTIVES = ['Curious', 'Brave', 'Quiet', 'Swift', 'Clever', 'Gentle', 'Bold', 'Witty', 'Calm', 'Lucky'];
const ANIMALS = ['Otter', 'Falcon', 'Panda', 'Lynx', 'Heron', 'Koala', 'Tiger', 'Dolphin', 'Fox', 'Owl'];

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadIdentity(): { name: string; color: string } {
  const s = storage();
  let name: string | null = null;
  let color: string | null = null;
  try {
    name = s?.getItem('cowrite:name') ?? null;
    color = s?.getItem('cowrite:color') ?? null;
  } catch {
    // storage blocked: fall through to a fresh identity
  }
  return {
    name: name || `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: color && PEER_COLORS.includes(color) ? color : pick(PEER_COLORS),
  };
}

export function saveIdentity(name: string, color: string): void {
  try {
    storage()?.setItem('cowrite:name', name);
    storage()?.setItem('cowrite:color', color);
  } catch {
    // not fatal
  }
}

export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
