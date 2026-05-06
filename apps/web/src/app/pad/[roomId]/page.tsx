import { auth } from "@/auth";
import { PadEditor } from "@/components/PadEditor";
import { PasswordPrompt } from "@/components/PasswordPrompt";
import { isRoomUnlocked } from "@/lib/room-unlock";
import {
  ensureRoom,
  getRoomById,
  getUserById,
  upsertRoomVisit,
} from "@piepad/db";
import { notFound, redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ password_error?: string }>;
}

export default async function PadPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) notFound();

  const [{ roomId }, { password_error }] = await Promise.all([
    params,
    searchParams,
  ]);

  // First viewer of a never-seen room becomes its creator. MERGE makes this
  // idempotent so a race with another tab is harmless.
  await ensureRoom(roomId, roomId, userId);

  const [room, profile] = await Promise.all([
    getRoomById(roomId),
    getUserById(userId),
  ]);
  if (!room) notFound();

  const isOwner = room.createdByUserId === userId;

  // Password gate. Owners always bypass.
  if (room.hasPassword && !isOwner) {
    const unlocked = await isRoomUnlocked(roomId, userId);
    if (!unlocked) {
      return (
        <PasswordPrompt
          roomId={roomId}
          roomName={room.name}
          showError={password_error === "1"}
        />
      );
    }
  }

  // Only count the visit once we actually let them in.
  await upsertRoomVisit(userId, roomId);

  const displayName =
    profile?.nickname ?? profile?.name ?? session.user.email ?? "Anon";
  const avatarUrl = profile?.avatarUrl ?? session.user.image ?? null;

  return (
    <PadEditor
      roomId={roomId}
      roomName={room.name}
      hasPassword={room.hasPassword}
      isOwner={isOwner}
      user={{ name: displayName, avatarUrl }}
    />
  );
}
