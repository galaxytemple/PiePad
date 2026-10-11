import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isQuizOwner } from '@/lib/quiz-owner';
import { fetchNextQuiz } from '../actions';
import { QuizClient } from './QuizClient';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function QuizPlayPage() {
  const session = await auth();
  if (!isQuizOwner(session)) notFound();

  const initial = await fetchNextQuiz();

  return (
    <div className="min-h-screen bg-background text-foreground p-6 sm:p-8">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <Link
            href="/quiz"
            className="text-xs text-default-400 hover:text-foreground transition-colors"
          >
            ← 캘린더로 돌아가기
          </Link>
          <Link
            href="/quiz-settings"
            className="text-xs text-default-400 hover:text-foreground transition-colors"
          >
            ⚙️ 설정
          </Link>
        </div>
        <QuizClient initial={initial} />
      </div>
    </div>
  );
}
