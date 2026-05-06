import { auth } from "@/auth";
import { PadEditor } from "@/components/PadEditor";
import {
  ensureRoom,
  getRoomById,
  getUserById,
  upsertRoomVisit,
} from "@piepad/db";
import { notFound, redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ roomId: string }>;
}

export default async function PadPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) notFound();

  const { roomId } = await params;

  // First viewer of a never-seen room becomes its creator. MERGE makes this
  // idempotent so a race with another tab is harmless.
  await ensureRoom(roomId, roomId, userId);
  await upsertRoomVisit(userId, roomId);

  const [room, profile] = await Promise.all([
    getRoomById(roomId),
    getUserById(userId),
  ]);
  if (!room) notFound();

  const isOwner = room.createdByUserId === userId;
  // Re-fetch profile so a nickname edit appears in awareness without
  // forcing the user to sign out and back in (JWT-cached fields are stale).
  const displayName =
    profile?.nickname ?? profile?.name ?? session.user.email ?? "Anon";
  const avatarUrl = profile?.avatarUrl ?? session.user.image ?? null;

  return (
    <PadEditor
      roomId={roomId}
      roomName={room.name}
      isOwner={isOwner}
      user={{ name: displayName, avatarUrl }}
    />
  );
}
