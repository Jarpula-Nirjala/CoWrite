import { useRef, useState } from 'react';
import { loadImage } from '../kinds/slides/export.ts';

type Rect = { x: number; y: number; w: number; h: number };
const RATIOS: [string, number | null][] = [
  ['Free', null],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['16:9', 16 / 9],
  ['3:4', 3 / 4],
];

/** Crop frame drawn over an image (fractions of the image), with aspect presets. */
export function CropOverlay({ natural, onApply, onCancel }: { natural: { w: number; h: number }; onApply(r: Rect): void; onCancel(): void }) {
  const [r, setR] = useState<Rect>({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  const [ratio, setRatio] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const fit = (next: Rect, anchor?: string): Rect => {
    let { x, y, w, h } = next;
    w = Math.max(0.05, Math.min(1, w));
    h = Math.max(0.05, Math.min(1, h));
    if (ratio) {
      // Ratio in pixels → in fractions of this image.
      const k = ratio * (natural.h / natural.w);
      if (anchor === 'h') w = h * k;
      else h = w / k;
      if (h > 1) {
        h = 1;
        w = h * k;
      }
      if (w > 1) {
        w = 1;
        h = w / k;
      }
    }
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));
    return { x, y, w, h };
  };

  const drag = (e: React.PointerEvent, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => {
    e.preventDefault();
    e.stopPropagation();
    const rect = box.current!.getBoundingClientRect();
    const start = { ...r };
    const px = e.clientX;
    const py = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - px) / rect.width;
      const dy = (ev.clientY - py) / rect.height;
      if (mode === 'move') return setR(fit({ ...start, x: start.x + dx, y: start.y + dy }));
      let { x, y, w, h } = start;
      if (mode.includes('e')) w = start.w + dx;
      if (mode.includes('s')) h = start.h + dy;
      if (mode.includes('w')) {
        x = start.x + dx;
        w = start.w - dx;
      }
      if (mode.includes('n')) {
        y = start.y + dy;
        h = start.h - dy;
      }
      setR(fit({ x, y, w, h }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="crop-layer" ref={box} data-stop onPointerDown={(e) => e.stopPropagation()}>
      <div className="crop-rect" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} onPointerDown={(e) => drag(e, 'move')}>
        {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
          <span key={h} className={`crop-handle c-${h}`} onPointerDown={(e) => drag(e, h)} />
        ))}
      </div>
      <div className="crop-bar" onPointerDown={(e) => e.stopPropagation()}>
        {RATIOS.map(([label, v]) => (
          <button
            key={label}
            type="button"
            className={`atom-tool ${ratio === v ? 'on' : ''}`}
            onClick={() => {
              setRatio(v);
              setTimeout(() => setR((cur) => cur), 0);
            }}
          >
            {label}
          </button>
        ))}
        <button type="button" className="atom-tool on" onClick={() => onApply(r)}>
          ✓ Crop
        </button>
        <button type="button" className="atom-tool" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Cuts the region out of an image and returns it as a new file. */
export async function cropImage(url: string, r: Rect, mime = 'image/jpeg'): Promise<Blob> {
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * r.w));
  c.height = Math.max(1, Math.round(img.naturalHeight * r.h));
  c.getContext('2d')!.drawImage(img, img.naturalWidth * r.x, img.naturalHeight * r.y, c.width, c.height, 0, 0, c.width, c.height);
  const type = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise((done, fail) => c.toBlob((b) => (b ? done(b) : fail(new Error('Could not crop the image.'))), type, 0.92));
}
