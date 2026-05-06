"use client";

import {
  deleteRoomAction,
  renameRoomAction,
  setRoomPasswordAction,
} from "@/app/actions/rooms";
import { useEffect, useState } from "react";

interface Props {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
}

export function RoomSettings({ roomId, roomName, hasPassword }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="Room settings"
      >
        Settings
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md space-y-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pad settings</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <RenameSection roomId={roomId} initialName={roomName} />
            <PasswordSection roomId={roomId} hasPassword={hasPassword} />
            <DeleteSection roomId={roomId} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function RenameSection({
  roomId,
  initialName,
}: {
  roomId: string;
  initialName: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Rename
      </h3>
      <form action={renameRoomAction} className="flex items-center gap-2">
        <input type="hidden" name="roomId" value={roomId} />
        <input
          name="name"
          type="text"
          defaultValue={initialName}
          maxLength={200}
          required
          className="flex-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Save
        </button>
      </form>
    </section>
  );
}

function PasswordSection({
  roomId,
  hasPassword,
}: {
  roomId: string;
  hasPassword: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Password
      </h3>
      <p className="text-xs text-zinc-500">
        {hasPassword
          ? "This pad is currently locked. Submit a new password to change it, or leave blank and submit to remove it."
          : "Add a password to require it for non-owner visitors."}
      </p>
      <form action={setRoomPasswordAction} className="flex items-center gap-2">
        <input type="hidden" name="roomId" value={roomId} />
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={hasPassword ? "New password (blank = remove)" : "Password"}
          className="flex-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Save
        </button>
      </form>
    </section>
  );
}

function DeleteSection({ roomId }: { roomId: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 className="text-sm font-medium text-red-600 dark:text-red-400">
        Delete pad
      </h3>
      <p className="text-xs text-zinc-500">
        Permanent. Removes the document, snapshots, and visit history. Anyone
        currently editing will be evicted to read-only.
      </p>
      {confirming ? (
        <form action={deleteRoomAction} className="flex items-center gap-2">
          <input type="hidden" name="roomId" value={roomId} />
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Yes, delete
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Delete pad
        </button>
      )}
    </section>
  );
}
