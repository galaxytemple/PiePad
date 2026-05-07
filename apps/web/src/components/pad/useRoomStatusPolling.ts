"use client";

import { useEffect } from "react";
import type { DeletedNotice } from "./types";

const POLL_INTERVAL_MS = 15_000;

// Belt-and-suspenders against the Yjs meta.deleted broadcast: a network
// blip or ws restart could swallow it. /api/rooms/:id/status returns 404
// when the row is gone, which we surface via setDeleted.
export function useRoomStatusPolling(
  roomId: string,
  deleted: DeletedNotice | null,
  setDeleted: (notice: DeletedNotice) => void
): void {
  useEffect(() => {
    if (deleted) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/status`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.status === 404) {
          setDeleted({ reason: "not_found", at: Date.now() });
        }
      } catch {
        // network blip — try again on next tick
      }
    };
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [roomId, deleted, setDeleted]);
}
