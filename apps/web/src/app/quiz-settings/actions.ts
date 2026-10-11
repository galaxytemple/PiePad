'use server';
import { revalidatePath } from 'next/cache';
import {
  createPassage as dbCreatePassage,
  updatePassage as dbUpdatePassage,
  deletePassage as dbDeletePassage,
  updateQuizConfig as dbUpdateQuizConfig,
} from '@piepad/db';
import { assertQuizOwner } from '@/lib/quiz-owner';
import { splitSentences, MIN_SENTENCES, parseKeywords, serializeKeywords } from '@/lib/quiz';

function validatePassageInput(title: string, body: string): void {
  if (!title) throw new Error('Title required');
  if (title.length > 500) throw new Error('Title too long (max 500)');
  if (!body.trim()) throw new Error('Body required');
  const count = splitSentences(body).length;
  if (count < MIN_SENTENCES) {
    throw new Error(`Passage too short: ${count} sentence(s), need at least ${MIN_SENTENCES}`);
  }
}

function keywordsFromForm(formData: FormData, body: string): string {
  const raw = String(formData.get('keywords') ?? '');
  const count = splitSentences(body).length;
  return serializeKeywords(parseKeywords(raw || null, count));
}

export async function createPassage(formData: FormData): Promise<void> {
  await assertQuizOwner();
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '');
  validatePassageInput(title, body);
  const keywords = keywordsFromForm(formData, body);
  await dbCreatePassage(title, body, keywords);
  revalidatePath('/quiz-settings');
}

export async function updatePassage(id: number, formData: FormData): Promise<void> {
  await assertQuizOwner();
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '');
  validatePassageInput(title, body);
  const keywords = keywordsFromForm(formData, body);
  await dbUpdatePassage(id, title, body, keywords);
  revalidatePath('/quiz-settings');
}

export async function deletePassage(id: number): Promise<void> {
  await assertQuizOwner();
  await dbDeletePassage(id);
  revalidatePath('/quiz-settings');
}

function parsePct(formData: FormData, field: string): number {
  const raw = formData.get(field);
  if (raw === null || String(raw).trim() === '') {
    throw new Error(`${field} is required`);
  }
  const pct = Number(raw);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new Error(`${field} must be an integer between 0 and 100`);
  }
  return pct;
}

export async function updateQuizConfig(formData: FormData): Promise<void> {
  await assertQuizOwner();
  const blankPct = parsePct(formData, 'blankPct');
  const firstPct = parsePct(formData, 'firstPct');
  const recitePct = parsePct(formData, 'recitePct');
  if (blankPct + firstPct + recitePct !== 100) {
    throw new Error('The three ratios must sum to 100');
  }
  await dbUpdateQuizConfig(blankPct, firstPct, recitePct);
  revalidatePath('/quiz-settings');
}
