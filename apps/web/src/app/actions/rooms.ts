"use server";

import { auth } from "@/auth";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import {
  clearRoomUnlockCookie,
  setRoomUnlockCookie,
} from "@/lib/room-unlock";
import { evictRoomFromWs } from "@/lib/ws-internal";
import {
  deleteRoom,
  ensureRoom,
  getRoomById,
  getRoomPasswordHash,
  renameRoom,
  setRoomPasswordHash,
  upsertRoomVisit,
} from "@piepad/db";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function requireSession(): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) throw new Error("invalid_session");
  return userId;
}

async function requireOwner(roomId: string, userId: number): Promise<void> {
  const room = await getRoomById(roomId);
  if (!room) throw new Error("not_found");
  if (room.createdByUserId !== userId) throw new Error("forbidden");
}

export type CreateRoomResult =
  | { ok: true; roomId: string }
  | { ok: false; error: string };

export async function createRoomAction(
  formData: FormData
): Promise<CreateRoomResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "unauthorized" };
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) return { ok: false, error: "invalid_session" };

  const rawName = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const roomId = nanoid(12);
  const name = rawName.length > 0 ? rawName.slice(0, 200) : roomId;

  await ensureRoom(roomId, name, userId);
  if (password.length > 0) {
    const hash = await hashPassword(password);
    await setRoomPasswordHash(roomId, hash);
  }
  await upsertRoomVisit(userId, roomId);

  return { ok: true, roomId };
}

export async function renameRoomAction(formData: FormData): Promise<void> {
  const userId = await requireSession();
  const roomId = String(formData.get("roomId") ?? "");
  const name = String(formData.get("name") ?? "");
  if (!roomId) throw new Error("missing_roomId");
  await requireOwner(roomId, userId);
  await renameRoom(roomId, name);
  revalidatePath(`/pad/${roomId}`);
  revalidatePath("/");
}

export async function setRoomPasswordAction(
  formData: FormData
): Promise<void> {
  const userId = await requireSession();
  const roomId = String(formData.get("roomId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!roomId) throw new Error("missing_roomId");
  await requireOwner(roomId, userId);
  if (password.length === 0) {
    await setRoomPasswordHash(roomId, null);
  } else {
    const hash = await hashPassword(password);
    await setRoomPasswordHash(roomId, hash);
  }
  // Other viewers' unlock cookies stay valid; that's fine — we only re-gate
  // brand-new sessions. Owner never needed a cookie anyway.
  revalidatePath(`/pad/${roomId}`);
  revalidatePath("/");
}

export async function adminDeleteRoomAction(
  formData: FormData
): Promise<void> {
  const session = await auth();
  if (!session?.user?.isAdmin) throw new Error("forbidden");
  const roomId = String(formData.get("roomId") ?? "");
  if (!roomId) throw new Error("missing_roomId");
  await evictRoomFromWs(roomId, "admin_deleted");
  await deleteRoom(roomId);
  revalidatePath("/admin/rooms");
  revalidatePath("/");
}

export async function deleteRoomAction(formData: FormData): Promise<void> {
  const userId = await requireSession();
  const roomId = String(formData.get("roomId") ?? "");
  if (!roomId) throw new Error("missing_roomId");
  await requireOwner(roomId, userId);

  // Notify ws first so currently-connected viewers see meta.deleted before
  // the row disappears (and Yjs snapshot writes start failing on the FK).
  await evictRoomFromWs(roomId, "owner_deleted");
  await deleteRoom(roomId);
  await clearRoomUnlockCookie(roomId);
  revalidatePath("/");
  redirect("/?deleted=1");
}

export async function unlockRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) throw new Error("invalid_session");

  const roomId = String(formData.get("roomId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!roomId) throw new Error("missing_roomId");

  const hash = await getRoomPasswordHash(roomId);
  if (!hash) {
    // No password set — let the user proceed.
    redirect(`/pad/${roomId}`);
  }
  const ok = await verifyPassword(password, hash);
  if (!ok) {
    redirect(`/pad/${roomId}?password_error=1`);
  }
  await setRoomUnlockCookie(roomId, userId);
  redirect(`/pad/${roomId}`);
}
