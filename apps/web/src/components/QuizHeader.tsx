import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export function QuizHeader({ active }: { active?: "quiz" | "setting" | "play" }) {
  return (
    <header className="flex items-center justify-between border-b border-divider bg-content1 px-6 py-3">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">PiePad</span>
        </Link>
        <span className="rounded bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-xs font-semibold">
          Quiz
        </span>
      </div>
      <nav className="flex items-center gap-4 text-sm font-medium">
        <Link
          href="/quiz"
          className={`transition-colors ${
            active === "quiz"
              ? "text-blue-600 dark:text-blue-400 font-semibold"
              : "text-default-500 hover:text-default-900"
          }`}
        >
          Quiz
        </Link>
        <Link
          href="/quiz-settings"
          className={`transition-colors ${
            active === "setting"
              ? "text-blue-600 dark:text-blue-400 font-semibold"
              : "text-default-500 hover:text-default-900"
          }`}
        >
          Setting
        </Link>
        <ThemeToggle />
        <Link
          href="/"
          className="text-xs px-2.5 py-1.5 rounded-lg border border-divider hover:bg-content2 text-default-600 transition-colors"
        >
          ← Pad
        </Link>
      </nav>
    </header>
  );
}
