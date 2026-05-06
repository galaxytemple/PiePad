import { timeAgo } from "@/lib/relative-time";
import { listAllUsers } from "@piepad/db";
import { Avatar, Card } from "@heroui/react";

export default async function AdminUsersPage() {
  const users = await listAllUsers(200);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <span className="text-sm text-default-500">{users.length} total</span>
      </div>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-content2 text-left text-xs uppercase tracking-wide text-default-500">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Last login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar size="sm">
                      {u.avatarUrl ? <Avatar.Image src={u.avatarUrl} /> : null}
                      <Avatar.Fallback>
                        {(u.nickname ?? u.name ?? u.email)[0]?.toUpperCase()}
                      </Avatar.Fallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {u.nickname ?? u.name ?? "—"}
                      </p>
                      {u.nickname && u.name && u.nickname !== u.name ? (
                        <p className="truncate text-xs text-default-500">
                          {u.name}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-default-700">{u.email}</td>
                <td className="px-4 py-3 text-default-500">
                  {u.primaryProvider ?? "—"}
                </td>
                <td className="px-4 py-3 text-default-500">
                  {timeAgo(u.createdAt)}
                </td>
                <td className="px-4 py-3 text-default-500">
                  {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-12 text-center text-default-500"
                >
                  No users yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
