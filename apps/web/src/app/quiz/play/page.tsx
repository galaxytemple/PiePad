import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isQuizOwner } from '@/lib/quiz-owner';
import { fetchNextQuiz } from '../actions';
import { QuizClient } from './QuizClient';
import { QuizHeader } from '@/components/QuizHeader';

export const dynamic = 'force-dynamic';

export default async function QuizPlayPage() {
  const session = await auth();
  if (!isQuizOwner(session)) notFound();

  const initial = await fetchNextQuiz();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <QuizHeader active="play" />
      <main className="mx-auto w-full max-w-md flex-1 p-6 sm:p-8 space-y-4">
        <QuizClient initial={initial} />
      </main>
    </div>
  );
}
