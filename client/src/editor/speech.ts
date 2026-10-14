import { useCallback, useEffect, useRef, useState } from 'react';

/** The parts of the Web Speech API used here (not in TypeScript's DOM types everywhere). */
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

const Ctor = (): RecognitionCtor | undefined =>
  (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

/** Voice typing: final phrases are passed to `onFinal` to insert at the cursor. */
export function useSpeech(onFinal: (text: string) => void) {
  const supported = typeof window !== 'undefined' && !!Ctor();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const want = useRef(false);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const stop = useCallback(() => {
    want.current = false;
    rec.current?.stop();
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const C = Ctor();
    if (!C) return;
    const r = new C();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else partial += res[0].transcript;
      }
      setInterim(partial);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone access was blocked. Allow it in your browser to use voice typing.');
        want.current = false;
      }
    };
    // Browsers stop listening after a pause; keep going until the user stops.
    r.onend = () => {
      if (want.current) r.start();
      else setListening(false);
    };
    rec.current = r;
    want.current = true;
    setError(null);
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => stop(), [stop]);
  return { supported, listening, interim, error, start, stop };
}
