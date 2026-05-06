import { adminDeleteRoomAction } from "@/app/actions/rooms";
import { timeAgo } from "@/lib/relative-time";
import { listAllRooms } from "@piepad/db";
import Link from "next/link";

export default async function AdminRoomsPage() {
  const rooms = await listAllRooms(200);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Rooms</h1>
        <span className="text-sm text-zinc-500">{rooms.length} total</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
            <tr>
              <th className="px-4 py-3">Room</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Last active</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
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
                  <p className="font-mono text-xs text-zinc-400">{r.id}</p>
                </td>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  {r.creatorName ?? r.creatorEmail ?? "(unknown)"}
                  {r.creatorEmail ? (
                    <p className="text-xs text-zinc-500">{r.creatorEmail}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {timeAgo(r.createdAt)}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {timeAgo(r.lastAccessedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <form action={adminDeleteRoomAction} className="inline">
                    <input type="hidden" name="roomId" value={r.id} />
                    <button
                      type="submit"
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {rooms.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-zinc-500">
                  No rooms yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
