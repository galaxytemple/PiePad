import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isQuizOwner } from '@/lib/quiz-owner';
import { getMonthlyStats } from '@piepad/db';
import { Calendar } from './Calendar';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function currentYmLa(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);
}

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function QuizPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await auth();
  if (!isQuizOwner(session)) notFound();

  const { ym: ymParam } = await searchParams;
  const ym = ymParam && YM_RE.test(ymParam) ? ymParam : currentYmLa();
  const stats = await getMonthlyStats(ym);

  return (
    <div className="min-h-screen bg-background text-foreground p-6 sm:p-8">
      <div className="space-y-6 max-w-md mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">System Design Quiz</h1>
            <p className="text-xs text-default-400 mt-0.5">
              Daily habit tracker & recitation practice
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/quiz-settings"
              className="text-xs px-2.5 py-1.5 rounded-lg border border-divider hover:bg-content2 transition-colors"
            >
              ⚙️ 설정
            </Link>
            <Link
              href="/"
              className="text-xs px-2.5 py-1.5 rounded-lg border border-divider hover:bg-content2 transition-colors"
            >
              Pad로 가기
            </Link>
          </div>
        </header>

        <Calendar ym={ym} stats={stats} />

        <Link
          href="/quiz/play"
          className="block text-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-4 py-3 shadow-md transition-all active:scale-98"
        >
          퀴즈 시작하기 →
        </Link>
      </div>
    </div>
  );
}
