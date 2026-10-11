// Pure quiz logic. No I/O, no secrets. RNG is injected so tests are
// deterministic. Shared by the client (live preview) and server (quiz build).

export const MIN_SENTENCES = 5;

export type QuizFormat = 'blank' | 'firstSentence' | 'recite';

export interface QuizRatio {
  blankPct: number;
  firstPct: number;
  recitePct: number;
}

export type QuizQuestion =
  | {
      format: 'blank';
      passageTitle: string;
      prev: string | null;
      next: string | null;
      choices: string[];
      answerIndex: number;
    }
  | {
      format: 'firstSentence';
      passageTitle: string;
      choices: string[];
      answerIndex: number;
    }
  | {
      format: 'recite';
      passageTitle: string;
      items: { keyword: string; sentence: string }[];
    };

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickIndex(rng: () => number, length: number): number {
  return Math.floor(rng() * length);
}

function sampleTwo(pool: string[], rng: () => number): string[] {
  const copy = [...pool];
  const out: string[] = [];
  for (let k = 0; k < 2 && copy.length > 0; k++) {
    const i = pickIndex(rng, copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function assembleChoices(
  answer: string,
  distractors: string[],
  rng: () => number,
): { choices: string[]; answerIndex: number } {
  const tagged = [
    { text: answer, isAnswer: true },
    ...distractors.map((text) => ({ text, isAnswer: false })),
  ];
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = pickIndex(rng, i + 1);
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  return {
    choices: tagged.map((t) => t.text),
    answerIndex: tagged.findIndex((t) => t.isAnswer),
  };
}

export function buildBlankQuiz(
  sentences: string[],
  title: string,
  rng: () => number,
): QuizQuestion {
  const blankIndex = pickIndex(rng, sentences.length);
  const prev = blankIndex > 0 ? sentences[blankIndex - 1] : null;
  const next = blankIndex < sentences.length - 1 ? sentences[blankIndex + 1] : null;
  const excluded = new Set([blankIndex - 1, blankIndex, blankIndex + 1]);
  const pool = sentences.filter((_, i) => !excluded.has(i));
  const { choices, answerIndex } = assembleChoices(
    sentences[blankIndex],
    sampleTwo(pool, rng),
    rng,
  );
  return { format: 'blank', passageTitle: title, prev, next, choices, answerIndex };
}

export function buildFirstSentenceQuiz(
  sentences: string[],
  title: string,
  rng: () => number,
): QuizQuestion {
  const { choices, answerIndex } = assembleChoices(
    sentences[0],
    sampleTwo(sentences.slice(1), rng),
    rng,
  );
  return { format: 'firstSentence', passageTitle: title, choices, answerIndex };
}

export function buildReciteQuiz(
  sentences: string[],
  keywords: string[],
  title: string,
): QuizQuestion {
  return {
    format: 'recite',
    passageTitle: title,
    items: sentences.map((sentence, i) => ({ keyword: keywords[i] ?? '', sentence })),
  };
}

export function pickFormat(ratio: QuizRatio, r: number): QuizFormat {
  const x = r * 100;
  if (x < ratio.blankPct) return 'blank';
  if (x < ratio.blankPct + ratio.firstPct) return 'firstSentence';
  return 'recite';
}

export function parseKeywords(raw: string | null, sentenceCount: number): string[] {
  const out = Array<string>(sentenceCount).fill('');
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (let i = 0; i < sentenceCount; i++) {
    out[i] = typeof parsed[i] === 'string' ? parsed[i] : '';
  }
  return out;
}

export function serializeKeywords(keywords: string[]): string {
  return JSON.stringify(keywords);
}

export function hasKeywords(keywords: string[]): boolean {
  return keywords.some((k) => k.trim() !== '');
}
