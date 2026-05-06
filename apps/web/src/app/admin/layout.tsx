import { auth } from "@/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!session.user.isAdmin) redirect("/");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <a href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">PiePad</span>
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
            admin
          </span>
        </a>
        <nav className="flex items-center gap-4 text-sm">
          <a
            href="/admin/users"
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Users
          </a>
          <a
            href="/admin/rooms"
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Rooms
          </a>
          <ThemeToggle />
          <a
            href="/"
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Back to home
          </a>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
    </div>
  );
}
