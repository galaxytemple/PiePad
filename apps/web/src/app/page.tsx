import { auth, signOut } from "@/auth";
import { CreatePadButton } from "@/components/CreatePadButton";
import { timeAgo } from "@/lib/relative-time";
import {
  getUserById,
  listRoomsCreatedByUser,
  listRoomsVisitedByUser,
} from "@piepad/db";
import { redirect } from "next/navigation";

interface RoomItem {
  id: string;
  name: string;
  hasPassword: boolean;
  relativeLabel: string;
  relativeTime: string;
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = Number(session.user.id);

  const [createdRooms, visitedRooms, profile] = await Promise.all([
    listRoomsCreatedByUser(userId, 20),
    listRoomsVisitedByUser(userId, 20),
    getUserById(userId),
  ]);

  const myPads: RoomItem[] = createdRooms.map((r) => ({
    id: r.id,
    name: r.name,
    hasPassword: r.hasPassword,
    relativeLabel: "active",
    relativeTime: timeAgo(r.lastAccessedAt),
  }));

  const visited: RoomItem[] = visitedRooms.map((r) => ({
    id: r.id,
    name: r.name,
    hasPassword: r.hasPassword,
    relativeLabel: "visited",
    relativeTime: timeAgo(r.lastVisitedAt),
  }));

  const user = session.user;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <a href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">PiePad</span>
        </a>
        <div className="flex items-center gap-4">
          <CreatePadButton />
          {user.isAdmin ? (
            <a
              href="/admin/users"
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Admin
            </a>
          ) : null}
          <a
            href="/me"
            className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                className="h-6 w-6 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <span>
              {profile?.nickname ?? profile?.name ?? user.email}
            </span>
            {user.isAdmin ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                admin
              </span>
            ) : null}
          </a>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <div className="grid gap-6 md:grid-cols-2">
          <RoomColumn
            title="My pads"
            rooms={myPads}
            emptyMessage="No pads yet — create your first one above."
          />
          <RoomColumn
            title="Recently visited"
            rooms={visited}
            emptyMessage="No visit history yet."
          />
        </div>
      </main>
    </div>
  );
}

function RoomColumn({
  title,
  rooms,
  emptyMessage,
}: {
  title: string;
  rooms: RoomItem[];
  emptyMessage: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {title}
        </span>
        <span className="text-xs text-zinc-400">{rooms.length}</span>
      </h2>
      {rooms.length === 0 ? (
        <p className="p-6 text-sm text-zinc-500">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rooms.map((r) => (
            <li key={r.id}>
              <a
                href={`/pad/${r.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {r.hasPassword ? (
                    <span title="Password protected" aria-label="locked">
                      🔒
                    </span>
                  ) : null}
                  <span className="truncate text-sm font-medium">
                    {r.name}
                  </span>
                </span>
                <span className="ml-3 shrink-0 text-xs text-zinc-500">
                  {r.relativeLabel} {r.relativeTime}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
