import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getUserById, updateUserNickname } from "@piepad/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

async function saveNickname(formData: FormData): Promise<void> {
  "use server";
  // Re-derive identity from the session inside the action — never trust
  // closure-captured ids for authorisation. A user can only ever rename
  // themselves.
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) throw new Error("invalid session");

  const next = String(formData.get("nickname") ?? "").slice(0, 100);
  await updateUserNickname(userId, next);
  revalidatePath("/");
  revalidatePath("/me");
}

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = Number(session.user.id);

  const profile = await getUserById(userId);
  if (!profile) redirect("/login");

  const displayedName = profile.nickname ?? profile.name ?? profile.email;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">PiePad</span>
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 p-6">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Profile</h1>

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-4 border-b border-zinc-200 p-6 dark:border-zinc-800">
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt=""
                className="h-16 w-16 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-2xl text-zinc-500 dark:bg-zinc-800">
                {displayedName[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{displayedName}</p>
              <p className="truncate text-sm text-zinc-500">{profile.email}</p>
              {session.user.isAdmin ? (
                <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                  admin
                </span>
              ) : null}
            </div>
          </div>

          <form action={saveNickname} className="space-y-3 p-6">
            <label
              htmlFor="nickname"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Nickname
            </label>
            <p className="text-xs text-zinc-500">
              Shown to other people in pads instead of your Google name. Leave
              blank to fall back to {profile.name ?? profile.email}.
            </p>
            <input
              id="nickname"
              name="nickname"
              type="text"
              maxLength={100}
              defaultValue={profile.nickname ?? ""}
              placeholder={profile.name ?? "Your nickname"}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save
            </button>
          </form>
        </section>

        <section className="mt-6">
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="rounded border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              Sign out
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
