import { auth, signOut } from "@/auth";
import { CreatePadButton } from "@/components/CreatePadButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { timeAgo } from "@/lib/relative-time";
import {
  getUserById,
  listRoomsCreatedByUser,
  listRoomsVisitedByUser,
} from "@piepad/db";
import { Avatar, Button, Card } from "@heroui/react";
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
  const displayName = profile?.nickname ?? profile?.name ?? user.email ?? "";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-divider bg-content1 px-6 py-3">
        <a href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">PiePad</span>
        </a>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <CreatePadButton />
          {user.isAdmin ? (
            <a
              href="/admin/users"
              className="text-sm text-default-500 hover:text-default-900"
            >
              Admin
            </a>
          ) : null}
          <a
            href="/me"
            className="flex items-center gap-2 rounded-full border border-divider bg-content1 px-3 py-1 text-sm transition-colors hover:bg-content2"
          >
            <Avatar size="sm">
              {user.image ? <Avatar.Image src={user.image} /> : null}
              <Avatar.Fallback>
                {displayName[0]?.toUpperCase() ?? "?"}
              </Avatar.Fallback>
            </Avatar>
            <span>{displayName}</span>
            {user.isAdmin ? (
              <span className="rounded bg-warning-100 px-1.5 py-0.5 text-xs font-medium text-warning-700">
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
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
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
    <Card>
      <Card.Header className="flex items-center justify-between">
        <Card.Title className="text-sm font-semibold">{title}</Card.Title>
        <span className="text-xs text-default-400">{rooms.length}</span>
      </Card.Header>
      <Card.Content className="p-0">
        {rooms.length === 0 ? (
          <p className="p-6 text-sm text-default-500">{emptyMessage}</p>
        ) : (
          <ul className="divide-y divide-divider">
            {rooms.map((r) => (
              <li key={r.id}>
                <a
                  href={`/pad/${r.id}`}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-content2"
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
                  <span className="ml-3 shrink-0 text-xs text-default-500">
                    {r.relativeLabel} {r.relativeTime}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
}
