import { useState } from 'react';
import { Icon } from '../components/ui.tsx';
import { Link } from '../router.ts';
import { useSpeech } from './speech.ts';

export type AiAction = 'continue' | 'summarize' | 'rewrite' | 'grammar' | 'shorten' | 'expand' | 'custom' | 'tone';

const ACTIONS: { id: Exclude<AiAction, 'custom' | 'tone'>; label: string; hint: string; needsSelection: boolean }[] = [
  { id: 'continue', label: 'Continue writing', hint: 'Writes the next paragraph at your cursor.', needsSelection: false },
  { id: 'summarize', label: 'Summarize document', hint: 'Adds a short summary at the end.', needsSelection: false },
  { id: 'rewrite', label: 'Rewrite selection', hint: 'Clearer, more engaging wording.', needsSelection: true },
  { id: 'grammar', label: 'Fix grammar', hint: 'Spelling, grammar and punctuation.', needsSelection: true },
  { id: 'shorten', label: 'Make shorter', hint: 'About half the length.', needsSelection: true },
  { id: 'expand', label: 'Expand', hint: 'More detail and examples.', needsSelection: true },
];

export const TONES = [
  { id: 'formal', label: '🎩 Formal' },
  { id: 'casual', label: '😊 Casual' },
  { id: 'persuasive', label: '📣 Persuasive' },
  { id: 'simple', label: '🧒 Simpler' },
  { id: 'friendly', label: '🤝 Friendly' },
  { id: 'confident', label: '💪 Confident' },
  { id: 'academic', label: '🎓 Academic' },
] as const;

export const LANGS = ['Hindi', 'Telugu', 'Tamil', 'Marathi', 'Bengali', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Korean', 'Chinese (Simplified)', 'Arabic', 'Russian'];

export type AiTool =
  | { kind: 'review'; focus: string }
  | { kind: 'slides' }
  | { kind: 'translate'; lang: string }
  | { kind: 'meeting'; transcript: string }
  | { kind: 'photo-notes' }
  | { kind: 'summary-card' };

export interface AiOutcome {
  inserted: number;
  replaced: number;
}

export function AiPanel(props: {
  enabled: boolean;
  encrypted: boolean;
  canEdit: boolean;
  online: boolean;
  signedIn: boolean;
  hasSelection: boolean;
  busy: boolean;
  error: string | null;
  outcome: AiOutcome | null;
  toolBusy: string | null;
  toolMessage: string | null;
  onRun(action: AiAction, instruction?: string): void;
  onTool(tool: AiTool): void;
  onKeep(): void;
  onUndo(): void;
}) {
  const [instruction, setInstruction] = useState('');
  const [lang, setLang] = useState('Hindi');
  const [focus, setFocus] = useState('');
  const [transcript, setTranscript] = useState('');
  const speech = useSpeech((t) => setTranscript((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}${t}`));
  const blocked = !props.enabled
    ? 'The AI features are not configured on this server yet (they need an Anthropic API key).'
    : props.encrypted
      ? 'Unavailable in end-to-end encrypted documents: the server cannot read them, so neither can the AI.'
      : !props.online
        ? 'The AI features need a connection.'
        : null;
  const writeBlocked = blocked ?? (!props.canEdit ? 'You need edit access to let Claude write here.' : null);
  const busy = props.busy || !!props.toolBusy;

  return (
    <div className="ai">
      <p className="muted small">
        Claude joins this document as a collaborator with its own cursor and types its answer in live, so everyone sees it happen. Keep the result or undo it in
        one click.
      </p>
      {blocked && <p className="notice small">{blocked}</p>}

      <h3 className="ai-h">Write</h3>
      <div className="ai-actions">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            className="ai-action"
            disabled={!!writeBlocked || busy || (a.needsSelection && !props.hasSelection)}
            onClick={() => props.onRun(a.id)}
            title={a.needsSelection && !props.hasSelection ? 'Select some text first' : a.hint}
            type="button"
          >
            <strong>{a.label}</strong>
            <span className="muted small">{a.needsSelection && !props.hasSelection ? 'Select text first' : a.hint}</span>
          </button>
        ))}
      </div>

      <h3 className="ai-h">Change the tone</h3>
      <div className="tone-row">
        {TONES.map((t) => (
          <button key={t.id} className="tone-chip" disabled={!!writeBlocked || busy || !props.hasSelection} onClick={() => props.onRun('tone', t.id)} title={props.hasSelection ? `Rewrite the selection in a ${t.id} tone` : 'Select some text first'} type="button">
            {t.label}
          </button>
        ))}
      </div>
      {!props.hasSelection && <p className="muted small">Select a passage, then pick a tone.</p>}

      <form
        className="ai-custom"
        onSubmit={(e) => {
          e.preventDefault();
          if (instruction.trim()) props.onRun('custom', instruction.trim());
        }}
      >
        <label className="field">
          <span>Ask Claude</span>
          <textarea
            className="input"
            rows={2}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={props.hasSelection ? 'e.g. Turn the selection into a table' : 'e.g. Write an introduction about renewable energy'}
            maxLength={500}
          />
        </label>
        <button className="btn btn-primary btn-sm" disabled={!!writeBlocked || busy || !instruction.trim()} type="submit">
          <Icon name="sparkle" size={14} /> {props.busy ? 'Claude is writing…' : 'Send'}
        </button>
      </form>
      {props.busy && (
        <p className="ai-status">
          <span className="spinner small" /> Claude is writing in the document…
        </p>
      )}
      {props.error && <p className="error-text small">{props.error}</p>}
      {props.outcome && !props.busy && (
        <div className="ai-result">
          <p className="small">
            Claude {props.outcome.replaced ? `replaced ${props.outcome.replaced} characters with ` : 'wrote '}
            {props.outcome.inserted} characters.
          </p>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" onClick={props.onKeep} type="button">
              Keep
            </button>
            <button className="btn btn-outline btn-sm" onClick={props.onUndo} type="button">
              Undo
            </button>
          </div>
        </div>
      )}

      <h3 className="ai-h">Review</h3>
      <div className="ai-tool">
        <p className="small muted">Claude reads the document like an editor and leaves comments on specific sentences.</p>
        <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Focus (optional): e.g. persuasiveness for investors" maxLength={200} />
        <button className="btn btn-outline btn-sm" disabled={!!blocked || busy} onClick={() => props.onTool({ kind: 'review', focus })} type="button">
          💬 Review my document
        </button>
      </div>

      <h3 className="ai-h">Transform</h3>
      <div className="ai-tool">
        <button className="ai-action" disabled={!!blocked || busy || !props.signedIn} onClick={() => props.onTool({ kind: 'slides' })} type="button">
          <strong>📊 Turn into a presentation</strong>
          <span className="muted small">{props.signedIn ? 'Builds a themed slide deck with speaker notes.' : 'Sign in to create a deck.'}</span>
        </button>
        <button className="ai-action" disabled={!!writeBlocked || busy} onClick={() => props.onTool({ kind: 'summary-card' })} type="button">
          <strong>🧾 Add a summary card</strong>
          <span className="muted small">A live TL;DR at the top you can refresh any time.</span>
        </button>
        <button className="ai-action" disabled={!!writeBlocked || busy} onClick={() => props.onTool({ kind: 'photo-notes' })} type="button">
          <strong>📷 Photo of notes → text</strong>
          <span className="muted small">Upload a whiteboard or notebook photo; Claude types it up.</span>
        </button>
        <div className="ai-row">
          <select className="input" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
            {LANGS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <button className="btn btn-outline btn-sm" disabled={!!blocked || busy || !props.signedIn} onClick={() => props.onTool({ kind: 'translate', lang })} type="button" title="Creates a linked copy that re-translates itself when this document changes">
            🌐 Live translation
          </button>
        </div>
      </div>

      <h3 className="ai-h">Meeting mode</h3>
      <div className="ai-tool">
        <p className="small muted">Dictate or paste a meeting transcript. Claude writes the summary, decisions and action items into the document at your cursor.</p>
        <textarea className="input" rows={4} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Transcript…" />
        {speech.interim && <p className="small muted">{speech.interim}</p>}
        <div className="row-actions">
          {speech.supported && (
            <button className={`btn btn-sm ${speech.listening ? 'btn-danger' : 'btn-outline'}`} onClick={() => (speech.listening ? speech.stop() : speech.start())} type="button">
              <Icon name="mic" size={14} /> {speech.listening ? 'Stop listening' : 'Listen to the meeting'}
            </button>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={!!writeBlocked || busy || transcript.trim().length < 40}
            onClick={() => {
              speech.stop();
              props.onTool({ kind: 'meeting', transcript });
            }}
            type="button"
          >
            Write notes
          </button>
        </div>
      </div>

      {props.toolBusy && (
        <p className="ai-status">
          <span className="spinner small" /> {props.toolBusy}
        </p>
      )}
      {props.toolMessage && <p className="notice small">{props.toolMessage}</p>}

      <p className="small">
        <Link to="/ask">
          <Icon name="search" size={13} /> Ask questions across all your documents →
        </Link>
      </p>
    </div>
  );
}
