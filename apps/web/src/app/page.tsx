import { auth, signOut } from "@/auth";
import { CreatePadButton } from "@/components/CreatePadButton";

export default async function HomePage() {
  const session = await auth();
  const user = session?.user;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-5xl font-bold tracking-tight">PiePad</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Real-time collaborative notepad with code execution
      </p>

      {user ? (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              className="h-7 w-7 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <span>
            {user.nickname ?? user.name ?? user.email}
            {user.isAdmin ? (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                admin
              </span>
            ) : null}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}

      <CreatePadButton />
    </main>
  );
}
