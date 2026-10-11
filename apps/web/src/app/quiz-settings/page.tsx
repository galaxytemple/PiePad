import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isQuizOwner } from '@/lib/quiz-owner';
import { getPassages, getQuizConfig } from '@piepad/db';
import { splitSentences } from '@/lib/quiz';
import { createPassage, updatePassage, updateQuizConfig } from './actions';
import { PassageForm } from './PassageForm';
import { DeletePassageButton } from './DeletePassageButton';
import { QuizHeader } from '@/components/QuizHeader';

export const dynamic = 'force-dynamic';

export default async function QuizSettingsPage() {
  const session = await auth();
  if (!isQuizOwner(session)) notFound();

  const [passages, config] = await Promise.all([getPassages(), getQuizConfig()]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <QuizHeader active="setting" />
      <main className="mx-auto w-full max-w-2xl flex-1 p-6 sm:p-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quiz Settings</h1>
          <p className="text-sm text-default-500 mt-1">
            지문 등록/관리 및 출제 유형 비율 설정
          </p>
        </div>

        <section className="bg-content1 border border-divider rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">출제 유형 비율 (Format ratio)</h2>
          <p className="text-xs text-default-500 mb-3">세 유형의 합이 정확히 100%가 되어야 합니다.</p>
          <form action={updateQuizConfig} className="flex flex-wrap items-center gap-4">
            <label className="text-sm text-default-600">
              빈칸 맞추기&nbsp;
              <input
                type="number"
                name="blankPct"
                min={0}
                max={100}
                step={1}
                defaultValue={config.blankPct}
                className="w-16 rounded-md border border-divider bg-background px-2 py-1 text-sm text-foreground"
              />
              &nbsp;%
            </label>
            <label className="text-sm text-default-600">
              첫 문장 힌트&nbsp;
              <input
                type="number"
                name="firstPct"
                min={0}
                max={100}
                step={1}
                defaultValue={config.firstPct}
                className="w-16 rounded-md border border-divider bg-background px-2 py-1 text-sm text-foreground"
              />
              &nbsp;%
            </label>
            <label className="text-sm text-default-600">
              전문 암기&nbsp;
              <input
                type="number"
                name="recitePct"
                min={0}
                max={100}
                step={1}
                defaultValue={config.recitePct}
                className="w-16 rounded-md border border-divider bg-background px-2 py-1 text-sm text-foreground"
              />
              &nbsp;%
            </label>
            <button
              type="submit"
              className="text-xs px-3 py-1.5 bg-default-100 hover:bg-default-200 border border-divider rounded-md font-medium transition-colors"
            >
              비율 저장
            </button>
          </form>
        </section>

        <section className="bg-content1 border border-divider rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">지문 추가 (Add passage)</h2>
          <PassageForm action={createPassage} submitLabel="지문 추가" />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            등록된 지문 목록 ({passages.length}개)
          </h2>
          {passages.map((p) => (
            <div key={p.id} className="bg-content1 border border-divider rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold break-words">{p.title}</h3>
                  <p className="text-xs text-default-500 mt-1">
                    {splitSentences(p.body).length} 문장 · 등록일{' '}
                    {new Date(p.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <DeletePassageButton id={p.id} title={p.title} />
              </div>
              <details className="group">
                <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:underline">
                  수정하기
                </summary>
                <div className="mt-3 pt-3 border-t border-divider">
                  <PassageForm
                    action={updatePassage.bind(null, p.id)}
                    initialTitle={p.title}
                    initialBody={p.body}
                    initialKeywords={p.keywords}
                    submitLabel="변경사항 저장"
                  />
                </div>
              </details>
            </div>
          ))}
          {passages.length === 0 && (
            <div className="text-center text-sm text-default-400 py-12 border border-dashed border-divider rounded-xl">
              등록된 지문이 없습니다. 위에서 지문을 추가하세요.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
