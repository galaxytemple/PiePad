import { auth } from "@/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import Link from "next/link";
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
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-divider bg-content1 px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">PiePad</span>
          <span className="ml-2 rounded bg-warning-100 px-1.5 py-0.5 text-xs font-medium text-warning-700">
            admin
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/admin/users"
            className="text-default-500 hover:text-default-900"
          >
            Users
          </Link>
          <Link
            href="/admin/rooms"
            className="text-default-500 hover:text-default-900"
          >
            Rooms
          </Link>
          <ThemeToggle />
          <Link
            href="/"
            className="text-default-500 hover:text-default-900"
          >
            ← Back to home
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
    </div>
  );
}
