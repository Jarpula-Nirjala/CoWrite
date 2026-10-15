import { useEffect, useMemo, useState } from 'react';
import type { Doc, Op } from '../../../shared/crdt.ts';
import { api, errorText } from '../api.ts';
import { Modal } from '../components/ui.tsx';
import { uid } from '../kinds/objects.ts';
import { cardKey, cardsFromNotes, makeQuiz, schedule, type Card, type Review } from './study.ts';
import { Glyph } from '../components/Glyph.tsx';

type Tab = 'cards' | 'study' | 'quiz';

/** Flashcards made from the notes (or by AI), studied with spaced repetition, plus a quiz. */
export function StudyDialog(props: {
  doc: Doc;
  version: number;
  docId: string;
  share: string | null;
  registered: boolean;
  signedIn: boolean;
  canEdit: boolean;
  aiReady: boolean;
  onEdit(ops: Op[]): void;
  onClose(): void;
}) {
  const { doc, version } = props;
  const notes = useMemo(() => cardsFromNotes(doc.tokens()), [doc, version]);
  const aiCards = useMemo<Card[]>(
    () =>
      doc
        .objectsWith('flash:')
        .map((o) => ({ key: cardKey(String(o.fields.q)), q: String(o.fields.q ?? ''), a: String(o.fields.a ?? ''), source: 'ai' as const }))
        .filter((c) => c.q && c.a),
    [doc, version],
  );
  const cards = useMemo(() => {
    const seen = new Set<string>();
    return [...aiCards, ...notes].filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
  }, [aiCards, notes]);

  const server = props.registered && props.signedIn;
  const localKey = `cowrite:flash:${props.docId}`;
  const [reviews, setReviews] = useState<Map<string, Review>>(new Map());
  const [tab, setTab] = useState<Tab>('cards');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (server) {
      api<{ reviews: Review[] }>(`/docs/${props.docId}/flash`, { share: props.share }).then((r) => setReviews(new Map(r.reviews.map((x) => [x.card, x]))), () => {});
    } else {
      try {
        const list = JSON.parse(localStorage.getItem(localKey) ?? '[]') as Review[];
        setReviews(new Map(list.map((x) => [x.card, x])));
      } catch {
        // ignore
      }
    }
  }, [server, props.docId, props.share, localKey]);

  const save = (r: Review) => {
    setReviews((m) => {
      const next = new Map(m).set(r.card, r);
      if (!server) {
        try {
          localStorage.setItem(localKey, JSON.stringify([...next.values()]));
        } catch {
          // ignore
        }
      }
      return next;
    });
    if (server) void api(`/docs/${props.docId}/flash/${r.card}`, { method: 'PUT', share: props.share, body: r }).catch(() => {});
  };

  const now = Date.now();
  const due = cards.filter((c) => (reviews.get(c.key)?.due ?? 0) <= now);
  const learned = cards.filter((c) => (reviews.get(c.key)?.interval ?? 0) >= 3).length;

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ cards: { q: string; a: string }[] }>(`/docs/${props.docId}/ai/flashcards`, { method: 'POST', share: props.share });
      const existing = new Set(cards.map((c) => c.key));
      const fresh = r.cards.filter((c) => !existing.has(cardKey(c.q)));
      props.onEdit(fresh.flatMap((c) => doc.setFields(`flash:${uid()}`, { q: c.q, a: c.a })));
      setMsg(`Added ${fresh.length} new cards. Everyone in this document can study them.`);
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Study: flashcards & quiz" onClose={props.onClose} wide>
      <div className="tabs full" role="tablist">
        {(
          [
            ['cards', `Cards (${cards.length})`],
            ['study', `Study${due.length ? ` · ${due.length} due` : ''}`],
            ['quiz', 'Quiz'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)} type="button">
            {label}
          </button>
        ))}
      </div>

      {tab === 'cards' && (
        <div className="study-cards">
          <p className="muted small">
            Cards come from your notes automatically: lines like <code>Term: definition</code>, two-column tables, and headings followed by a paragraph.
            {props.aiReady && ' AI can write more from the whole document.'}
          </p>
          <div className="study-stats">
            <span>
              <strong>{cards.length}</strong> cards
            </span>
            <span>
              <strong>{due.length}</strong> due now
            </span>
            <span>
              <strong>{learned}</strong> learned
            </span>
          </div>
          <div className="row-actions">
            {props.aiReady && props.canEdit && props.registered && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void generate()} type="button">
                <Glyph e="✨" size={16} /> {busy ? 'Writing cards…' : 'Make cards with AI'}
              </button>
            )}
            <button className="btn btn-outline btn-sm" disabled={!cards.length} onClick={() => setTab('study')} type="button">
              Start studying
            </button>
          </div>
          {msg && <p className="notice small">{msg}</p>}
          {!cards.length && <p className="panel-empty muted">No cards yet. Write a few lines like “Photosynthesis: how plants turn light into food”.</p>}
          <ul className="card-list">
            {cards.map((c) => {
              const r = reviews.get(c.key);
              return (
                <li key={c.key}>
                  <strong>{c.q}</strong>
                  <span>{c.a}</span>
                  <span className="muted small">
                    {c.source === 'ai' ? 'AI' : 'Notes'} · {r ? (r.due <= now ? 'due' : `next in ${Math.max(1, Math.round((r.due - now) / 86_400_000))} d`) : 'new'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab === 'study' && <StudyMode cards={due.length ? due : cards} reviews={reviews} onGrade={(c, g) => save(schedule(reviews.get(c.key), c.key, g))} allDone={!due.length} />}
      {tab === 'quiz' && <QuizMode cards={cards} />}
    </Modal>
  );
}

function StudyMode({ cards, reviews, onGrade, allDone }: { cards: Card[]; reviews: Map<string, Review>; onGrade(c: Card, g: 0 | 1 | 2 | 3): void; allDone: boolean }) {
  const [queue] = useState(() => [...cards].sort(() => Math.random() - 0.5));
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = queue[i];
  if (!queue.length) return <p className="panel-empty muted">No cards to study yet.</p>;
  if (!card)
    return (
      <div className="study-done">
        <span>
          <Glyph e="✅" size={44} />
        </span>
        <h3>Session complete</h3>
        <p className="muted">You reviewed {queue.length} cards. Come back when more are due; spaced repetition shows each card just before you would forget it.</p>
      </div>
    );
  const grade = (g: 0 | 1 | 2 | 3) => {
    onGrade(card, g);
    setFlipped(false);
    setI(i + 1);
  };
  const r = reviews.get(card.key);
  return (
    <div className="study">
      {allDone && i === 0 && <p className="notice small">Nothing is due right now, so this is a free practice round.</p>}
      <div className="study-progress">
        <span style={{ width: `${(i / queue.length) * 100}%` }} />
      </div>
      <button className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(!flipped)} type="button" aria-label={flipped ? 'Show question' : 'Show answer'}>
        <span className="flash-face front">
          <small>Question {i + 1} of {queue.length}</small>
          {card.q}
          <em>Click or press Space to reveal</em>
        </span>
        <span className="flash-face back">
          <small>Answer</small>
          {card.a}
        </span>
      </button>
      {flipped ? (
        <div className="grade-row">
          <button className="grade again" onClick={() => grade(0)} type="button">
            Again
            <small>10 min</small>
          </button>
          <button className="grade hard" onClick={() => grade(1)} type="button">
            Hard
            <small>{Math.max(1, Math.round((r?.interval ?? 0) * 1.2))} d</small>
          </button>
          <button className="grade good" onClick={() => grade(2)} type="button">
            Good
            <small>{schedule(r, card.key, 2).interval} d</small>
          </button>
          <button className="grade easy" onClick={() => grade(3)} type="button">
            Easy
            <small>{schedule(r, card.key, 3).interval} d</small>
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => setFlipped(true)} type="button" autoFocus>
          Show answer
        </button>
      )}
    </div>
  );
}

function QuizMode({ cards }: { cards: Card[] }) {
  const [quiz, setQuiz] = useState(() => makeQuiz(cards));
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  if (cards.length < 4) return <p className="panel-empty muted">A quiz needs at least 4 cards.</p>;
  const q = quiz[i];
  if (!q)
    return (
      <div className="study-done">
        <span>
          <Glyph e={score / quiz.length >= 0.8 ? '🏆' : score / quiz.length >= 0.5 ? '👍' : '📚'} size={44} />
        </span>
        <h3>
          You scored {score} / {quiz.length}
        </h3>
        <button
          className="btn btn-primary"
          onClick={() => {
            setQuiz(makeQuiz(cards));
            setI(0);
            setScore(0);
            setPicked(null);
          }}
          type="button"
        >
          New quiz
        </button>
      </div>
    );
  return (
    <div className="quiz">
      <div className="study-progress">
        <span style={{ width: `${(i / quiz.length) * 100}%` }} />
      </div>
      <p className="muted small">
        Question {i + 1} of {quiz.length} · score {score}
      </p>
      <h3>{q.q}</h3>
      <div className="quiz-options">
        {q.options.map((o, k) => (
          <button
            key={k}
            className={`quiz-option ${picked !== null ? (k === q.correct ? 'right' : k === picked ? 'wrong' : '') : ''}`}
            disabled={picked !== null}
            onClick={() => {
              setPicked(k);
              if (k === q.correct) setScore(score + 1);
            }}
            type="button"
          >
            {o}
          </button>
        ))}
      </div>
      {picked !== null && (
        <button
          className="btn btn-primary"
          onClick={() => {
            setPicked(null);
            setI(i + 1);
          }}
          type="button"
          autoFocus
        >
          {i + 1 < quiz.length ? 'Next question' : 'See score'}
        </button>
      )}
    </div>
  );
}
