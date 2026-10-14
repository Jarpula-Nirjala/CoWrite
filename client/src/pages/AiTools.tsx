import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Token } from '../../../shared/crdt.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { AppRail } from '../components/AppRail.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { SmartCreate } from '../components/SmartCreate.tsx';
import { Icon, Modal } from '../components/ui.tsx';
import { aiFile, aiText, fileToText } from '../lib/aiFiles.ts';
import { createAndOpen } from '../lib/create.ts';
import { download, exportDocx, safeFileName } from '../lib/exporters.ts';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import { Link, navigate, useSearch } from '../router.ts';

interface Tool {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  link?: string;
}

export const AI_TOOLS: Tool[] = [
  { id: 'docs-create', name: 'Docs Smart Create', desc: 'Describe a document and AI writes and formats it', icon: '📝', color: '#1a73e8' },
  { id: 'slides-create', name: 'Slides Smart Create', desc: 'Turn a topic into a designed presentation', icon: '📊', color: '#e8710a' },
  { id: 'smart-edit', name: 'Docs Smart Edit', desc: 'Tell AI how to change your text', icon: '✏️', color: '#7b1fa2' },
  { id: 'spell', name: 'AI Spell Check', desc: 'Find and fix spelling and grammar mistakes', icon: '🔤', color: '#d93025' },
  { id: 'proofread', name: 'AI Proofing', desc: 'Polish clarity, flow and punctuation', icon: '✅', color: '#188038' },
  { id: 'refine', name: 'Refine', desc: 'Make text clearer, formal, friendly, shorter or longer', icon: '💎', color: '#0b8bd8' },
  { id: 'parallel', name: 'Parallel Translate', desc: 'Original and translation side by side', icon: '🌐', color: '#00897b' },
  { id: 'doc-slides', name: 'Create Slides from Doc', desc: 'Upload a document and get a deck', icon: '🗂️', color: '#c2185b' },
  { id: 'summarize', name: 'AI Summarizer', desc: 'Key points from long text or PDFs', icon: '🧾', color: '#5e35b1' },
  { id: 'chat-pdf', name: 'Chat PDF', desc: 'Ask questions about any PDF', icon: '💬', color: '#d93025' },
  { id: 'translate-image', name: 'Translate Image', desc: 'Read and translate text in photos', icon: '🖼️', color: '#f9ab00' },
  { id: 'para-translate', name: 'Paragraph by Paragraph Translate', desc: 'Each paragraph followed by its translation', icon: '📑', color: '#3949ab' },
];

export const PRODUCTIVITY_TOOLS: Tool[] = [
  { id: 'backup', name: 'Backup Center', desc: 'Download a backup of all your documents', icon: '🛟', color: '#1a73e8' },
  { id: 'pdf-word', name: 'PDF to Word', desc: 'Convert a PDF into an editable document', icon: '📄', color: '#2b579a' },
  { id: 'img-pdf', name: 'Image to PDF', desc: 'Combine photos and scans into one PDF', icon: '🖨️', color: '#d93025' },
  { id: 'img-text', name: 'Image to Text', desc: 'Copy the text out of any picture', icon: '🔍', color: '#188038' },
  { id: 'templates', name: 'Templates', desc: 'Professional documents and decks', icon: '🎨', color: '#e8710a', link: '/templates' },
  { id: 'resume', name: 'AI Resume', desc: 'A polished resume from your details', icon: '👔', color: '#1f3a68' },
  { id: 'docs', name: 'CoWrite Docs', desc: 'All your documents in one place', icon: '📚', color: '#0b8bd8', link: '/documents' },
  { id: 'split-merge', name: 'Splitter & Merger', desc: 'Merge PDFs or split out pages', icon: '✂️', color: '#7b1fa2' },
  { id: 'academy', name: 'CoWrite Academy', desc: 'Guides and tips for every feature', icon: '🎓', color: '#00897b', link: '/#how' },
  { id: 'batch-print', name: 'Batch Print', desc: 'Print several documents at once', icon: '🖨️', color: '#5f6368' },
  { id: 'batch-rename', name: 'Batch Rename', desc: 'Rename many documents in one go', icon: '🏷️', color: '#f9ab00' },
  { id: 'extract-img', name: 'Extract Image from PDF', desc: 'Save every photo inside a PDF', icon: '🧩', color: '#c2185b' },
];

const LANGS = ['Hindi', 'Telugu', 'Tamil', 'Marathi', 'Bengali', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Korean', 'Chinese (Simplified)', 'Arabic', 'Russian'];
const same = (s: string) => Promise.resolve(s);
const toTokens = (md: string): Token[] => markdownToTokens(md).map((t, i) => ({ id: ['md', i + 1], ch: t.ch, attrs: (t.a ?? {}) as Token['attrs'] }));
const fail = (e: unknown) => (e instanceof Error && !(e as { status?: number }).status ? e.message : errorText(e));

/** WPS-style hub of AI and productivity tools. */
export function AiTools() {
  const { user, ready, aiReady, aiName } = useAuth();
  const search = useSearch();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(new URLSearchParams(search).get('tool')), [search]);
  useEffect(() => {
    document.title = 'AI Tools · CoWrite';
  }, []);
  useEffect(() => {
    if (ready && !user) navigate('/signin?next=/ai', { replace: true });
  }, [ready, user]);
  const tool = [...AI_TOOLS, ...PRODUCTIVITY_TOOLS].find((t) => t.id === open);
  const pick = (t: Tool) => (t.link ? navigate(t.link) : setOpen(t.id));

  return (
    <div className="page">
      <SiteHeader />
      <div className="rail-layout">
        <AppRail active="ai" />
        <main className="ai-tools-page">
          <header className="tools-hero">
            <div>
              <p className="kicker">AI Tools</p>
              <h1>Do more with AI</h1>
              <p className="muted">Write, edit, translate and convert, all in your browser. {aiReady ? `Powered by ${aiName}.` : ''}</p>
            </div>
            {!aiReady && user && (
              <Link className="btn btn-primary" to="/account#ai">
                <Icon name="sparkle" size={16} /> Connect free AI key
              </Link>
            )}
          </header>
          <ToolGrid title="AI Tools" tools={AI_TOOLS} onPick={pick} />
          <ToolGrid title="Productivity Tools" tools={PRODUCTIVITY_TOOLS} onPick={pick} />
        </main>
      </div>
      <SiteFooter />
      {tool && (
        <Modal title={`${tool.icon} ${tool.name}`} onClose={() => setOpen(null)} wide>
          <ToolBody id={tool.id} />
        </Modal>
      )}
    </div>
  );
}

function ToolGrid({ title, tools, onPick }: { title: string; tools: Tool[]; onPick(t: Tool): void }) {
  return (
    <section className="tool-section">
      <h2>{title}</h2>
      <div className="tool-grid">
        {tools.map((t) => (
          <button key={t.id} className="tool-card" style={{ '--tc': t.color } as CSSProperties} onClick={() => onPick(t)} type="button">
            <span className="tool-icon">{t.icon}</span>
            <span className="tool-text">
              <strong>{t.name}</strong>
              <small>{t.desc}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ToolBody({ id }: { id: string }) {
  switch (id) {
    case 'docs-create':
      return <SmartCreate initialKind="doc" compact />;
    case 'slides-create':
      return <SmartCreate initialKind="slides" compact />;
    case 'doc-slides':
      return (
        <>
          <p className="muted">Click “Upload document” (Word, PDF, Markdown or text), optionally add instructions, then Generate.</p>
          <SmartCreate initialKind="slides" compact />
        </>
      );
    case 'smart-edit':
    case 'proofread':
    case 'refine':
    case 'summarize':
    case 'spell':
    case 'parallel':
    case 'para-translate':
      return <TextTool id={id} />;
    case 'chat-pdf':
      return <ChatPdf />;
    case 'translate-image':
    case 'img-text':
    case 'pdf-word':
      return <FileTool id={id} />;
    case 'resume':
      return <ResumeTool />;
    case 'img-pdf':
      return <ImageToPdf />;
    case 'split-merge':
      return <SplitMerge />;
    case 'extract-img':
      return <ExtractImages />;
    case 'backup':
      return <Backup />;
    case 'batch-print':
    case 'batch-rename':
      return <BatchTool mode={id === 'batch-print' ? 'print' : 'rename'} />;
    default:
      return null;
  }
}

// ----------------------------------------------------------------- shared

function MarkdownResult({ md, title }: { md: string; title: string }) {
  const tokens = useMemo(() => toTokens(md), [md]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="tool-result">
      <div className="tool-result-bar">
        <button
          className="btn btn-outline btn-sm"
          onClick={() => {
            void navigator.clipboard.writeText(md).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)));
          }}
          type="button"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => void exportDocx(title, tokens, same)} type="button">
          <Icon name="download" size={14} /> Word (.docx)
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => void createAndOpen(title, 'doc', { tokens: markdownToTokens(md), settings: { theme: 'simple', font: 'sans' } })} type="button">
          Open as document
        </button>
      </div>
      <div className="tool-doc">
        <StaticDoc tokens={tokens} resolve={same} />
      </div>
    </div>
  );
}

function FilePick({ accept, label, onFile, multiple = false }: { accept: string; label: string; onFile(files: File[]): void; multiple?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop-zone ${over ? 'over' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFile([...e.dataTransfer.files]);
      }}
    >
      <Icon name="upload" size={22} />
      <span>{label}</span>
      <button className="btn btn-outline btn-sm" onClick={() => ref.current?.click()} type="button">
        Choose file{multiple ? 's' : ''}
      </button>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => (onFile([...(e.target.files ?? [])]), (e.target.value = ''))} />
    </div>
  );
}

function Busy({ children }: { children: ReactNode }) {
  return (
    <p className="tool-busy">
      <span className="sc-spin dark" /> {children}
    </p>
  );
}

// ------------------------------------------------------------- text tools

const REFINES = [
  ['refine', 'Clearer'],
  ['formal', 'More formal'],
  ['casual', 'Friendlier'],
  ['shorten', 'Shorter'],
  ['expand', 'Longer'],
] as const;

function TextTool({ id }: { id: string }) {
  const [text, setText] = useState('');
  const [lang, setLang] = useState('Hindi');
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<string>('refine');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ wrong: string; right: string; why: string }[] | null>(null);
  const [pairs, setPairs] = useState<{ source: string; translation: string }[] | null>(null);
  const translate = id === 'parallel' || id === 'para-translate';

  const load = async (f?: File) => {
    if (!f) return;
    setBusy('Reading the file…');
    setError(null);
    try {
      setText((await fileToText(f)).slice(0, 40_000));
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy('Working…');
    setError(null);
    setOut(null);
    setIssues(null);
    setPairs(null);
    try {
      if (id === 'spell') {
        const r = await aiText<{ issues: { wrong: string; right: string; why: string }[]; corrected: string }>('spell', text);
        setIssues(r.issues);
        setOut(r.corrected);
      } else if (translate) {
        setPairs((await aiText<{ pairs: { source: string; translation: string }[] }>('parallel', text, { lang })).pairs);
      } else {
        const task = id === 'refine' ? mode : id;
        setOut((await aiText(task, text, { instruction })).text);
      }
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(null);
    }
  };

  const title = AI_TOOLS.find((t) => t.id === id)?.name ?? 'Result';
  return (
    <div className="text-tool">
      <div className="text-tool-in">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Paste or type your text here…" aria-label="Text" maxLength={40_000} />
        <div className="tool-row">
          <label className="btn btn-outline btn-sm">
            <Icon name="upload" size={14} /> Upload .docx, .pdf or .txt
            <input type="file" hidden accept=".txt,.md,.docx,.pdf,.html" onChange={(e) => (void load(e.target.files?.[0]), (e.target.value = ''))} />
          </label>
          {id === 'refine' && (
            <span className="seg">
              {REFINES.map(([k, l]) => (
                <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)} type="button">
                  {l}
                </button>
              ))}
            </span>
          )}
          {translate && (
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Translate into">
              {LANGS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          )}
          {id === 'smart-edit' && <input className="tool-instr" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Turn this into a formal email with bullet points" aria-label="Instruction" />}
          <span className="muted small">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ''}</span>
          <button className="btn btn-primary" disabled={!!busy || text.trim().length < 2 || (id === 'smart-edit' && !instruction.trim())} onClick={() => void run()} type="button">
            <Icon name="sparkle" size={16} /> Run
          </button>
        </div>
      </div>
      {busy && <Busy>{busy}</Busy>}
      {error && <p className="error-text">{error}</p>}
      {issues && (
        <div className="spell-issues">
          <h4>{issues.length ? `${issues.length} suggestion${issues.length === 1 ? '' : 's'}` : 'No mistakes found 🎉'}</h4>
          <ul>
            {issues.map((i, k) => (
              <li key={k}>
                <s>{i.wrong}</s> → <b>{i.right}</b> <span className="muted small">{i.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pairs &&
        (id === 'parallel' ? (
          <table className="parallel">
            <thead>
              <tr>
                <th>Original</th>
                <th>{lang}</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, k) => (
                <tr key={k}>
                  <td>{p.source}</td>
                  <td>{p.translation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <MarkdownResult md={pairs.map((p) => `${p.source}\n> ${p.translation.replace(/\n/g, '\n> ')}`).join('\n')} title={`Translation (${lang})`} />
        ))}
      {out !== null && <MarkdownResult md={out} title={title} />}
    </div>
  );
}

// ------------------------------------------------------------- file tools

function FileTool({ id }: { id: 'translate-image' | 'img-text' | 'pdf-word' | string }) {
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState('English');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const url = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  const accept = id === 'pdf-word' ? 'application/pdf' : id === 'translate-image' ? 'image/*,application/pdf' : 'image/*';
  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setOut(await aiFile(file, id === 'pdf-word' ? 'to-word' : id === 'img-text' ? 'image-text' : 'translate-image', { lang }));
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="file-tool">
      {!file ? (
        <FilePick accept={accept} label={id === 'pdf-word' ? 'Drop a PDF here' : 'Drop an image here (photo, screenshot or scan)'} onFile={(f) => (setFile(f[0] ?? null), setOut(null))} />
      ) : (
        <div className="file-chip">
          {url ? <img src={url} alt="" /> : <span className="file-ico">📄</span>}
          <span>
            <b>{file.name}</b>
            <small className="muted">{Math.round(file.size / 1024)} KB</small>
          </span>
          {id === 'translate-image' && (
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Translate into">
              {LANGS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          )}
          <button className="btn btn-text btn-sm" onClick={() => (setFile(null), setOut(null))} type="button">
            Change
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void run()} type="button">
            <Icon name="sparkle" size={16} /> {id === 'pdf-word' ? 'Convert' : id === 'img-text' ? 'Extract text' : 'Translate'}
          </button>
        </div>
      )}
      {busy && <Busy>Reading {file?.name}…</Busy>}
      {error && <p className="error-text">{error}</p>}
      {out !== null && <MarkdownResult md={out} title={file?.name.replace(/\.[^.]+$/, '') ?? 'Converted'} />}
    </div>
  );
}

function ChatPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ask = async (question: string) => {
    if (!file || !question.trim()) return;
    setQ('');
    setError(null);
    setChat((c) => [...c, { q: question, a: null }]);
    try {
      const a = await aiFile(file, question === '__summary' ? 'summarize' : 'chat', { q: question });
      setChat((c) => c.map((m, i) => (i === c.length - 1 ? { ...m, a } : m)));
    } catch (e) {
      setError(fail(e));
      setChat((c) => c.slice(0, -1));
    }
  };
  if (!file) return <FilePick accept="application/pdf" label="Drop a PDF to start chatting with it" onFile={(f) => setFile(f[0] ?? null)} />;
  return (
    <div className="chat-pdf">
      <div className="file-chip">
        <span className="file-ico">📕</span>
        <span>
          <b>{file.name}</b>
          <small className="muted">{Math.round(file.size / 1024)} KB</small>
        </span>
        <button className="btn btn-text btn-sm" onClick={() => (setFile(null), setChat([]))} type="button">
          Change
        </button>
      </div>
      <div className="chat-log">
        {!chat.length && (
          <div className="chat-starters">
            {['__summary', 'What are the main conclusions?', 'List the key numbers and dates', 'Explain it to a beginner'].map((s) => (
              <button key={s} onClick={() => void ask(s)} type="button">
                {s === '__summary' ? 'Summarise this PDF' : s}
              </button>
            ))}
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className="chat-turn">
            <p className="chat-q">{m.q === '__summary' ? 'Summarise this PDF' : m.q}</p>
            <div className="chat-a">{m.a === null ? <Busy>Reading the PDF…</Busy> : <StaticDoc tokens={toTokens(m.a)} resolve={same} />}</div>
          </div>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      <form
        className="chat-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about this PDF…" aria-label="Question" maxLength={1000} />
        <button className="btn btn-primary" disabled={!q.trim() || chat.some((m) => m.a === null)} type="submit">
          Ask
        </button>
      </form>
    </div>
  );
}

function ResumeTool() {
  const { user } = useAuth();
  const [f, setF] = useState({ name: user?.name ?? '', role: '', contact: user?.email ?? '', experience: '', projects: '', education: '', skills: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const details = `Name: ${f.name}\nContact: ${f.contact}\nTarget role: ${f.role}\nExperience:\n${f.experience}\nProjects:\n${f.projects}\nEducation:\n${f.education}\nSkills: ${f.skills}`;
      const { text } = await aiText('resume', details, { instruction: f.role });
      await createAndOpen(`Resume – ${f.name || 'Me'}`, 'doc', { tokens: markdownToTokens(text), settings: { theme: 'elegant', margins: 'narrow', accent: '#1f3a68', font: 'garamond' } });
    } catch (e) {
      setError(fail(e));
      setBusy(false);
    }
  };
  return (
    <div className="resume-form">
      <div className="form-grid">
        <label>
          Full name
          <input value={f.name} onChange={set('name')} />
        </label>
        <label>
          Target role
          <input value={f.role} onChange={set('role')} placeholder="e.g. Frontend Developer" />
        </label>
        <label className="span2">
          Contact line
          <input value={f.contact} onChange={set('contact')} placeholder="City · email · phone · LinkedIn · GitHub" />
        </label>
        <label className="span2">
          Experience and internships
          <textarea rows={4} value={f.experience} onChange={set('experience')} placeholder="Company, role, dates, what you did and the results" />
        </label>
        <label className="span2">
          Projects
          <textarea rows={3} value={f.projects} onChange={set('projects')} placeholder="Project name, what it does, technologies, impact" />
        </label>
        <label>
          Education
          <textarea rows={2} value={f.education} onChange={set('education')} placeholder="Degree, college, years, CGPA" />
        </label>
        <label>
          Skills
          <textarea rows={2} value={f.skills} onChange={set('skills')} placeholder="TypeScript, React, SQL…" />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !f.name.trim() || (!f.experience.trim() && !f.projects.trim())} onClick={() => void run()} type="button">
        {busy ? <span className="sc-spin" /> : <Icon name="sparkle" size={16} />} {busy ? 'Writing your resume…' : 'Create my resume'}
      </button>
    </div>
  );
}

// -------------------------------------------------- local PDF utilities

const readDataUrl = (f: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(f);
  });
const imageSize = (src: string) =>
  new Promise<{ w: number; h: number }>((ok, no) => {
    const i = new Image();
    i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => no(new Error('That image could not be read.'));
    i.src = src;
  });

function ImageToPdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [fit, setFit] = useState<'a4' | 'image'>('a4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  const move = (i: number, d: number) => {
    const n = [...files];
    const [x] = n.splice(i, 1);
    n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x);
    setFiles(n);
  };
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const { jsPDF } = await import('jspdf');
      let pdf: InstanceType<typeof jsPDF> | null = null;
      for (const f of files) {
        // Re-encode through a canvas so any browser-readable image (HEIC excepted) becomes a JPEG.
        const src = await readDataUrl(f);
        const { w, h } = await imageSize(src);
        const c = document.createElement('canvas');
        const k = Math.min(1, 2400 / Math.max(w, h));
        c.width = Math.round(w * k);
        c.height = Math.round(h * k);
        const g = c.getContext('2d')!;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        const img = new Image();
        img.src = src;
        await img.decode();
        g.drawImage(img, 0, 0, c.width, c.height);
        const jpg = c.toDataURL('image/jpeg', 0.9);
        const land = w > h;
        if (fit === 'image') {
          const size: [number, number] = [w * 0.75 * k, h * 0.75 * k];
          if (!pdf) pdf = new jsPDF({ unit: 'pt', format: size, orientation: land ? 'l' : 'p' });
          else pdf.addPage(size, land ? 'l' : 'p');
          pdf.addImage(jpg, 'JPEG', 0, 0, size[0], size[1]);
        } else {
          if (!pdf) pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: land ? 'l' : 'p' });
          else pdf.addPage('a4', land ? 'l' : 'p');
          const pw = pdf.internal.pageSize.getWidth();
          const ph = pdf.internal.pageSize.getHeight();
          const s = Math.min((pw - 48) / w, (ph - 48) / h);
          pdf.addImage(jpg, 'JPEG', (pw - w * s) / 2, (ph - h * s) / 2, w * s, h * s);
        }
      }
      pdf?.save('images.pdf');
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <FilePick accept="image/*" multiple label="Drop photos, screenshots or scans" onFile={(f) => setFiles([...files, ...f.filter((x) => x.type.startsWith('image/'))])} />
      {!!files.length && (
        <>
          <div className="img-list">
            {files.map((f, i) => (
              <figure key={i}>
                <img src={urls[i]} alt="" />
                <figcaption>
                  <button onClick={() => move(i, -1)} type="button" aria-label="Move left">
                    ‹
                  </button>
                  {i + 1}
                  <button onClick={() => move(i, 1)} type="button" aria-label="Move right">
                    ›
                  </button>
                  <button onClick={() => setFiles(files.filter((_, k) => k !== i))} type="button" aria-label="Remove">
                    ×
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="tool-row">
            <span className="seg">
              <button className={fit === 'a4' ? 'on' : ''} onClick={() => setFit('a4')} type="button">
                A4 pages
              </button>
              <button className={fit === 'image' ? 'on' : ''} onClick={() => setFit('image')} type="button">
                Page = image size
              </button>
            </span>
            <button className="btn btn-primary" disabled={busy} onClick={() => void make()} type="button">
              <Icon name="download" size={16} /> {busy ? 'Building…' : `Download PDF (${files.length} page${files.length === 1 ? '' : 's'})`}
            </button>
          </div>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** "1-3, 5, 8-" → zero-based page indexes. */
function parseRanges(spec: string, total: number): number[] {
  const out: number[] = [];
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    const a = m ? Number(m[1] || 1) : Number(part);
    const b = m ? Number(m[2] || total) : a;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a) throw new Error(`“${part}” is not a valid page range.`);
    for (let p = a; p <= Math.min(b, total); p++) out.push(p - 1);
  }
  if (!out.length) throw new Error('Choose at least one page.');
  return out;
}

function SplitMerge() {
  const [tab, setTab] = useState<'merge' | 'split'>('merge');
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<number | null>(null);
  const [spec, setSpec] = useState('1-2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfs = (f: File[]) => f.filter((x) => x.type === 'application/pdf' || x.name.toLowerCase().endsWith('.pdf'));
  const save = async (bytes: Uint8Array, name: string) => download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);

  const pickSplit = async (f: File[]) => {
    const one = pdfs(f)[0];
    if (!one) return;
    setFiles([one]);
    setError(null);
    try {
      const { PDFDocument } = await import('pdf-lib');
      setPages((await PDFDocument.load(await one.arrayBuffer(), { ignoreEncryption: true })).getPageCount());
    } catch {
      setError('That PDF could not be opened.');
    }
  };

  const run = async (each = false) => {
    setBusy(true);
    setError(null);
    try {
      const { PDFDocument } = await import('pdf-lib');
      if (tab === 'merge') {
        const out = await PDFDocument.create();
        for (const f of files) {
          const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
          for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
        }
        await save(await out.save(), 'merged.pdf');
      } else {
        const src = await PDFDocument.load(await files[0].arrayBuffer(), { ignoreEncryption: true });
        const idx = parseRanges(spec, src.getPageCount());
        const base = safeFileName(files[0].name.replace(/\.pdf$/i, ''));
        if (each) {
          for (const i of idx.slice(0, 30)) {
            const out = await PDFDocument.create();
            const [p] = await out.copyPages(src, [i]);
            out.addPage(p);
            await save(await out.save(), `${base}-page-${i + 1}.pdf`);
          }
        } else {
          const out = await PDFDocument.create();
          for (const p of await out.copyPages(src, idx)) out.addPage(p);
          await save(await out.save(), `${base}-pages-${spec.replace(/\s+/g, '')}.pdf`);
        }
      }
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="seg">
        <button className={tab === 'merge' ? 'on' : ''} onClick={() => (setTab('merge'), setFiles([]), setPages(null))} type="button">
          Merge PDFs
        </button>
        <button className={tab === 'split' ? 'on' : ''} onClick={() => (setTab('split'), setFiles([]), setPages(null))} type="button">
          Split a PDF
        </button>
      </span>
      {tab === 'merge' ? (
        <>
          <FilePick accept="application/pdf" multiple label="Drop the PDFs to merge, in order" onFile={(f) => setFiles([...files, ...pdfs(f)])} />
          {!!files.length && (
            <ol className="pdf-list">
              {files.map((f, i) => (
                <li key={i}>
                  📕 {f.name}
                  <button onClick={() => setFiles(files.filter((_, k) => k !== i))} type="button" aria-label="Remove">
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
          <button className="btn btn-primary" disabled={busy || files.length < 2} onClick={() => void run()} type="button">
            <Icon name="download" size={16} /> Merge {files.length || ''} PDFs
          </button>
        </>
      ) : (
        <>
          {!files.length ? (
            <FilePick accept="application/pdf" label="Drop a PDF to split" onFile={(f) => void pickSplit(f)} />
          ) : (
            <div className="file-chip">
              <span className="file-ico">📕</span>
              <span>
                <b>{files[0].name}</b>
                <small className="muted">{pages ?? '…'} pages</small>
              </span>
              <label>
                Pages <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="1-3, 5, 8-" aria-label="Pages" style={{ width: 110 }} />
              </label>
              <button className="btn btn-outline" disabled={busy} onClick={() => void run(true)} type="button">
                Each page separately
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void run()} type="button">
                <Icon name="download" size={16} /> Extract pages
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function ExtractImages() {
  const [imgs, setImgs] = useState<{ url: string; name: string }[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const { PDFDocument, PDFRawStream, PDFName, PDFNumber, decodePDFRawStream } = await import('pdf-lib');
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const out: { url: string; name: string }[] = [];
      let skip = 0;
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
        const filter = String(obj.dict.get(PDFName.of('Filter')) ?? '');
        const n = out.length + 1;
        if (filter.includes('DCTDecode')) {
          out.push({ url: URL.createObjectURL(new Blob([obj.contents as BlobPart], { type: 'image/jpeg' })), name: `image-${n}.jpg` });
          continue;
        }
        // Flate-compressed RGB or greyscale images: rebuild the pixels as a PNG.
        const num = (k: string, d: number) => {
          const v = obj.dict.get(PDFName.of(k));
          return v instanceof PDFNumber ? v.asNumber() : d;
        };
        const w = num('Width', 0);
        const h = num('Height', 0);
        const bpc = num('BitsPerComponent', 8);
        const cs = String(obj.dict.get(PDFName.of('ColorSpace')) ?? '');
        const comps = cs === '/DeviceRGB' ? 3 : cs === '/DeviceGray' ? 1 : 0;
        if (!filter.includes('FlateDecode') || !comps || bpc !== 8 || w * h < 400 || w * h > 25_000_000) {
          skip++;
          continue;
        }
        try {
          const px = decodePDFRawStream(obj).decode();
          if (px.length < w * h * comps) throw new Error('short');
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d')!;
          const data = g.createImageData(w, h);
          for (let i = 0; i < w * h; i++) {
            data.data[i * 4] = px[i * comps];
            data.data[i * 4 + 1] = px[i * comps + (comps === 3 ? 1 : 0)];
            data.data[i * 4 + 2] = px[i * comps + (comps === 3 ? 2 : 0)];
            data.data[i * 4 + 3] = 255;
          }
          g.putImageData(data, 0, 0);
          const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
          if (blob) out.push({ url: URL.createObjectURL(blob), name: `image-${n}.png` });
        } catch {
          skip++;
        }
      }
      setImgs(out);
      setSkipped(skip);
    } catch {
      setError('That PDF could not be opened.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <FilePick accept="application/pdf" label="Drop a PDF to pull out its images" onFile={(f) => void run(f[0])} />
      {busy && <Busy>Looking for images…</Busy>}
      {error && <p className="error-text">{error}</p>}
      {imgs && (
        <>
          <p className="muted">
            Found {imgs.length} image{imgs.length === 1 ? '' : 's'}
            {skipped ? ` (${skipped} in formats we cannot rebuild, such as masks or CMYK, were skipped)` : ''}.
          </p>
          <div className="img-list">
            {imgs.map((m) => (
              <figure key={m.url}>
                <img src={m.url} alt="" />
                <figcaption>
                  <a href={m.url} download={m.name}>
                    <Icon name="download" size={14} /> {m.name}
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------- your documents

interface BackupDoc {
  id: string;
  title: string;
  kind: string;
  updatedAt: number;
  encrypted: boolean;
  text: string;
}

function Backup() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (fmt: 'md' | 'json') => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ exportedAt: number; documents: BackupDoc[] }>('/me/backup');
      const stamp = new Date().toISOString().slice(0, 10);
      if (fmt === 'json') download(new Blob([JSON.stringify(r, null, 1)], { type: 'application/json' }), `cowrite-backup-${stamp}.json`);
      else {
        const md = r.documents
          .map((d) => `# ${d.title}\n\n*${d.kind} · last edited ${new Date(d.updatedAt).toLocaleString()} · ${location.origin}/d/${d.id}*\n\n${d.encrypted ? '_End-to-end encrypted: open it in CoWrite to read it._' : d.text}`)
          .join('\n\n---\n\n');
        download(new Blob([md], { type: 'text/markdown' }), `cowrite-backup-${stamp}.md`);
      }
      setDone(`Backed up ${r.documents.length} documents.`);
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="backup">
      <p>Your documents are saved continuously on the CoWrite server, with full version history. Download your own copy whenever you like:</p>
      <div className="tool-row">
        <button className="btn btn-primary" disabled={busy} onClick={() => void run('md')} type="button">
          <Icon name="download" size={16} /> Everything as Markdown
        </button>
        <button className="btn btn-outline" disabled={busy} onClick={() => void run('json')} type="button">
          <Icon name="download" size={16} /> Everything as JSON
        </button>
      </div>
      <p className="muted small">Documents you marked “Available offline” are also kept in this browser. Restore an older version any time from History inside a document.</p>
      {done && <p className="ok-text">✓ {done}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function BatchTool({ mode }: { mode: 'print' | 'rename' }) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pattern, setPattern] = useState('{title}');
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ documents: DocMeta[] }>('/docs').then((r) => setDocs(r.documents), (e) => setError(errorText(e)));
  }, []);
  const chosen = (docs ?? []).filter((d) => sel.has(d.id));
  const newName = (d: DocMeta, i: number) =>
    pattern
      .replace(/\{title\}/g, find ? d.title.split(find).join(repl) : d.title)
      .replace(/\{n\}/g, String(i + 1))
      .replace(/\{date\}/g, new Date().toISOString().slice(0, 10))
      .trim() || d.title;
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  };

  const print = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ documents: BackupDoc[] }>(`/me/backup?ids=${chosen.map((d) => d.id).join(',')}`);
      const w = window.open('', '_blank');
      if (!w) throw new Error('Allow pop-ups for CoWrite to print.');
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      w.document.write(
        `<!doctype html><title>Batch print</title><style>body{font:12pt 'Times New Roman',serif;margin:0}section{padding:20mm;page-break-after:always}h1{font-size:20pt;color:#1f3a68}pre{white-space:pre-wrap;font:inherit}</style>${r.documents
          .map((d) => `<section><h1>${esc(d.title)}</h1><pre>${esc(d.encrypted ? 'End-to-end encrypted: open it in CoWrite to print it.' : d.text)}</pre></section>`)
          .join('')}<script>onload=()=>print()</script>`,
      );
      w.document.close();
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    setBusy(true);
    setError(null);
    let ok = 0;
    const failed: string[] = [];
    for (const [i, d] of chosen.entries()) {
      try {
        await api(`/docs/${d.id}`, { method: 'PATCH', body: { title: newName(d, i) } });
        ok++;
      } catch {
        failed.push(d.title);
      }
    }
    setMsg(`Renamed ${ok} document${ok === 1 ? '' : 's'}.${failed.length ? ` Only the owner can rename: skipped ${failed.join(', ')}.` : ''}`);
    setDocs((await api<{ documents: DocMeta[] }>('/docs')).documents);
    setSel(new Set());
    setBusy(false);
  };

  return (
    <div className="batch">
      {mode === 'rename' && (
        <div className="tool-row">
          <label>
            New name <input value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Name pattern" />
          </label>
          <label>
            Find <input value={find} onChange={(e) => setFind(e.target.value)} style={{ width: 110 }} />
          </label>
          <label>
            Replace with <input value={repl} onChange={(e) => setRepl(e.target.value)} style={{ width: 110 }} />
          </label>
          <span className="muted small">Use {'{title}'}, {'{n}'} and {'{date}'}</span>
        </div>
      )}
      {!docs ? (
        <Busy>Loading your documents…</Busy>
      ) : (
        <ul className="batch-list">
          <li className="batch-all">
            <label>
              <input type="checkbox" checked={sel.size === docs.length && docs.length > 0} onChange={(e) => setSel(new Set(e.target.checked ? docs.map((d) => d.id) : []))} /> Select all ({docs.length})
            </label>
          </li>
          {docs.map((d) => {
            const i = chosen.findIndex((c) => c.id === d.id);
            return (
              <li key={d.id}>
                <label>
                  <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} /> {d.title}
                  {mode === 'rename' && i >= 0 && <span className="rename-to">→ {newName(d, i)}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error-text">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => void (mode === 'print' ? print() : rename())} type="button">
        {mode === 'print' ? `🖨️ Print ${chosen.length || ''} documents` : `🏷️ Rename ${chosen.length || ''} documents`}
      </button>
    </div>
  );
}
