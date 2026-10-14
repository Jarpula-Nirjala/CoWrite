import { useState } from 'react';
import { Icon } from '../components/ui.tsx';

export type AiAction = 'continue' | 'summarize' | 'rewrite' | 'grammar' | 'shorten' | 'expand' | 'custom';

const ACTIONS: { id: Exclude<AiAction, 'custom'>; label: string; hint: string; needsSelection: boolean }[] = [
  { id: 'continue', label: 'Continue writing', hint: 'Writes the next paragraph at your cursor.', needsSelection: false },
  { id: 'summarize', label: 'Summarize document', hint: 'Adds a short summary at the end.', needsSelection: false },
  { id: 'rewrite', label: 'Rewrite selection', hint: 'Clearer, more engaging wording.', needsSelection: true },
  { id: 'grammar', label: 'Fix grammar', hint: 'Spelling, grammar and punctuation.', needsSelection: true },
  { id: 'shorten', label: 'Make shorter', hint: 'About half the length.', needsSelection: true },
  { id: 'expand', label: 'Expand', hint: 'More detail and examples.', needsSelection: true },
];

export interface AiOutcome {
  inserted: number;
  replaced: number;
}

export function AiPanel(props: {
  enabled: boolean;
  encrypted: boolean;
  canEdit: boolean;
  online: boolean;
  hasSelection: boolean;
  busy: boolean;
  error: string | null;
  outcome: AiOutcome | null;
  onRun(action: AiAction, instruction?: string): void;
  onKeep(): void;
  onUndo(): void;
}) {
  const [instruction, setInstruction] = useState('');
  const blocked = !props.enabled
    ? 'The AI co-writer is not configured on this server yet (it needs an Anthropic API key).'
    : props.encrypted
      ? 'Unavailable in end-to-end encrypted documents: the server cannot read them, so neither can the AI.'
      : !props.canEdit
        ? 'You need edit access to use the AI co-writer.'
        : !props.online
          ? 'The AI co-writer needs a connection.'
          : null;

  return (
    <div className="ai">
      <p className="muted small">
        Claude joins this document as a collaborator with its own cursor and types its answer in live, so everyone sees it happen. Keep the result or undo it in
        one click.
      </p>
      {blocked && <p className="notice small">{blocked}</p>}
      <div className="ai-actions">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            className="ai-action"
            disabled={!!blocked || props.busy || (a.needsSelection && !props.hasSelection)}
            onClick={() => props.onRun(a.id)}
            title={a.needsSelection && !props.hasSelection ? 'Select some text first' : a.hint}
            type="button"
          >
            <strong>{a.label}</strong>
            <span className="muted small">{a.needsSelection && !props.hasSelection ? 'Select text first' : a.hint}</span>
          </button>
        ))}
      </div>
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
            placeholder={props.hasSelection ? 'e.g. Translate the selection into Hindi' : 'e.g. Write an introduction about renewable energy'}
            maxLength={500}
          />
        </label>
        <button className="btn btn-primary btn-sm" disabled={!!blocked || props.busy || !instruction.trim()} type="submit">
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
    </div>
  );
}
