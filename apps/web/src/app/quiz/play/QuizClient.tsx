'use client';
import { useState, useTransition } from 'react';
import type { QuizQuestion } from '@/lib/quiz';
import { fetchNextQuiz, recordCorrect } from '../actions';

export function QuizClient({ initial }: { initial: QuizQuestion | null }) {
  const [question, setQuestion] = useState<QuizQuestion | null>(initial);
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [reciteRevealed, setReciteRevealed] = useState(0);
  const [reciteRecorded, setReciteRecorded] = useState(false);
  const [recordError, setRecordError] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!question) {
    return (
      <div className="max-w-md mx-auto text-center text-sm text-default-400 py-16 border border-dashed border-divider rounded-xl">
        등록된 지문이 없습니다. Quiz Setting에서 지문을 추가하세요.
      </div>
    );
  }

  function record() {
    startTransition(async () => {
      try {
        setRecordError(false);
        await recordCorrect();
      } catch {
        setRecordError(true);
      }
    });
  }

  function onNext() {
    startTransition(async () => {
      const next = await fetchNextQuiz();
      setQuestion(next);
      setRevealed(false);
      setSelected(null);
      setReciteRevealed(0);
      setReciteRecorded(false);
      setRecordError(false);
    });
  }

  if (question.format === 'recite') {
    const items = question.items;
    const done = reciteRevealed >= items.length;

    function onReveal() {
      const nextCount = reciteRevealed + 1;
      setReciteRevealed(nextCount);
      if (nextCount >= items.length && !reciteRecorded) {
        setReciteRecorded(true);
        record();
      }
    }

    function onPrev() {
      setReciteRevealed((c) => Math.max(0, c - 1));
    }

    return (
      <div className="max-w-md mx-auto space-y-6">
        <div className="bg-content1 border border-divider rounded-xl p-5 space-y-3">
          <p className="text-xs uppercase tracking-wide text-default-400">Recite from keywords</p>
          <p className="text-lg font-semibold text-foreground">{question.passageTitle}</p>
          <ol className="list-decimal list-inside space-y-3 text-base">
            {items.map((it, i) => (
              <li key={i} className="break-words">
                <span className="font-semibold text-primary">{it.keyword || '—'}</span>
                {i < reciteRevealed && (
                  <p className="mt-1 ml-5 text-foreground/90 leading-relaxed">{it.sentence}</p>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={onPrev}
              disabled={reciteRevealed === 0}
              className="flex-1 rounded-xl border border-divider text-foreground text-sm font-medium px-4 py-3 hover:bg-content2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              이전 문장
            </button>
            {!done && (
              <button
                onClick={onReveal}
                className="flex-1 rounded-xl bg-blue-600 text-white text-sm font-semibold px-4 py-3 hover:bg-blue-700 transition-colors shadow-sm"
              >
                {reciteRevealed === 0 ? '문장 보기' : '다음 문장'}
              </button>
            )}
          </div>
          {done && (
            <>
              <p className="text-sm font-semibold text-success">완료했습니다!</p>
              {recordError && (
                <p className="text-xs text-warning">기록에 실패했습니다. 다음 문제로 넘어가도 됩니다.</p>
              )}
              <button
                onClick={onNext}
                disabled={pending}
                className="w-full rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm font-semibold px-4 py-3 hover:opacity-90 disabled:opacity-40 transition-all shadow-md"
              >
                다음 문제 (Next)
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const answer = question.choices[question.answerIndex];

  function onSelect(i: number) {
    if (selected !== null) return;
    setSelected(i);
    if (question && question.format !== 'recite' && i === question.answerIndex) {
      record();
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="bg-content1 border border-divider rounded-xl p-5 space-y-3">
        {question.format === 'blank' ? (
          <div className="space-y-2 text-base leading-relaxed">
            {question.prev && <p className="text-default-400">{question.prev}</p>}
            <p className="font-semibold text-foreground">
              {revealed && selected !== null ? answer : '_______________'}
            </p>
            {question.next && <p className="text-default-400">{question.next}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-default-400">Title</p>
            <p className="text-lg font-semibold text-foreground">{question.passageTitle}</p>
            <p className="text-sm text-default-400">What is the opening sentence?</p>
          </div>
        )}
      </div>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-xl bg-blue-600 text-white text-sm font-semibold px-4 py-3 hover:bg-blue-700 shadow-md transition-colors"
        >
          정답 보기 (Answer)
        </button>
      ) : (
        <div className="space-y-2">
          {question.choices.map((c, i) => {
            const isAnswer = i === question.answerIndex;
            const isPicked = i === selected;
            const decided = selected !== null;
            const cls = !decided
              ? 'border-divider hover:bg-content2'
              : isAnswer
                ? 'border-success bg-success-50 dark:bg-success-950/30 text-success-800 dark:text-success-200'
                : isPicked
                  ? 'border-danger bg-danger-50 dark:bg-danger-950/30 text-danger-800 dark:text-danger-200'
                  : 'border-divider opacity-60';
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                disabled={decided}
                className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-all ${cls}`}
              >
                {c}
                {decided && isAnswer && <span className="ml-2 text-success font-bold">✓</span>}
                {decided && isPicked && !isAnswer && <span className="ml-2 text-danger font-bold">✗</span>}
              </button>
            );
          })}
        </div>
      )}

      {selected !== null && (
        <div className="space-y-3">
          <p className={`text-sm font-semibold ${selected === question.answerIndex ? 'text-success' : 'text-danger'}`}>
            {selected === question.answerIndex ? '정답입니다!' : '틀렸습니다.'}
          </p>
          {selected === question.answerIndex && recordError && (
            <p className="text-xs text-warning">기록에 실패했습니다. 다음 문제로 넘어가도 됩니다.</p>
          )}
          <button
            onClick={onNext}
            disabled={pending}
            className="w-full rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm font-semibold px-4 py-3 hover:opacity-90 disabled:opacity-40 transition-all shadow-md"
          >
            다음 문제 (Next)
          </button>
        </div>
      )}
    </div>
  );
}
