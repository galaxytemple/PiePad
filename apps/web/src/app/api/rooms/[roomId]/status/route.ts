import { auth } from "@/auth";
import { getRoomById } from "@piepad/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ roomId: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { roomId } = await ctx.params;
  const room = await getRoomById(roomId);
  if (!room) {
    return NextResponse.json(
      { exists: false, reason: "not_found" },
      { status: 404 }
    );
  }

  const userId = Number(session.user.id);
  return NextResponse.json({
    exists: true,
    name: room.name,
    hasPassword: room.hasPassword,
    isOwner: room.createdByUserId === userId,
  });
}
