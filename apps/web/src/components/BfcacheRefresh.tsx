"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// When a user navigates away to /pad/<id> and then hits Back, the browser's
// bfcache restores the previous home page from a snapshot — no server roundtrip,
// so visit timestamps and "rooms I've been in" are stale. Detect the restore
// (event.persisted === true) and ask the App Router to re-run server components.
export function BfcacheRefresh(): null {
  const router = useRouter();
  useEffect(() => {
    const handler = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    window.addEventListener("pageshow", handler);
    return () => window.removeEventListener("pageshow", handler);
  }, [router]);
  return null;
}
