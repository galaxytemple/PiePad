import { describe, it, expect } from 'vitest';
import {
  splitSentences,
  buildBlankQuiz,
  buildFirstSentenceQuiz,
  buildReciteQuiz,
  pickFormat,
  parseKeywords,
  serializeKeywords,
  hasKeywords,
} from './quiz';

// Deterministic rng: replays a fixed sequence (0 <= v < 1).
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const FIVE = ['A1.', 'B2.', 'C3.', 'D4.', 'E5.'];

describe('splitSentences', () => {
  it('splits on . ? ! followed by whitespace, keeping punctuation', () => {
    expect(splitSentences('Hello world. How are you? I am fine!')).toEqual([
      'Hello world.',
      'How are you?',
      'I am fine!',
    ]);
  });

  it('splits across paragraph breaks and trims', () => {
    expect(splitSentences('One.\n\n  Two.\nThree.')).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('keeps a trailing sentence without terminal punctuation', () => {
    expect(splitSentences('Done. Tail')).toEqual(['Done.', 'Tail']);
  });

  it('drops empty fragments', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('buildBlankQuiz', () => {
  it('uses prev/next neighbors and excludes them + answer from distractors', () => {
    // rng calls: [0] blankIndex pick -> index 0 (first sentence, prev=null)
    // then sampleTwo picks from pool, then shuffle.
    const q = buildBlankQuiz(FIVE, 'T', seq([0, 0, 0, 0, 0]));
    expect(q.format).toBe('blank');
    if (q.format !== 'blank') return;
    expect(q.passageTitle).toBe('T');
    expect(q.prev).toBeNull(); // blank is first sentence
    expect(q.next).toBe('B2.'); // immediate next
    expect(q.choices).toHaveLength(3);
    expect(q.choices[q.answerIndex]).toBe('A1.'); // answer is the blanked sentence
    // distractors must not be the answer, prev(none), or next('B2.')
    const distractors = q.choices.filter((_, i) => i !== q.answerIndex);
    expect(distractors).not.toContain('A1.');
    expect(distractors).not.toContain('B2.');
  });

  it('sets prev and next when blank is in the middle', () => {
    // blankIndex pick -> 2 (rng 0.5 * 5 = 2.5 -> floor 2)
    const q = buildBlankQuiz(FIVE, 'T', seq([0.5, 0, 0, 0, 0]));
    if (q.format !== 'blank') throw new Error('expected blank');
    expect(q.prev).toBe('B2.');
    expect(q.next).toBe('D4.');
    expect(q.choices[q.answerIndex]).toBe('C3.');
  });
});

describe('buildFirstSentenceQuiz', () => {
  it('answer is the first sentence; distractors come from the rest', () => {
    const q = buildFirstSentenceQuiz(FIVE, 'Title', seq([0, 0, 0, 0]));
    expect(q.format).toBe('firstSentence');
    if (q.format !== 'firstSentence') return;
    expect(q.passageTitle).toBe('Title');
    expect(q.choices).toHaveLength(3);
    expect(q.choices[q.answerIndex]).toBe('A1.');
    const distractors = q.choices.filter((_, i) => i !== q.answerIndex);
    expect(distractors).not.toContain('A1.');
  });
});

describe('buildReciteQuiz', () => {
  it('pairs each sentence with its keyword by index', () => {
    const q = buildReciteQuiz(FIVE, ['k1', 'k2', 'k3', 'k4', 'k5'], 'T');
    expect(q.format).toBe('recite');
    if (q.format !== 'recite') return;
    expect(q.passageTitle).toBe('T');
    expect(q.items).toHaveLength(5);
    expect(q.items[0]).toEqual({ keyword: 'k1', sentence: 'A1.' });
    expect(q.items[4]).toEqual({ keyword: 'k5', sentence: 'E5.' });
  });

  it('uses empty string for missing keywords', () => {
    const q = buildReciteQuiz(FIVE, ['k1'], 'T');
    if (q.format !== 'recite') throw new Error('expected recite');
    expect(q.items[0].keyword).toBe('k1');
    expect(q.items[1].keyword).toBe('');
    expect(q.items[4].keyword).toBe('');
  });
});

describe('pickFormat', () => {
  const ratio = { blankPct: 30, firstPct: 20, recitePct: 50 };

  it('returns blank when r*100 < blankPct', () => {
    expect(pickFormat(ratio, 0)).toBe('blank'); // 0 < 30
    expect(pickFormat(ratio, 0.299)).toBe('blank'); // 29.9 < 30
  });

  it('returns firstSentence in the middle band', () => {
    expect(pickFormat(ratio, 0.3)).toBe('firstSentence'); // 30 < 50
    expect(pickFormat(ratio, 0.499)).toBe('firstSentence'); // 49.9 < 50
  });

  it('returns recite in the top band', () => {
    expect(pickFormat(ratio, 0.5)).toBe('recite'); // 50, not < 50
    expect(pickFormat(ratio, 0.999)).toBe('recite');
  });

  it('honors a 100% single-format ratio', () => {
    expect(pickFormat({ blankPct: 100, firstPct: 0, recitePct: 0 }, 0.999)).toBe('blank');
    expect(pickFormat({ blankPct: 0, firstPct: 0, recitePct: 100 }, 0)).toBe('recite');
  });
});

describe('keyword helpers', () => {
  it('parseKeywords pads to sentence count when raw is null/empty', () => {
    expect(parseKeywords(null, 3)).toEqual(['', '', '']);
    expect(parseKeywords('', 2)).toEqual(['', '']);
  });

  it('parseKeywords pads and truncates a JSON array to sentence count', () => {
    expect(parseKeywords('["a","b"]', 4)).toEqual(['a', 'b', '', '']);
    expect(parseKeywords('["a","b","c"]', 2)).toEqual(['a', 'b']);
  });

  it('parseKeywords coerces non-strings and survives malformed JSON', () => {
    expect(parseKeywords('["a",5,null]', 3)).toEqual(['a', '', '']);
    expect(parseKeywords('not json', 2)).toEqual(['', '']);
    expect(parseKeywords('{"a":1}', 2)).toEqual(['', '']);
  });

  it('serializeKeywords round-trips through parseKeywords', () => {
    const kw = ['one', '', 'three'];
    expect(parseKeywords(serializeKeywords(kw), 3)).toEqual(kw);
  });

  it('hasKeywords is true only when at least one non-blank keyword exists', () => {
    expect(hasKeywords(['', '', ''])).toBe(false);
    expect(hasKeywords(['  ', ''])).toBe(false);
    expect(hasKeywords(['', 'x'])).toBe(true);
  });
});
