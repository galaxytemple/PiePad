"use server";

import { auth } from "@/auth";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { setRoomUnlockCookie } from "@/lib/room-unlock";
import {
  ensureRoom,
  getRoomPasswordHash,
  setRoomPasswordHash,
  upsertRoomVisit,
} from "@piepad/db";
import { nanoid } from "nanoid";
import { redirect } from "next/navigation";

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
