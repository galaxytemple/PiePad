import { adminDeleteRoomAction } from "@/app/actions/rooms";
import { timeAgo } from "@/lib/relative-time";
import { listAllRooms } from "@piepad/db";
import { Button, Card } from "@heroui/react";
import Link from "next/link";

export default async function AdminRoomsPage() {
  const rooms = await listAllRooms(200);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Rooms</h1>
        <span className="text-sm text-zinc-500">{rooms.length} total</span>
      </div>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-content2 text-left text-xs uppercase tracking-wide text-default-500">
            <tr>
              <th className="px-4 py-3">Room</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Last active</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {rooms.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {r.hasPassword ? <span aria-hidden>🔒</span> : null}
                    <Link
                      href={`/pad/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                  </div>
                  <p className="font-mono text-xs text-default-400">{r.id}</p>
                </td>
                <td className="px-4 py-3 text-default-700">
                  {r.creatorName ?? r.creatorEmail ?? "(unknown)"}
                  {r.creatorEmail ? (
                    <p className="text-xs text-default-500">{r.creatorEmail}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-default-500">
                  {timeAgo(r.createdAt)}
                </td>
                <td className="px-4 py-3 text-default-500">
                  {timeAgo(r.lastAccessedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <form action={adminDeleteRoomAction} className="inline">
                    <input type="hidden" name="roomId" value={r.id} />
                    <Button type="submit" size="sm" variant="danger-soft">
                      Delete
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
            {rooms.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-default-500">
                  No rooms yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
