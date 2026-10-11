'use server';
import {
  getQuizConfig,
  fetchRandomPassages,
  recordCorrectAnswer,
} from '@piepad/db';
import { assertQuizOwner } from '@/lib/quiz-owner';
import {
  splitSentences,
  parseKeywords,
  hasKeywords,
  pickFormat,
  buildBlankQuiz,
  buildFirstSentenceQuiz,
  buildReciteQuiz,
  MIN_SENTENCES,
  type QuizQuestion,
} from '@/lib/quiz';

export async function fetchNextQuiz(): Promise<QuizQuestion | null> {
  await assertQuizOwner();
  const ratio = await getQuizConfig();
  const rows = await fetchRandomPassages(5);

  const pool = rows
    .map(({ title, body, keywords }) => {
      const sentences = splitSentences(body);
      return { title, sentences, keywords: parseKeywords(keywords, sentences.length) };
    })
    .filter((p) => p.sentences.length >= MIN_SENTENCES);
  if (pool.length === 0) return null;

  const format = pickFormat(ratio, Math.random());
  if (format === 'recite') {
    const annotated = pool.find((p) => hasKeywords(p.keywords));
    if (annotated) {
      return buildReciteQuiz(annotated.sentences, annotated.keywords, annotated.title);
    }
    const p = pool[0];
    const choiceSpan = ratio.blankPct + ratio.firstPct;
    return choiceSpan > 0 && Math.random() * choiceSpan < ratio.blankPct
      ? buildBlankQuiz(p.sentences, p.title, Math.random)
      : buildFirstSentenceQuiz(p.sentences, p.title, Math.random);
  }

  const p = pool[0];
  return format === 'blank'
    ? buildBlankQuiz(p.sentences, p.title, Math.random)
    : buildFirstSentenceQuiz(p.sentences, p.title, Math.random);
}

export async function recordCorrect(): Promise<void> {
  await assertQuizOwner();
  const tz = process.env.ORACLE_TIMEZONE || 'America/Los_Angeles';
  await recordCorrectAnswer(tz);
}
