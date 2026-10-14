import type { El } from './model.ts';

export function shapePath(shape: El['shape'], w: number, h: number): string {
  switch (shape) {
    case 'ellipse':
      return `M${w / 2} 0 A${w / 2} ${h / 2} 0 1 1 ${w / 2 - 0.01} 0Z`;
    case 'triangle':
      return `M${w / 2} 0 L${w} ${h} L0 ${h}Z`;
    case 'diamond':
      return `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2}Z`;
    case 'arrow':
      return `M0 ${h * 0.3} L${w * 0.65} ${h * 0.3} L${w * 0.65} 0 L${w} ${h / 2} L${w * 0.65} ${h} L${w * 0.65} ${h * 0.7} L0 ${h * 0.7}Z`;
    case 'line':
      return `M0 ${h / 2} L${w} ${h / 2}`;
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.42 : 1;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${w / 2 + Math.cos(a) * r * (w / 2)} ${h / 2 + Math.sin(a) * r * (h / 2)}`);
      }
      return `M${pts.join(' L')}Z`;
    }
    case 'round': {
      const r = Math.min(w, h) * 0.18;
      return `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0Z`;
    }
    default:
      return `M0 0 H${w} V${h} H0Z`;
  }
}
