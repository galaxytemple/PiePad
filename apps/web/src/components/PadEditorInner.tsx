"use client";

import { Editor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { MonacoBinding } from "y-monaco";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:1234";

const PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
] as const;

const ADJECTIVES = ["Quick", "Lazy", "Brave", "Calm", "Wild", "Bright"] as const;
const ANIMALS = ["Otter", "Fox", "Owl", "Cat", "Wolf", "Bear"] as const;

type AwarenessUser = { name: string; color: string };
type ConnectionStatus = "connecting" | "connected" | "disconnected";

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  connecting: "bg-yellow-100 text-yellow-700",
  connected: "bg-green-100 text-green-700",
  disconnected: "bg-red-100 text-red-700",
};

function pickRandom<T>(items: readonly T[]): T {
  const idx = Math.floor(Math.random() * items.length);
  return items[idx] as T;
}

function makeAnonUser(): AwarenessUser {
  return {
    name: `${pickRandom(ADJECTIVES)}-${pickRandom(ANIMALS)}`,
    color: pickRandom(PALETTE),
  };
}

export function PadEditorInner({ roomId }: { roomId: string }) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [users, setUsers] = useState<AwarenessUser[]>([]);

  const localUser = useMemo<AwarenessUser>(() => makeAnonUser(), []);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, roomId, ydoc);
    provider.awareness.setLocalStateField("user", localUser);

    const handleStatus = (event: { status: ConnectionStatus }) => {
      setStatus(event.status);
    };

    const refreshUsers = () => {
      const list: AwarenessUser[] = [];
      for (const state of provider.awareness.getStates().values()) {
        const candidate = (state as { user?: unknown }).user;
        if (
          candidate &&
          typeof (candidate as AwarenessUser).name === "string" &&
          typeof (candidate as AwarenessUser).color === "string"
        ) {
          list.push(candidate as AwarenessUser);
        }
      }
      setUsers(list);
    };

    provider.on("status", handleStatus);
    provider.awareness.on("change", refreshUsers);
    refreshUsers();

    ydocRef.current = ydoc;
    providerRef.current = provider;

    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
      provider.awareness.off("change", refreshUsers);
      provider.off("status", handleStatus);
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
    };
  }, [roomId, localUser]);

  const handleEditorMount = (instance: editor.IStandaloneCodeEditor) => {
    const ydoc = ydocRef.current;
    const provider = providerRef.current;
    const model = instance.getModel();
    if (!ydoc || !provider || !model) return;

    const ytext = ydoc.getText("content");
    bindingRef.current = new MonacoBinding(
      ytext,
      model,
      new Set([instance]),
      provider.awareness
    );
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-zinc-500">/pad/{roomId}</span>
          <span
            className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}
          >
            {status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {users.map((u, i) => (
            <span
              key={`${u.name}-${i}`}
              className="flex items-center gap-1.5 text-sm"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: u.color }}
              />
              {u.name}
            </span>
          ))}
        </div>
      </header>
      <div className="flex-1">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          theme="vs-dark"
          onMount={handleEditorMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
