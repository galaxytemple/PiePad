"use client";

import dynamic from "next/dynamic";

// y-monaco / monaco-editor touch `window` at module-eval time, so the inner
// editor must only be loaded in the browser.
const PadEditorInner = dynamic(
  () => import("./PadEditorInner").then((m) => m.PadEditorInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center text-sm text-zinc-500">
        Loading editor…
      </div>
    ),
  }
);

export interface PadEditorProps {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  isOwner: boolean;
  user: { name: string; avatarUrl: string | null };
}

export function PadEditor(props: PadEditorProps) {
  return <PadEditorInner {...props} />;
}
