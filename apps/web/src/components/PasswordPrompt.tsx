import { unlockRoomAction } from "@/app/actions/rooms";
import Link from "next/link";

interface Props {
  roomId: string;
  roomName: string;
  showError: boolean;
}

export function PasswordPrompt({ roomId, roomName, showError }: Props) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          <span aria-hidden>🔒</span>
          <span className="text-sm">Password required</span>
        </div>
        <h1 className="mb-1 truncate text-xl font-semibold">{roomName}</h1>
        <p className="mb-4 text-xs text-zinc-500">
          The owner has set a password on this pad.
        </p>

        <form action={unlockRoomAction} className="space-y-3">
          <input type="hidden" name="roomId" value={roomId} />
          <input
            name="password"
            type="password"
            autoFocus
            required
            placeholder="Pad password"
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
          {showError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              Wrong password. Try again.
            </p>
          ) : null}
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ← Home
            </Link>
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
