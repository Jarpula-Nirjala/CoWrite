import { useEffect, useMemo, useRef, useState } from 'react';
import * as ic from '@mdi/js';
import type { Token } from '../../../shared/crdt.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText, timeAgo, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Glyph } from '../components/Glyph.tsx';
import { FileTypeIcon, MIcon } from '../components/MIcon.tsx';
import { KIND_PRODUCT, ProductIcon } from '../components/ProductIcon.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Spinner } from '../components/ui.tsx';
import { useSpeech } from '../editor/speech.ts';
import { createAndOpen } from '../lib/create.ts';
import { deleteFiles, getFile } from '../lib/fileStore.ts';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import { Link, navigate } from '../router.ts';

/**
 * A file attached to a message. Its contents are stored with the person's account on the server (see
 * server/routes-assistant.ts) and referenced by id, so they follow the person to any browser or computer.
 */
interface Att {
  /** Server id of the stored file; missing only for files that could not be kept. */
  id?: string;
  name: string;
  mime: string;
  size: number;
  /** A small preview for images. */
  thumb?: string;
}
interface Msg {
  role: 'user' | 'assistant';
  text: string;
  files?: Att[];
}
interface Chat {
  id: string;
  title: string;
  at: number;
  messages: Msg[];
  /** False while only the title is known (the messages load when the chat is opened). */
  loaded: boolean;
}

/** Where chats used to live, in this browser only; anything found there is moved to the account once. */
const OLD_STORE = 'cowrite:assistant';
const MAX_FILE = 15_000_000;
const same = (s: string) => Promise.resolve(s);
const toTokens = (md: string): Token[] => markdownToTokens(md).map((t, i) => ({ id: ['as', i + 1], ch: t.ch, attrs: (t.a ?? {}) as Token['attrs'] }));
const SUGGESTIONS = [
  ['✉️', 'Write an email', 'Write a polite email to my manager asking for two days of leave next week.'],
  ['🧠', 'Explain a concept', 'Explain how a CRDT works to a first-year student, with an example.'],
  ['🗺️', 'Plan a trip', 'Plan a 3-day budget trip to Goa for four friends in December.'],
  ['💡', 'Brainstorm ideas', 'Give me 10 ideas for a final-year computer science project.'],
] as const;
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sql,.css,.sh,image/png,image/jpeg,image/webp,image/gif';
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Saves to the same chat run one after another, so an older save can never land after a newer one. */
const saving = new Map<string, Promise<unknown>>();
/** Saves a whole chat to the account. */
function saveChat(c: Pick<Chat, 'id' | 'title' | 'at' | 'messages'>) {
  const next = (saving.get(c.id) ?? Promise.resolve()).catch(() => {}).then(() => putChat(c));
  saving.set(c.id, next);
  return next;
}
function putChat(c: Pick<Chat, 'id' | 'title' | 'at' | 'messages'>) {
  return api(`/assistant/chats/${c.id}`, {
    method: 'PUT',
    body: { title: c.title, at: c.at, messages: c.messages.map(({ role, text, files }) => ({ role, text, ...(files?.length ? { files: files.map(({ id, name, mime, size, thumb }) => ({ id, name, mime, size, thumb })) } : {}) })) },
  });
}

/** Stores one attachment with the account and returns its id. `asText` bodies are UTF-8 text extracted from the file. */
async function uploadFile(body: Blob, name: string, mime: string, asText: boolean): Promise<string> {
  const res = await fetch('/api/assistant/files', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': asText ? 'text/plain; charset=utf-8' : mime, 'x-file-name': encodeURIComponent(name), ...(asText ? { 'x-file-kind': 'text', 'x-original-type': mime || 'text/plain' } : {}) },
    body,
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !j.id) throw new Error(j.error ?? `Could not save ${name} (${res.status}).`);
  return j.id;
}
// An empty document or file is still worth attaching; say so rather than sending nothing.
const uploadText = (text: string, name: string, mime: string) => uploadFile(new Blob([text.trim() ? text : '(this file is empty)'], { type: 'text/plain' }), name, mime, true);
const fromBase64 = (b64: string, mime: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime });

const readAs = (f: Blob, how: 'dataUrl' | 'text') =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    if (how === 'dataUrl') r.readAsDataURL(f);
    else r.readAsText(f);
  });

/** A small JPEG preview of an image for the chat thread. */
async function thumbnail(src: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, 240 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

/** Reads a picked file and stores it with the account: images and PDFs as they are, everything else as text. */
async function toAttachment(f: File): Promise<Att> {
  if (f.size > MAX_FILE) throw new Error(`${f.name} is larger than 15 MB.`);
  const name = f.name || 'pasted-image.png';
  const lower = name.toLowerCase();
  if (/^image\/(png|jpeg|webp|gif)$/.test(f.type) || f.type === 'application/pdf' || lower.endsWith('.pdf')) {
    const mime = f.type || 'application/pdf';
    let thumb: string | undefined;
    if (mime.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      thumb = await thumbnail(url).catch(() => undefined);
      URL.revokeObjectURL(url);
    }
    return { id: await uploadFile(f, name, mime, false), name, mime, size: f.size, thumb };
  }
  let text: string;
  let mime = f.type || 'text/plain';
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
  } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const doc = new DOMParser().parseFromString(await readAs(f, 'text'), 'text/html');
    text = doc.body.innerText || doc.body.textContent || '';
    mime = 'text/html';
  } else if (/\.(doc|ppt|pptx|xls|xlsx|zip|exe)$/i.test(lower)) {
    throw new Error(`${name}: upload PDFs, Word (.docx), images or text and code files.`);
  } else text = await readAs(f, 'text');
  return { id: await uploadText(text, name, mime), name, mime, size: f.size };
}

/**
 * Chats from before they were kept with the account lived in this browser (localStorage, file contents in
 * IndexedDB). Moves them to the account, files included, then clears the old copies. A chat that fails to
 * move stays where it was and is tried again next time.
 */
async function moveLocalChats(): Promise<number> {
  let old: { id: string; title: string; at: number; messages: (Msg & { files?: (Att & { text?: string; data?: string })[] })[] }[];
  try {
    old = JSON.parse(localStorage.getItem(OLD_STORE) ?? '[]');
  } catch {
    old = [];
  }
  if (!old.length) return 0;
  const left: typeof old = [];
  const idbIds: string[] = [];
  for (const c of old) {
    try {
      const messages: Msg[] = [];
      for (const m of c.messages) {
        const files: Att[] = [];
        for (const f of m.files ?? []) {
          if (f.id) idbIds.push(f.id);
          const kept = f.id ? await getFile(f.id) : undefined;
          const text = f.text ?? kept?.text;
          const data = f.data ?? kept?.data;
          let id: string | undefined;
          if (text !== undefined) id = await uploadText(text, f.name, f.mime);
          else if (data) id = await uploadFile(fromBase64(data, f.mime), f.name, f.mime, false);
          // An image whose original was never kept still has its preview: keep that rather than nothing.
          else if (f.thumb) id = await uploadFile(await (await fetch(f.thumb)).blob(), f.name, 'image/jpeg', false);
          files.push({ ...(id ? { id } : {}), name: f.name, mime: id && !text && !data && f.thumb ? 'image/jpeg' : f.mime, size: f.size, thumb: f.thumb });
        }
        messages.push({ role: m.role, text: m.text, ...(files.length ? { files } : {}) });
      }
      await saveChat({ id: c.id.length >= 6 ? c.id : `${c.id}-old`, title: c.title, at: c.at, messages });
    } catch {
      left.push(c);
    }
  }
  try {
    if (left.length) localStorage.setItem(OLD_STORE, JSON.stringify(left));
    else localStorage.removeItem(OLD_STORE);
  } catch {
    // nothing to do
  }
  if (!left.length) void deleteFiles(idbIds);
  return old.length - left.length;
}

const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const plain = (md: string) => md.replace(/```[\s\S]*?```/g, ' code ').replace(/[#*_`>|~-]+/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/** A Gemini- and ChatGPT-style assistant, using the person's own AI key or the site's. */
export function Assistant() {
  const { user, ready, aiReady, aiName } = useAuth();
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<Att[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [plus, setPlus] = useState(false);
  const [picker, setPicker] = useState(false);
  const [drag, setDrag] = useState(false);
  const [find, setFind] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const chat = chats?.find((c) => c.id === cur) ?? null;
  const voice = useSpeech((t) => setInput((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}${t}`));

  useEffect(() => {
    document.title = `${aiName === 'AI' ? 'Assistant' : aiName} · CoWrite`;
  }, [aiName]);
  useEffect(() => {
    if (ready && !user) navigate('/signin?next=/assistant', { replace: true });
  }, [ready, user]);
  // The chat list comes from the account (after moving any chats left in this browser).
  useEffect(() => {
    if (!user) return;
    let live = true;
    void (async () => {
      await moveLocalChats().catch(() => 0);
      const r = await api<{ chats: { id: string; title: string; at: number }[] }>('/assistant/chats');
      if (live) setChats(r.chats.map((c) => ({ ...c, messages: [], loaded: false })));
    })().catch((e) => live && (setChats([]), setError(errorText(e))));
    return () => {
      live = false;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect must not return one.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [cur, chat?.loaded, chat?.messages.length, chat?.messages.at(-1)?.text.length]);
  // The message box grows with its text, like Gemini's and ChatGPT's.
  useEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  }, [input]);
  // A copy button on every code block in the answers.
  useEffect(() => {
    thread.current?.querySelectorAll('.as-bubble pre').forEach((pre) => {
      if (pre.querySelector('.as-codecopy')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'as-codecopy';
      b.textContent = 'Copy code';
      b.onclick = () => {
        void navigator.clipboard.writeText((pre.textContent ?? '').replace(/Copy code$|Copied$/, ''));
        b.textContent = 'Copied';
        setTimeout(() => (b.textContent = 'Copy code'), 1500);
      };
      pre.appendChild(b);
    });
  });
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const update = (id: string, f: (c: Chat) => Chat) => setChats((all) => (all ?? []).map((c) => (c.id === id ? f(c) : c)));

  /** Opens a chat, loading its messages from the account the first time. */
  const open = async (id: string) => {
    setCur(id);
    setEditing(null);
    const c = chats?.find((x) => x.id === id);
    if (!c || c.loaded) return;
    try {
      const r = await api<{ chat: { id: string; title: string; at: number; messages: Msg[] } }>(`/assistant/chats/${encodeURIComponent(id)}`);
      update(id, (x) => ({ ...x, ...r.chat, loaded: true }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const attach = async (list: FileList | File[] | null) => {
    // Copy the files out now: a FileList is live and empties when its input is reset.
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    setError(null);
    setReading((n) => n + picked.length);
    for (const f of picked) {
      try {
        const a = await toAttachment(f);
        setFiles((fs) => [...fs, a].slice(0, 10));
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not read ${f.name}.`);
      } finally {
        setReading((n) => n - 1);
      }
    }
  };

  const attachDoc = async (d: DocMeta) => {
    setPicker(false);
    setReading((n) => n + 1);
    try {
      const r = await api<{ documents: { title: string; text: string; encrypted: boolean }[] }>(`/me/backup?ids=${encodeURIComponent(d.id)}`);
      const doc = r.documents[0];
      if (!doc) throw new Error('That document could not be read.');
      if (doc.encrypted) throw new Error('Encrypted documents cannot be sent to the AI.');
      const name = `${doc.title || 'Untitled'} (CoWrite)`;
      const id = await uploadText(doc.text, name, 'text/plain');
      setFiles((fs) => [...fs, { id, name, mime: 'text/plain', size: doc.text.length }].slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach that document.');
    } finally {
      setReading((n) => n - 1);
    }
  };

  const stop = () => abort.current?.abort();

  /** Asks the AI; `upto` replaces the conversation from that message on (for edit and regenerate). */
  const ask = async (text: string, attached: Att[], upto?: number) => {
    const q = text.trim();
    if ((!q && !attached.length) || busy) return;
    if (voice.listening) voice.stop();
    setError(null);
    let id = cur;
    let history: Msg[] = (chat?.messages ?? []).slice(0, upto ?? undefined);
    let title = chat?.title ?? '';
    if (!id) {
      id = newId();
      title = (q || attached[0]?.name || 'New chat').slice(0, 60);
      const fresh: Chat = { id, title, at: Date.now(), messages: [], loaded: true };
      setChats((all) => [fresh, ...(all ?? [])]);
      setCur(id);
      history = [];
    }
    const messages: Msg[] = [...history, { role: 'user', text: q || 'Please look at the attached file.', ...(attached.length ? { files: attached } : {}) }];
    const at = Date.now();
    update(id, (c) => ({ ...c, at, messages: [...messages, { role: 'assistant', text: '' }] }));
    // The question is saved straight away, so it is not lost if the page closes mid-answer.
    void saveChat({ id, title, at, messages }).catch(() => {});
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let answer = '';
    let final: Msg[] = messages;
    try {
      // Files go by id; the server reads them from the account.
      const wire = messages.map((m) => ({ role: m.role, text: m.text, files: m.files?.map((f) => (f.id ? { id: f.id, name: f.name, mime: f.mime } : { name: f.name, mime: 'text/plain', text: '(this file could not be kept; ask the person to attach it again)' })) }));
      const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: wire }), credentials: 'same-origin', signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? (res.status === 413 ? 'Those files are too large to send together.' : `Request failed (${res.status}).`));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += dec.decode(value, { stream: true });
        const a = answer;
        update(id, (c) => ({ ...c, messages: [...messages, { role: 'assistant', text: a }] }));
      }
      final = [...messages, { role: 'assistant', text: answer }];
    } catch (e) {
      if (ctrl.signal.aborted) {
        // Stopped by the person: keep whatever had arrived.
        final = answer ? [...messages, { role: 'assistant', text: answer }] : messages;
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
      update(id, (c) => ({ ...c, messages: final }));
    } finally {
      abort.current = null;
      setBusy(false);
      void saveChat({ id, title, at, messages: final }).catch((e) => setError(`Could not save this chat: ${errorText(e)}`));
    }
  };

  const send = () => {
    const t = input;
    const f = files;
    setInput('');
    setFiles([]);
    setEditing(null);
    void ask(t, f, editing ?? undefined);
  };
  const regenerate = (i: number) => {
    const u = chat?.messages[i - 1];
    if (u?.role === 'user') void ask(u.text, u.files ?? [], i - 1);
  };
  const edit = (i: number) => {
    const m = chat?.messages[i];
    if (!m) return;
    setEditing(i);
    setInput(m.text);
    setFiles(m.files ?? []);
    box.current?.focus();
  };
  const speak = (i: number, text: string) => {
    const s = window.speechSynthesis;
    if (!s) return setError('Read aloud is not supported in this browser.');
    s.cancel();
    if (speaking === i) return setSpeaking(null);
    const u = new SpeechSynthesisUtterance(plain(text));
    u.onend = () => setSpeaking(null);
    setSpeaking(i);
    s.speak(u);
  };

  const remove = (id: string) => {
    setChats((all) => (all ?? []).filter((c) => c.id !== id));
    if (cur === id) setCur(null);
    void api(`/assistant/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch((e) => setError(errorText(e)));
  };
  const rename = async (id: string, title: string) => {
    setRenaming(null);
    const t = title.trim().slice(0, 80);
    if (!t) return;
    update(id, (c) => ({ ...c, title: t }));
    try {
      let c = chats?.find((x) => x.id === id);
      if (c && !c.loaded) c = { ...c, ...(await api<{ chat: Chat }>(`/assistant/chats/${encodeURIComponent(id)}`)).chat, loaded: true };
      if (c) await saveChat({ ...c, title: t });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const exportChat = () => {
    if (!chat) return;
    const md = [`# ${chat.title}`, ...chat.messages.map((m) => `**${m.role === 'user' ? (user?.name ?? 'You') : aiName}:**${m.files?.length ? ` _(attached: ${m.files.map((f) => f.name).join(', ')})_` : ''}\n\n${m.text}`)].join('\n\n---\n\n');
    void createAndOpen(chat.title, 'doc', { tokens: markdownToTokens(md), settings: { theme: 'simple', font: 'sans' } });
  };
  const newChat = () => {
    stop();
    setCur(null);
    setEditing(null);
    setFiles([]);
    setInput('');
  };

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    const all = chats ?? [];
    return q ? all.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.text.toLowerCase().includes(q))) : all;
  }, [chats, find]);
  const canSend = aiReady && !busy && !reading && (!!input.trim() || files.length > 0);

  return (
    <div className="page assistant-page">
      <SiteHeader />
      <div className="assistant">
        <aside className="as-side">
          <button className="btn btn-outline as-new" onClick={newChat} type="button">
            <MIcon path={ic.mdiPencilBoxOutline} size={18} /> New chat
          </button>
          <label className="as-find">
            <MIcon path={ic.mdiMagnify} size={18} />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
          </label>
          <p className="side-h">Recent</p>
          <ul>
            {shown.map((c) => (
              <li key={c.id} className={c.id === cur ? 'on' : ''}>
                {renaming === c.id ? (
                  <input className="as-rename" defaultValue={c.title} autoFocus aria-label="Chat name" onBlur={(e) => void rename(c.id, e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? void rename(c.id, e.currentTarget.value) : e.key === 'Escape' ? setRenaming(null) : undefined)} />
                ) : (
                  <button onClick={() => void open(c.id)} onDoubleClick={() => setRenaming(c.id)} title={`${c.title} · ${timeAgo(c.at)}`} type="button">
                    <MIcon path={ic.mdiMessageTextOutline} size={16} /> <span>{c.title}</span>
                  </button>
                )}
                <span className="as-li-actions">
                  <button onClick={() => setRenaming(c.id)} aria-label="Rename chat" title="Rename" type="button">
                    <MIcon path={ic.mdiPencilOutline} size={16} />
                  </button>
                  <button onClick={() => remove(c.id)} aria-label="Delete chat" title="Delete" type="button">
                    <MIcon path={ic.mdiDeleteOutline} size={16} />
                  </button>
                </span>
              </li>
            ))}
            {!chats ? (
              <li className="muted small as-none">Loading your chats…</li>
            ) : (
              !shown.length && <li className="muted small as-none">{find ? 'No chats match.' : 'Your chats appear here.'}</li>
            )}
          </ul>
          <p className="muted small">Chats and their files are saved to your account, on every device you sign in on.</p>
        </aside>
        <main
          className={`as-main ${drag ? 'dragging' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) (e.preventDefault(), setDrag(true));
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void attach(e.dataTransfer.files);
          }}
        >
          {drag && (
            <div className="as-drop">
              <MIcon path={ic.mdiFileUploadOutline} size={40} />
              <b>Drop files to add them to your message</b>
              <span>PDF, Word, images, text and code files</span>
            </div>
          )}
          {chat && (
            <div className="as-chatbar">
              <b title={chat.title}>{chat.title}</b>
              <span>
                <button className="as-icbtn" onClick={exportChat} title="Save the whole chat as a document" aria-label="Save chat as document" type="button">
                  <MIcon path={ic.mdiFileDocumentArrowRightOutline} size={20} />
                </button>
                <button className="as-icbtn" onClick={() => void navigator.clipboard.writeText(chat.messages.map((m) => `${m.role === 'user' ? 'You' : aiName}: ${m.text}`).join('\n\n'))} title="Copy the whole chat" aria-label="Copy chat" type="button">
                  <MIcon path={ic.mdiContentCopy} size={20} />
                </button>
                <button className="as-icbtn" onClick={() => remove(chat.id)} title="Delete chat" aria-label="Delete this chat" type="button">
                  <MIcon path={ic.mdiDeleteOutline} size={20} />
                </button>
              </span>
            </div>
          )}
          <div className="as-scroll">
            {!chat ? (
              <div className="as-welcome">
                <h1>
                  <span className="as-grad">Hello, {user?.name.split(' ')[0] ?? 'there'}</span>
                  <br />
                  How can I help you today?
                </h1>
                <div className="as-cards">
                  {SUGGESTIONS.map(([icon, label, q]) => (
                    <button key={label} onClick={() => void ask(q, [])} disabled={!aiReady} type="button">
                      <span>{q}</span>
                      <b>
                        <Glyph e={icon} size={16} /> {label}
                      </b>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="as-thread" ref={thread}>
                {!chat.loaded && <Spinner />}
                {chat.messages.map((m, i) => {
                  const last = i === chat.messages.length - 1;
                  return (
                    <div key={i} className={`as-msg ${m.role} ${editing === i ? 'editing' : ''}`}>
                      {m.role === 'assistant' && (
                        <span className="as-avatar">
                          <ProductIcon id="assistant" size={22} />
                        </span>
                      )}
                      <div className="as-col">
                        {!!m.files?.length && (
                          <div className="as-files">
                            {m.files.map((f, k) =>
                              f.thumb ? (
                                <img key={k} className="as-thumb" src={f.thumb} alt={f.name} title={f.name} />
                              ) : (
                                <span key={k} className="as-filechip">
                                  <FileTypeIcon mime={f.mime} name={f.name} size={22} />
                                  <span>
                                    <b>{f.name}</b>
                                    <small>{f.mime === 'application/pdf' ? 'PDF' : f.name.endsWith('(CoWrite)') ? 'CoWrite document' : /\.\w{1,5}$/.test(f.name) ? f.name.split('.').pop()!.toUpperCase() : 'File'}</small>
                                  </span>
                                </span>
                              ),
                            )}
                          </div>
                        )}
                        <div className="as-bubble">
                          {m.role === 'user' ? m.text : m.text ? <StaticDoc tokens={toTokens(m.text)} resolve={same} /> : <span className="as-typing"><i /><i /><i /></span>}
                        </div>
                        {m.role === 'user' && !busy && (
                          <span className="as-actions as-user-actions">
                            <button onClick={() => edit(i)} title="Edit message" aria-label="Edit message" type="button">
                              <MIcon path={ic.mdiPencilOutline} size={16} />
                            </button>
                            <button onClick={() => void navigator.clipboard.writeText(m.text)} title="Copy" aria-label="Copy message" type="button">
                              <MIcon path={ic.mdiContentCopy} size={16} />
                            </button>
                          </span>
                        )}
                        {m.role === 'assistant' && m.text && !(busy && last) && (
                          <span className="as-actions">
                            <button onClick={() => void navigator.clipboard.writeText(m.text)} title="Copy" aria-label="Copy answer" type="button">
                              <MIcon path={ic.mdiContentCopy} size={18} />
                            </button>
                            <button onClick={() => regenerate(i)} disabled={busy} title="Regenerate" aria-label="Regenerate answer" type="button">
                              <MIcon path={ic.mdiRefresh} size={18} />
                            </button>
                            <button onClick={() => speak(i, m.text)} title={speaking === i ? 'Stop reading' : 'Read aloud'} aria-label={speaking === i ? 'Stop reading' : 'Read aloud'} type="button">
                              <MIcon path={speaking === i ? ic.mdiStopCircleOutline : ic.mdiVolumeHigh} size={18} />
                            </button>
                            <button onClick={() => void createAndOpen(chat.messages[i - 1]?.text.slice(0, 60) || 'From the assistant', 'doc', { tokens: markdownToTokens(m.text), settings: { theme: 'simple', font: 'sans' } })} title="Save as document" aria-label="Save as document" type="button">
                              <MIcon path={ic.mdiFileDocumentPlusOutline} size={18} /> <span>Save as document</span>
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={end} />
              </div>
            )}
          </div>
          {error && (
            <p className="error-text as-error" onClick={() => setError(null)}>
              {error}
            </p>
          )}
          {voice.error && <p className="error-text as-error">{voice.error}</p>}
          <form
            className="as-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend) send();
            }}
          >
            {editing !== null && (
              <div className="as-editing">
                <MIcon path={ic.mdiPencilOutline} size={16} /> Editing your message; sending replaces the conversation from there.
                <button onClick={() => (setEditing(null), setInput(''), setFiles([]))} type="button">
                  Cancel
                </button>
              </div>
            )}
            {(files.length > 0 || reading > 0) && (
              <div className="as-files as-pending">
                {files.map((f, k) => (
                  <span key={k} className={`as-filechip ${f.thumb ? 'img' : ''}`}>
                    {f.thumb ? <img src={f.thumb} alt="" /> : <FileTypeIcon mime={f.mime} name={f.name} size={22} />}
                    <span>
                      <b>{f.name}</b>
                      <small>{kb(f.size)}</small>
                    </span>
                    <button onClick={() => setFiles(files.filter((_, j) => j !== k))} aria-label={`Remove ${f.name}`} title="Remove" type="button">
                      <MIcon path={ic.mdiClose} size={14} />
                    </button>
                  </span>
                ))}
                {reading > 0 && <span className="as-filechip muted">Reading {reading} file{reading > 1 ? 's' : ''}…</span>}
              </div>
            )}
            <div className="as-row">
              <span className="as-plus">
                <button className="as-icbtn" onClick={() => setPlus(!plus)} disabled={!aiReady} aria-label="Add files and more" title="Add files and more" type="button">
                  <MIcon path={ic.mdiPlus} size={22} />
                </button>
                {plus && (
                  <div className="as-menu" role="menu" onMouseLeave={() => setPlus(false)}>
                    <button role="menuitem" onClick={() => (setPlus(false), fileInput.current?.click())} type="button">
                      <MIcon path={ic.mdiPaperclip} size={20} /> Upload files
                      <small>PDF, Word, images, text, code</small>
                    </button>
                    <button role="menuitem" onClick={() => (setPlus(false), setPicker(true))} type="button">
                      <ProductIcon id="docs" size={20} /> Add from CoWrite
                      <small>Your documents</small>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setPlus(false);
                        const i = document.createElement('input');
                        i.type = 'file';
                        i.accept = 'image/*';
                        i.capture = 'environment';
                        i.onchange = () => void attach(i.files);
                        i.click();
                      }}
                      type="button"
                    >
                      <MIcon path={ic.mdiCameraOutline} size={20} /> Take a photo
                      <small>On phones and tablets</small>
                    </button>
                  </div>
                )}
              </span>
              <textarea
                ref={box}
                value={voice.listening && voice.interim ? `${input}${input ? ' ' : ''}${voice.interim}` : input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const pasted = Array.from(e.clipboardData.files);
                  if (pasted.length) {
                    e.preventDefault();
                    void attach(pasted);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) send();
                  }
                }}
                rows={1}
                placeholder={!aiReady ? 'Connect a free AI key to start chatting' : voice.listening ? 'Listening… speak now' : `Message ${aiName}…`}
                disabled={!aiReady}
                aria-label="Message"
              />
              {voice.supported && (
                <button className={`as-icbtn ${voice.listening ? 'live' : ''}`} onClick={() => (voice.listening ? voice.stop() : voice.start())} disabled={!aiReady} aria-label={voice.listening ? 'Stop voice typing' : 'Voice typing'} title={voice.listening ? 'Stop voice typing' : 'Voice typing'} type="button">
                  <MIcon path={voice.listening ? ic.mdiMicrophoneOff : ic.mdiMicrophoneOutline} size={22} />
                </button>
              )}
              {busy ? (
                <button className="as-send as-stop" onClick={stop} aria-label="Stop answering" title="Stop" type="button">
                  <MIcon path={ic.mdiStop} size={20} />
                </button>
              ) : (
                <button className="as-send" disabled={!canSend} aria-label="Send" title="Send" type="submit">
                  <Glyph e="➤" size={20} />
                </button>
              )}
            </div>
            <input ref={fileInput} type="file" hidden multiple accept={ACCEPT} onChange={(e) => (void attach(e.target.files), (e.target.value = ''))} />
          </form>
          <p className="muted small as-foot">
            {aiReady ? (
              <>
                {aiName} can make mistakes, so check important facts. Searching across all your documents? Use <Link to="/ask">Ask your documents</Link>.
              </>
            ) : (
              <Link to="/account#ai">Connect a free Gemini, Groq or OpenRouter key →</Link>
            )}
          </p>
        </main>
      </div>
      {picker && <DocPicker onPick={(d) => void attachDoc(d)} onClose={() => setPicker(false)} />}
    </div>
  );
}

/** Choose one of your CoWrite documents to add to the message. */
function DocPicker({ onPick, onClose }: { onPick(d: DocMeta): void; onClose(): void }) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api<{ documents: DocMeta[] }>('/docs?view=recent').then((r) => setDocs(r.documents), () => setDocs([]));
  }, []);
  const list = (docs ?? []).filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal as-picker" role="dialog" aria-label="Add a CoWrite document" onClick={(e) => e.stopPropagation()}>
        <header className="row-between">
          <h3>Add a CoWrite document</h3>
          <button className="as-icbtn" onClick={onClose} aria-label="Close" type="button">
            <MIcon path={ic.mdiClose} size={20} />
          </button>
        </header>
        <label className="as-find">
          <MIcon path={ic.mdiMagnify} size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your documents" aria-label="Search your documents" autoFocus />
        </label>
        <ul>
          {!docs ? (
            <li className="muted">Loading…</li>
          ) : !list.length ? (
            <li className="muted">No documents found.</li>
          ) : (
            list.slice(0, 50).map((d) => (
              <li key={d.id}>
                <button onClick={() => onPick(d)} disabled={d.encrypted} type="button">
                  <ProductIcon id={KIND_PRODUCT[d.kind ?? 'doc'] ?? 'docs'} size={22} />
                  <span>
                    <b>{d.title || 'Untitled'}</b>
                    <small className="muted">{d.encrypted ? 'Encrypted, cannot be shared with the AI' : `Edited ${timeAgo(d.updatedAt)}`}</small>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
