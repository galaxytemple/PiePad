"use client";

import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreatePadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleClick = () => {
    setBusy(true);
    router.push(`/pad/${nanoid(12)}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
    >
      {busy ? "Opening..." : "Create Pad"}
    </button>
  );
}
