import { timeAgo } from "@/lib/relative-time";
import { listAllUsers } from "@piepad/db";

export default async function AdminUsersPage() {
  const users = await listAllUsers(200);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <span className="text-sm text-zinc-500">{users.length} total</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Last login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatarUrl}
                        alt=""
                        className="h-7 w-7 rounded-full"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-500 dark:bg-zinc-800">
                        {(u.nickname ?? u.name ?? u.email)[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {u.nickname ?? u.name ?? "—"}
                      </p>
                      {u.nickname && u.name && u.nickname !== u.name ? (
                        <p className="truncate text-xs text-zinc-500">
                          {u.name}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  {u.email}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {u.primaryProvider ?? "—"}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {timeAgo(u.createdAt)}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-zinc-500">
                  No users yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
