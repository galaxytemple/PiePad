'use client';
import { useState } from 'react';
import {
  splitSentences,
  parseKeywords,
  serializeKeywords,
  MIN_SENTENCES,
} from '@/lib/quiz';

type Action = (formData: FormData) => void | Promise<void>;

export function PassageForm({
  action,
  initialTitle = '',
  initialBody = '',
  initialKeywords = null,
  submitLabel,
}: {
  action: Action;
  initialTitle?: string;
  initialBody?: string;
  initialKeywords?: string | null;
  submitLabel: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [keywords, setKeywords] = useState<string[]>(() =>
    parseKeywords(initialKeywords, splitSentences(initialBody).length),
  );
  const sentences = splitSentences(body);
  const tooShort = sentences.length < MIN_SENTENCES;

  const aligned = sentences.map((_, i) => keywords[i] ?? '');

  function setKeywordAt(i: number, value: string) {
    setKeywords((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push('');
      next[i] = value;
      return next;
    });
  }

  return (
    <form action={action} className="space-y-3">
      <input
        name="title"
        defaultValue={initialTitle}
        placeholder="지문 제목 (Title)"
        required
        maxLength={500}
        className="w-full rounded-md border border-divider bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="지문 본문 붙여넣기. 문장은 . ? ! 뒤 공백으로 구분됩니다."
        required
        rows={8}
        className="w-full rounded-md border border-divider bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input type="hidden" name="keywords" value={serializeKeywords(aligned)} readOnly />
      <div className="rounded-md border border-divider bg-content2/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-default-600">
            문장 및 키워드 (암기 퀴즈용)
          </span>
          <span className={`text-xs ${tooShort ? 'text-danger-500' : 'text-success-600'}`}>
            {sentences.length}개 문장{tooShort ? ` — 최소 ${MIN_SENTENCES}개 이상 필요` : ''}
          </span>
        </div>
        <ol className="list-decimal list-inside space-y-2 text-sm text-foreground max-h-72 overflow-y-auto">
          {sentences.map((s, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i} className="break-words">
              <span>{s}</span>
              <input
                value={aligned[i]}
                onChange={(e) => setKeywordAt(i, e.target.value)}
                placeholder={`문장 ${i + 1} 키워드`}
                maxLength={200}
                aria-label={`문장 ${i + 1} 키워드`}
                className="mt-1 w-full rounded-md border border-divider bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </li>
          ))}
        </ol>
        {sentences.length === 0 && <p className="text-sm text-default-400">본문을 입력하면 문장이 자동으로 분리됩니다.</p>}
      </div>
      <button
        type="submit"
        disabled={tooShort}
        className="rounded-md bg-blue-600 text-white text-sm font-medium px-4 py-2 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitLabel}
      </button>
    </form>
  );
}
