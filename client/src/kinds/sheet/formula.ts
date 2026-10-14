/** A small spreadsheet formula engine: =SUM(A1:B3)*2, =IF(A1>10,"big","small"), … */

export type Value = number | string | boolean | null;
export class FormulaError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const colName = (c: number): string => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const colIndex = (s: string): number => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const ref = (c: number, r: number) => `${colName(c)}${r + 1}`;
export function parseRef(s: string): { c: number; r: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(s);
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
}

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') {
          s += '"';
          j += 2;
        } else if (src[j] === '"') break;
        else s += src[j++];
      }
      if (j >= src.length) throw new FormulaError('#ERROR!');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const word = /^\$?[A-Za-z_][A-Za-z0-9_.$]*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      if (parseRef(w)) out.push({ t: 'ref', v: w.replace(/\$/g, '').toUpperCase() });
      else out.push({ t: 'id', v: w.toUpperCase() });
      i += w.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>(),:%'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    throw new FormulaError('#ERROR!');
  }
  return out;
}

type Node =
  | { k: 'lit'; v: Value }
  | { k: 'ref'; v: string }
  | { k: 'range'; a: string; b: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'un'; op: string; x: Node }
  | { k: 'bin'; op: string; a: Node; b: Node };

const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function parse(src: string): Node {
  const toks = lex(src);
  let i = 0;
  const peek = () => toks[i];
  const take = (v?: string) => {
    const t = toks[i++];
    if (!t || (v !== undefined && !(t.t === 'op' && t.v === v))) throw new FormulaError('#ERROR!');
    return t;
  };
  const primary = (): Node => {
    const t = take();
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'ref') {
      const n = peek();
      if (n?.t === 'op' && n.v === ':') {
        i++;
        const b = take();
        if (b.t !== 'ref') throw new FormulaError('#ERROR!');
        return { k: 'range', a: t.v, b: b.v };
      }
      return { k: 'ref', v: t.v };
    }
    if (t.t === 'id') {
      if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'lit', v: t.v === 'TRUE' };
      take('(');
      const args: Node[] = [];
      if (!(peek()?.t === 'op' && peek().v === ')')) {
        for (;;) {
          args.push(expr(0));
          if (peek()?.t === 'op' && peek().v === ',') i++;
          else break;
        }
      }
      take(')');
      return { k: 'call', name: t.v, args };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = expr(0);
      take(')');
      return e;
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) return { k: 'un', op: t.v, x: unary() };
    throw new FormulaError('#ERROR!');
  };
  const unary = (): Node => {
    let n = primary();
    while (peek()?.t === 'op' && peek().v === '%') {
      i++;
      n = { k: 'bin', op: '/', a: n, b: { k: 'lit', v: 100 } };
    }
    return n;
  };
  const expr = (min: number): Node => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < min) break;
      i++;
      const p = PREC[t.v];
      const right = expr(t.v === '^' ? p : p + 1);
      left = { k: 'bin', op: t.v, a: left, b: right };
    }
    return left;
  };
  const n = expr(0);
  if (i < toks.length) throw new FormulaError('#ERROR!');
  return n;
}

const num = (v: Value): number => {
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(v.replace(/,/g, ''));
  if (Number.isNaN(n)) throw new FormulaError('#VALUE!');
  return n;
};
const str = (v: Value) => (v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
const truthy = (v: Value) => (typeof v === 'string' ? v.length > 0 && v.toUpperCase() !== 'FALSE' : Boolean(v));

type Arg = Value | Value[];
const flat = (args: Arg[]) => args.flatMap((a) => (Array.isArray(a) ? a : [a]));
const nums = (args: Arg[]) => flat(args).filter((v): v is number => typeof v === 'number');
const nums1 = (args: Arg[]) => args.flatMap((a) => (Array.isArray(a) ? a.filter((v): v is number => typeof v === 'number') : [num(a)]));

const FNS: Record<string, (args: Arg[]) => Value> = {
  SUM: (a) => nums1(a).reduce((s, x) => s + x, 0),
  AVERAGE: (a) => {
    const n = nums1(a);
    if (!n.length) throw new FormulaError('#DIV/0!');
    return n.reduce((s, x) => s + x, 0) / n.length;
  },
  MIN: (a) => (nums1(a).length ? Math.min(...nums1(a)) : 0),
  MAX: (a) => (nums1(a).length ? Math.max(...nums1(a)) : 0),
  COUNT: (a) => nums(a).length,
  COUNTA: (a) => flat(a).filter((v) => v !== null && v !== '').length,
  PRODUCT: (a) => nums1(a).reduce((s, x) => s * x, 1),
  MEDIAN: (a) => {
    const n = nums1(a).sort((x, y) => x - y);
    if (!n.length) throw new FormulaError('#NUM!');
    const m = Math.floor(n.length / 2);
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  },
  ROUND: (a) => {
    const k = 10 ** num(a[1] as Value ?? 0);
    return Math.round(num(a[0] as Value) * k) / k;
  },
  ABS: (a) => Math.abs(num(a[0] as Value)),
  SQRT: (a) => {
    const n = num(a[0] as Value);
    if (n < 0) throw new FormulaError('#NUM!');
    return Math.sqrt(n);
  },
  POWER: (a) => num(a[0] as Value) ** num(a[1] as Value),
  MOD: (a) => {
    const d = num(a[1] as Value);
    if (!d) throw new FormulaError('#DIV/0!');
    return num(a[0] as Value) % d;
  },
  IF: (a) => (truthy(a[0] as Value) ? ((a[1] as Value) ?? true) : ((a[2] as Value) ?? false)),
  AND: (a) => flat(a).every(truthy),
  OR: (a) => flat(a).some(truthy),
  NOT: (a) => !truthy(a[0] as Value),
  CONCAT: (a) => flat(a).map(str).join(''),
  CONCATENATE: (a) => flat(a).map(str).join(''),
  LEN: (a) => str(a[0] as Value).length,
  UPPER: (a) => str(a[0] as Value).toUpperCase(),
  LOWER: (a) => str(a[0] as Value).toLowerCase(),
  TRIM: (a) => str(a[0] as Value).trim().replace(/\s+/g, ' '),
  LEFT: (a) => str(a[0] as Value).slice(0, num((a[1] as Value) ?? 1)),
  RIGHT: (a) => {
    const s = str(a[0] as Value);
    return s.slice(Math.max(0, s.length - num((a[1] as Value) ?? 1)));
  },
  TODAY: () => new Date().toISOString().slice(0, 10),
  NOW: () => new Date().toLocaleString(),
  COUNTIF: (a) => {
    const range = Array.isArray(a[0]) ? a[0] : [a[0]];
    const test = criterion(a[1] as Value);
    return range.filter(test).length;
  },
  SUMIF: (a) => {
    const range = Array.isArray(a[0]) ? a[0] : [a[0]];
    const sums = a[2] === undefined ? range : Array.isArray(a[2]) ? a[2] : [a[2]];
    const test = criterion(a[1] as Value);
    return range.reduce<number>((s, v, i) => (test(v) && typeof sums[i] === 'number' ? s + (sums[i] as number) : s), 0);
  },
};

function criterion(c: Value): (v: Value) => boolean {
  const m = typeof c === 'string' ? /^(<=|>=|<>|<|>|=)?(.*)$/.exec(c) : null;
  if (!m) return (v) => v === c || (typeof c === 'number' && num(v) === c);
  const op = m[1] ?? '=';
  const target: Value = m[2] !== '' && !Number.isNaN(Number(m[2])) ? Number(m[2]) : m[2];
  return (v) => {
    const cmp = typeof target === 'number' && typeof v === 'number' ? v - target : str(v).toLowerCase().localeCompare(str(target).toLowerCase());
    return op === '=' ? cmp === 0 : op === '<>' ? cmp !== 0 : op === '<' ? cmp < 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : cmp >= 0;
  };
}

const ERRORS = new Set(['#ERROR!', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#REF!', '#CYCLE!']);

export const FUNCTIONS = Object.keys(FNS).sort();

/** Turns raw cell input into a value ("12" -> 12, "TRUE" -> true). */
export function literal(raw: string): Value {
  const t = raw.trim();
  if (t === '') return null;
  if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^[-+]?\.\d+$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^[-+]?\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  if (/^(true|false)$/i.test(t)) return t.toUpperCase() === 'TRUE';
  return raw;
}

/** Evaluates every cell; `get` returns raw input. Errors become "#…" strings. */
export class Sheet {
  private cache = new Map<string, Value>();
  private visiting = new Set<string>();
  private parsed = new Map<string, Node | FormulaError>();
  private get: (ref: string) => string | undefined;
  constructor(get: (ref: string) => string | undefined) {
    this.get = get;
  }

  value(r: string): Value {
    const hit = this.cache.get(r);
    if (hit !== undefined || this.cache.has(r)) return hit ?? null;
    const raw = this.get(r) ?? '';
    let v: Value;
    if (raw.startsWith('=') && raw.length > 1) {
      if (this.visiting.has(r)) throw new FormulaError('#CYCLE!');
      this.visiting.add(r);
      try {
        let node = this.parsed.get(raw);
        if (!node) {
          try {
            node = parse(raw.slice(1));
          } catch (e) {
            node = e instanceof FormulaError ? e : new FormulaError('#ERROR!');
          }
          this.parsed.set(raw, node);
        }
        if (node instanceof FormulaError) throw node;
        const out = this.eval(node);
        if (Array.isArray(out)) v = out[0] ?? null;
        else v = out;
        if (typeof v === 'number' && !Number.isFinite(v)) v = '#NUM!';
      } catch (e) {
        if (e instanceof FormulaError && e.code === '#CYCLE!' && this.visiting.size > 1) {
          this.visiting.delete(r);
          throw e;
        }
        v = e instanceof FormulaError ? e.code : '#ERROR!';
      } finally {
        this.visiting.delete(r);
      }
    } else v = literal(raw);
    this.cache.set(r, v);
    return v;
  }

  private cell(r: string): Value {
    const v = this.value(r);
    if (typeof v === 'string' && ERRORS.has(v) && this.isFormula(r)) throw new FormulaError(v);
    return v;
  }

  private isFormula(r: string) {
    return (this.get(r) ?? '').startsWith('=');
  }

  private eval(n: Node): Arg {
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'ref':
        return this.cell(n.v);
      case 'range': {
        const a = parseRef(n.a)!;
        const b = parseRef(n.b)!;
        const out: Value[] = [];
        const [c1, c2] = [Math.min(a.c, b.c), Math.max(a.c, b.c)];
        const [r1, r2] = [Math.min(a.r, b.r), Math.max(a.r, b.r)];
        if ((c2 - c1 + 1) * (r2 - r1 + 1) > 50_000) throw new FormulaError('#REF!');
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(this.cell(ref(c, r)));
        return out;
      }
      case 'call': {
        if (n.name === 'IFERROR') {
          try {
            const v = this.eval(n.args[0]);
            return Array.isArray(v) ? (v[0] ?? null) : v;
          } catch (e) {
            if (e instanceof FormulaError && e.code === '#CYCLE!') throw e;
            const alt = n.args[1] ? this.eval(n.args[1]) : '';
            return Array.isArray(alt) ? (alt[0] ?? null) : alt;
          }
        }
        const fn = FNS[n.name];
        if (!fn) throw new FormulaError('#NAME?');
        if (n.name === 'IF') {
          const cond = this.scalar(n.args[0]);
          return truthy(cond) ? (n.args[1] ? this.scalar(n.args[1]) : true) : n.args[2] ? this.scalar(n.args[2]) : false;
        }
        return fn(n.args.map((a) => this.eval(a)));
      }
      case 'un': {
        const v = num(this.scalar(n.x));
        return n.op === '-' ? -v : v;
      }
      case 'bin': {
        const a = this.scalar(n.a);
        const b = this.scalar(n.b);
        switch (n.op) {
          case '+':
            return num(a) + num(b);
          case '-':
            return num(a) - num(b);
          case '*':
            return num(a) * num(b);
          case '/':
            if (num(b) === 0) throw new FormulaError('#DIV/0!');
            return num(a) / num(b);
          case '^':
            return num(a) ** num(b);
          case '&':
            return str(a) + str(b);
          default: {
            const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : typeof a === 'number' || typeof b === 'number' ? (a === null || b === null ? num(a) - num(b) : str(a).localeCompare(str(b))) : str(a).toLowerCase().localeCompare(str(b).toLowerCase());
            return n.op === '=' ? cmp === 0 : n.op === '<>' ? cmp !== 0 : n.op === '<' ? cmp < 0 : n.op === '>' ? cmp > 0 : n.op === '<=' ? cmp <= 0 : cmp >= 0;
          }
        }
      }
    }
  }

  private scalar(n: Node): Value {
    const v = this.eval(n);
    return Array.isArray(v) ? (v[0] ?? null) : v;
  }
}

export function display(v: Value, fmt?: string | null): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    switch (fmt) {
      case 'cur':
        return v.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
      case 'inr':
        return v.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
      case 'pct':
        return `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`;
      case 'num':
        return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'int':
        return Math.round(v).toLocaleString();
      default:
        return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
    }
  }
  return v;
}
