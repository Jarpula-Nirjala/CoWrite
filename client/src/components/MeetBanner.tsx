import { useState } from 'react';
import type { CallManager } from '../editor/rtc.ts';
import { Icon } from './ui.tsx';

/** Shown in a document opened as a meeting room until you join the call. */
export function MeetBanner({ call, onError }: { call: CallManager | null; onError(msg: string): void }) {
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!call || call.active || hidden) return null;
  const join = (video: boolean) => call.join(video).catch((e) => onError(`Could not start the ${video ? 'camera' : 'microphone'}: ${(e as Error).message}`));
  return (
    <div className="meet-banner" role="dialog" aria-label="Meeting room">
      <span className="meet-banner-icon">🎥</span>
      <div>
        <strong>This document is a meeting room</strong>
        <small>Join the call; everyone here can write the notes together. Invite people with Share, then send them the link.</small>
      </div>
      <button className="btn btn-primary btn-sm" onClick={() => void join(true)} type="button">
        <Icon name="video" size={15} /> Join with camera
      </button>
      <button className="btn btn-outline btn-sm" onClick={() => void join(false)} type="button">
        <Icon name="phone" size={15} /> Voice only
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => void navigator.clipboard.writeText(`${location.origin}${location.pathname}?meet=1`).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        type="button"
      >
        {copied ? '✓ Copied' : 'Copy link'}
      </button>
      <button className="meet-banner-x" onClick={() => setHidden(true)} aria-label="Dismiss" type="button">
        ×
      </button>
    </div>
  );
}
