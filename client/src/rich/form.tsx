import { createContext, useContext, useEffect, useState } from 'react';
import { api, errorText } from '../api.ts';
import { Glyph } from '../components/Glyph.tsx';

export type QType = 'short' | 'long' | 'choice' | 'checkbox' | 'rating' | 'email' | 'date';
export interface Question {
  id: string;
  type: QType;
  label: string;
  options?: string[];
  required?: boolean;
}
export interface FormData {
  formId: string;
  title: string;
  desc?: string;
  questions: Question[];
  closed?: boolean;
}

const TYPES: [QType, string][] = [
  ['short', 'Short answer'],
  ['long', 'Paragraph'],
  ['choice', 'Multiple choice'],
  ['checkbox', 'Checkboxes'],
  ['rating', 'Rating 1–5'],
  ['email', 'Email'],
  ['date', 'Date'],
];

const qid = () => Math.random().toString(36).slice(2, 9);

export const newForm = (): FormData => ({
  formId: qid(),
  title: 'Quick survey',
  desc: '',
  questions: [
    { id: qid(), type: 'short', label: 'Your name', required: true },
    { id: qid(), type: 'choice', label: 'How did you hear about us?', options: ['Friend', 'Social media', 'Search'] },
    { id: qid(), type: 'rating', label: 'How likely are you to recommend us?' },
  ],
});

/** Lets read-only renderers (public pages) know which document a form belongs to. */
export const FormDocContext = createContext<{ docId: string; share: string | null } | null>(null);

export function asForm(data: Record<string, unknown>): FormData {
  return {
    formId: String(data.formId ?? 'form'),
    title: String(data.title ?? 'Form'),
    desc: String(data.desc ?? ''),
    questions: Array.isArray(data.questions) ? (data.questions as Question[]) : [],
    closed: !!data.closed,
  };
}

/** Filling in a form (anyone who can read the document or its public page). */
export function FormFill({ form, docId, share, preview = false }: { form: FormData; docId: string | null; share: string | null; preview?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const set = (id: string, v: unknown) => setAnswers((a) => ({ ...a, [id]: v }));

  if (state === 'sent')
    return (
      <div className="form-thanks">
        <span>
          <Glyph e="✅" size={40} />
        </span>
        <strong>Thanks! Your response was recorded.</strong>
        <button className="btn btn-text btn-sm" onClick={() => (setAnswers({}), setState('idle'))} type="button">
          Submit another response
        </button>
      </div>
    );

  return (
    <form
      className="form-fill"
      onSubmit={async (e) => {
        e.preventDefault();
        if (preview || !docId) return;
        const missing = form.questions.find((q) => q.required && (answers[q.id] === undefined || answers[q.id] === '' || (Array.isArray(answers[q.id]) && !(answers[q.id] as unknown[]).length)));
        if (missing) return setError(`Please answer “${missing.label}”.`);
        setState('sending');
        setError(null);
        try {
          await api(`/docs/${docId}/forms/${form.formId}/responses`, { method: 'POST', share, body: { answers } });
          setState('sent');
        } catch (err) {
          setError(errorText(err));
          setState('idle');
        }
      }}
    >
      {form.desc && <p className="form-desc">{form.desc}</p>}
      {form.questions.map((q) => (
        <fieldset key={q.id} className="form-q">
          <legend>
            {q.label}
            {q.required && <span className="req"> *</span>}
          </legend>
          {q.type === 'short' && <input className="input" value={String(answers[q.id] ?? '')} onChange={(e) => set(q.id, e.target.value)} maxLength={300} />}
          {q.type === 'email' && <input className="input" type="email" value={String(answers[q.id] ?? '')} onChange={(e) => set(q.id, e.target.value)} maxLength={200} />}
          {q.type === 'date' && <input className="input" type="date" value={String(answers[q.id] ?? '')} onChange={(e) => set(q.id, e.target.value)} />}
          {q.type === 'long' && <textarea className="input" rows={3} value={String(answers[q.id] ?? '')} onChange={(e) => set(q.id, e.target.value)} maxLength={3000} />}
          {q.type === 'choice' &&
            (q.options ?? []).map((o) => (
              <label key={o} className="check-row">
                <input type="radio" name={`${form.formId}-${q.id}`} checked={answers[q.id] === o} onChange={() => set(q.id, o)} /> {o}
              </label>
            ))}
          {q.type === 'checkbox' &&
            (q.options ?? []).map((o) => {
              const list = (answers[q.id] as string[] | undefined) ?? [];
              return (
                <label key={o} className="check-row">
                  <input type="checkbox" checked={list.includes(o)} onChange={(e) => set(q.id, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /> {o}
                </label>
              );
            })}
          {q.type === 'rating' && (
            <div className="rating" role="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={answers[q.id] === n} className={`rating-star ${Number(answers[q.id] ?? 0) >= n ? 'on' : ''}`} onClick={() => set(q.id, n)}>
                  ★
                </button>
              ))}
            </div>
          )}
        </fieldset>
      ))}
      {error && <p className="error-text small">{error}</p>}
      {form.closed ? (
        <p className="notice small">This form is no longer accepting responses.</p>
      ) : (
        <button className="btn btn-primary btn-sm" disabled={preview || !docId || state === 'sending'} type="submit" title={preview ? 'Preview: responses are collected from readers' : undefined}>
          {state === 'sending' ? 'Sending…' : 'Submit'}
        </button>
      )}
    </form>
  );
}

/** Read-only renderer hook-up (public pages and history views). */
export function StaticForm({ data }: { data: Record<string, unknown> }) {
  const ctx = useContext(FormDocContext);
  const form = asForm(data);
  return (
    <div className="form-block">
      <h3 className="form-title">{form.title}</h3>
      <FormFill form={form} docId={ctx?.docId ?? null} share={ctx?.share ?? null} preview={!ctx} />
    </div>
  );
}

/** The form block inside the editor: build it, preview it, read responses. */
export function FormEditor({ data, readOnly, docId, share, update }: { data: Record<string, unknown>; readOnly: boolean; docId: string; share: string | null; update(d: Record<string, unknown>): void }) {
  const form = asForm(data);
  const [tab, setTab] = useState<'build' | 'fill' | 'responses'>(readOnly ? 'fill' : 'build');
  const save = (f: Partial<FormData>) => update({ ...form, ...f });
  const setQ = (id: string, patch: Partial<Question>) => save({ questions: form.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) });

  return (
    <div className="form-block" data-stop>
      <div className="form-head">
        {readOnly ? (
          <h3 className="form-title">{form.title}</h3>
        ) : (
          <input className="form-title-input" value={form.title} onChange={(e) => save({ title: e.target.value })} aria-label="Form title" />
        )}
        <div className="form-tabs">
          {!readOnly && (
            <button className={tab === 'build' ? 'on' : ''} onClick={() => setTab('build')} type="button">
              Edit
            </button>
          )}
          <button className={tab === 'fill' ? 'on' : ''} onClick={() => setTab('fill')} type="button">
            {readOnly ? 'Fill in' : 'Preview / fill in'}
          </button>
          {!readOnly && (
            <button className={tab === 'responses' ? 'on' : ''} onClick={() => setTab('responses')} type="button">
              Responses
            </button>
          )}
        </div>
      </div>

      {tab === 'build' && !readOnly && (
        <div className="form-builder">
          <textarea className="input" rows={2} value={form.desc ?? ''} onChange={(e) => save({ desc: e.target.value })} placeholder="Description (optional)" />
          {form.questions.map((q, i) => (
            <div key={q.id} className="fb-q">
              <div className="fb-row">
                <span className="fb-n">{i + 1}</span>
                <input className="input" value={q.label} onChange={(e) => setQ(q.id, { label: e.target.value })} placeholder="Question" />
                <select className="input" value={q.type} onChange={(e) => setQ(q.id, { type: e.target.value as QType, options: ['choice', 'checkbox'].includes(e.target.value) ? (q.options?.length ? q.options : ['Option 1', 'Option 2']) : q.options })}>
                  {TYPES.map(([t, l]) => (
                    <option key={t} value={t}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              {(q.type === 'choice' || q.type === 'checkbox') && (
                <textarea className="input fb-options" rows={Math.max(2, (q.options ?? []).length)} value={(q.options ?? []).join('\n')} onChange={(e) => setQ(q.id, { options: e.target.value.split('\n').slice(0, 20) })} placeholder="One option per line" />
              )}
              <div className="fb-row small">
                <label className="check-row">
                  <input type="checkbox" checked={!!q.required} onChange={(e) => setQ(q.id, { required: e.target.checked })} /> Required
                </label>
                <span className="tb-flex" />
                <button className="link-btn" disabled={i === 0} onClick={() => save({ questions: form.questions.map((x, k) => (k === i - 1 ? q : k === i ? form.questions[i - 1] : x)) })} type="button" aria-label="Move up">
                  ↑
                </button>
                <button className="link-btn danger" onClick={() => save({ questions: form.questions.filter((x) => x.id !== q.id) })} type="button" aria-label="Delete question">
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div className="row-actions">
            <button className="btn btn-outline btn-sm" onClick={() => save({ questions: [...form.questions, { id: qid(), type: 'short', label: 'New question' }] })} type="button" disabled={form.questions.length >= 40}>
              + Add question
            </button>
            <label className="check-row small">
              <input type="checkbox" checked={!!form.closed} onChange={(e) => save({ closed: e.target.checked })} /> Stop accepting responses
            </label>
          </div>
        </div>
      )}
      {tab === 'fill' && <FormFill form={form} docId={docId} share={share} />}
      {tab === 'responses' && <Responses form={form} docId={docId} share={share} />}
    </div>
  );
}

function Responses({ form, docId, share }: { form: FormData; docId: string; share: string | null }) {
  const [rows, setRows] = useState<{ id: string; name: string; answers: Record<string, unknown>; createdAt: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    api<{ responses: NonNullable<typeof rows> }>(`/docs/${docId}/forms/${form.formId}/responses`, { share }).then((r) => setRows(r.responses), (e) => setError(errorText(e)));
  }, [docId, form.formId, share, n]);
  if (error) return <p className="error-text small">{error}</p>;
  if (!rows) return <p className="muted small">Loading responses…</p>;
  const csv = () => {
    const q = (s: unknown) => `"${String(Array.isArray(s) ? s.join('; ') : (s ?? '')).replace(/"/g, '""')}"`;
    const lines = [['Submitted', 'Name', ...form.questions.map((x) => x.label)].map(q).join(',')];
    for (const r of rows) lines.push([new Date(r.createdAt).toISOString(), r.name, ...form.questions.map((x) => r.answers[x.id])].map(q).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `${form.title} responses.csv`;
    a.click();
  };
  return (
    <div className="form-responses">
      <div className="row-between">
        <strong>
          {rows.length} response{rows.length === 1 ? '' : 's'}
        </strong>
        <span className="row-actions">
          <button className="btn btn-text btn-sm" onClick={() => (setRows(null), setError(null), setN(n + 1))} type="button">
            Refresh
          </button>
          <button className="btn btn-outline btn-sm" disabled={!rows.length} onClick={csv} type="button">
            Download CSV
          </button>
        </span>
      </div>
      {form.questions.map((q) => {
        const vals = rows.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== '');
        if (q.type === 'choice' || q.type === 'checkbox' || q.type === 'rating') {
          const counts = new Map<string, number>();
          const opts = q.type === 'rating' ? ['1', '2', '3', '4', '5'] : (q.options ?? []);
          for (const o of opts) counts.set(o, 0);
          for (const v of vals) for (const x of Array.isArray(v) ? v : [v]) counts.set(String(x), (counts.get(String(x)) ?? 0) + 1);
          const max = Math.max(1, ...counts.values());
          const avg = q.type === 'rating' && vals.length ? vals.reduce((s: number, v) => s + Number(v), 0) / vals.length : null;
          return (
            <div key={q.id} className="resp-q">
              <h4>
                {q.label} {avg !== null && <span className="muted small">· average {avg.toFixed(1)} ★</span>}
              </h4>
              {[...counts].map(([o, n]) => (
                <div key={o} className="resp-bar">
                  <span className="resp-label">{q.type === 'rating' ? `${o} ★` : o}</span>
                  <span className="resp-track">
                    <span style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                  <span className="resp-n">{n}</span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={q.id} className="resp-q">
            <h4>{q.label}</h4>
            {!vals.length && <p className="muted small">No answers yet.</p>}
            <ul className="resp-list">
              {vals.slice(0, 50).map((v, i) => (
                <li key={i}>{String(v)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
