'use client';

import { useState } from 'react';
import type { GrillQuestion } from '@/lib/data';

// Client island: renders each grill question with its "why" line and an answer
// box that POSTs to /api/answer. Server page stays a server component.
export function GrillAnswers({ questions }: { questions: GrillQuestion[] }) {
  return (
    <div className="space-y-4">
      {questions.map((q, i) => (
        <QuestionCard key={q.id ?? i} q={q} index={i + 1} />
      ))}
    </div>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function QuestionCard({ q, index }: { q: GrillQuestion; index: number }) {
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState<SaveState>('idle');

  async function submit() {
    if (!answer.trim()) return;
    setState('saving');
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: q.id ?? `q${index}`,
          question: q.question,
          answer,
        }),
      });
      setState(res.ok ? 'saved' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-1 flex items-start gap-2">
        <span className="text-[13px] font-semibold tabular-nums text-ink-faint">{index}.</span>
        <h2 className="text-[15px] font-semibold text-ink">{q.question}</h2>
      </div>
      {q.why && <p className="mb-2 pl-5 text-[13px] text-ink-muted">Why: {q.why}</p>}
      <div className="mb-3 flex flex-wrap gap-2 pl-5 text-[11px] text-ink-faint">
        {q.target && <span className="rounded border border-line px-1.5 py-0.5">{q.target}</span>}
        {q.metric_reason && (
          <span className="rounded border border-line px-1.5 py-0.5">flagged: {q.metric_reason}</span>
        )}
      </div>
      <textarea
        value={answer}
        onChange={(e) => {
          setAnswer(e.target.value);
          if (state !== 'idle') setState('idle');
        }}
        placeholder="Your answer…"
        rows={3}
        className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={state === 'saving' || !answer.trim()}
          className="rounded-lg border border-line-strong bg-panel-2 px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-panel disabled:opacity-50"
        >
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Submit'}
        </button>
        {state === 'error' && (
          <span className="text-[12px] text-state-fail">Could not save — try again.</span>
        )}
      </div>
    </div>
  );
}
