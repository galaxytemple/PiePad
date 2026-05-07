"use client";

import { Editor } from "@monaco-editor/react";
import { Button } from "@heroui/react";
import type { editor } from "monaco-editor";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonacoBinding } from "y-monaco";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { DEFAULT_LANGUAGE_ID, findLanguage, LANGUAGES } from "@/lib/languages";
import { RoomSettings } from "@/components/RoomSettings";
import { Stopwatch } from "@/components/Stopwatch";
import { ThemeToggle } from "@/components/ThemeToggle";

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

type AwarenessUser = { name: string; color: string; avatarUrl: string | null };
type ConnectionStatus = "connecting" | "connected" | "disconnected";

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  connecting: "bg-yellow-100 text-yellow-700",
  connected: "bg-green-100 text-green-700",
  disconnected: "bg-red-100 text-red-700",
};

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  compileStderr: string | null;
  durationMs: number;
}

interface RunError {
  error: string;
  message?: string;
  retryAfterSec?: number;
}

function pickRandom<T>(items: readonly T[]): T {
  const idx = Math.floor(Math.random() * items.length);
  return items[idx] as T;
}

// Pick a printable single-letter initial from a display name. Whitespace,
// punctuation, and emoji-only names fall back to "?". JSON.stringify in
// the caller takes care of CSS escaping.
function pickInitial(name: string | undefined | null): string {
  if (!name) return "?";
  for (const ch of name.trim()) {
    if (/^[\p{L}\p{N}]$/u.test(ch)) return ch.toUpperCase();
  }
  return "?";
}

// Stable color per logged-in identity so my pill colour does not flicker
// across reconnects within the same tab. Hash the name into the palette.
function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx] as string;
}

interface PadEditorInnerProps {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  isOwner: boolean;
  user: { name: string; avatarUrl: string | null };
}

interface DeletedNotice {
  reason?: string;
  at?: number;
}

export function PadEditorInner({
  roomId,
  roomName,
  hasPassword,
  isOwner,
  user: viewer,
}: PadEditorInnerProps) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [users, setUsers] = useState<AwarenessUser[]>([]);
  const [languageId, setLanguageId] = useState<string>(DEFAULT_LANGUAGE_ID);
  const [argsText, setArgsText] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [output, setOutput] = useState<RunResult | RunError | null>(null);
  const [deleted, setDeleted] = useState<DeletedNotice | null>(null);

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "light" ? "vs" : "vs-dark";

  const localUser = useMemo<AwarenessUser>(
    () => ({
      name: viewer.name,
      color: colorFor(viewer.name),
      avatarUrl: viewer.avatarUrl,
    }),
    [viewer.name, viewer.avatarUrl]
  );
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const metaRef = useRef<Y.Map<unknown> | null>(null);

  const language = findLanguage(languageId);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, roomId, ydoc);
    provider.awareness.setLocalStateField("user", localUser);

    const meta = ydoc.getMap("meta");
    metaRef.current = meta;

    const handleStatus = (event: { status: ConnectionStatus }) => {
      setStatus(event.status);
    };

    const refreshUsers = () => {
      const list: AwarenessUser[] = [];
      for (const state of provider.awareness.getStates().values()) {
        const candidate = (state as { user?: Partial<AwarenessUser> }).user;
        if (
          candidate &&
          typeof candidate.name === "string" &&
          typeof candidate.color === "string"
        ) {
          list.push({
            name: candidate.name,
            color: candidate.color,
            avatarUrl:
              typeof candidate.avatarUrl === "string"
                ? candidate.avatarUrl
                : null,
          });
        }
      }
      setUsers(list);
    };

    const syncMetaFromYjs = () => {
      const lang = meta.get("language");
      if (typeof lang === "string") setLanguageId(lang);
      const del = meta.get("deleted");
      if (del && typeof del === "object") {
        setDeleted(del as DeletedNotice);
      }
    };

    provider.on("status", handleStatus);
    provider.awareness.on("change", refreshUsers);
    meta.observe(syncMetaFromYjs);

    refreshUsers();
    syncMetaFromYjs();

    ydocRef.current = ydoc;
    providerRef.current = provider;

    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
      meta.unobserve(syncMetaFromYjs);
      provider.awareness.off("change", refreshUsers);
      provider.off("status", handleStatus);
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      metaRef.current = null;
    };
  }, [roomId, localUser]);

  // y-monaco wires up decoration classes (.yRemoteSelection-<clientID>,
  // .yRemoteSelectionHead-<clientID>) but ships no CSS. Inject per-client
  // colour rules off the awareness state so each remote caret + selection
  // takes that user's pill colour. globals.css covers the base shape.
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const styleEl = document.createElement("style");
    styleEl.dataset.pad = roomId;
    document.head.appendChild(styleEl);

    const update = () => {
      const localId = provider.awareness.clientID;
      const blocks: string[] = [];
      for (const [clientId, state] of provider.awareness.getStates()) {
        if (clientId === localId) continue;
        const u = (state as { user?: { name?: string; color?: string } }).user;
        const color = typeof u?.color === "string" ? u.color : "#888";
        const initial = pickInitial(u?.name);
        blocks.push(
          `.yRemoteSelection-${clientId} { background-color: ${color}55; }
           .yRemoteSelectionHead-${clientId} { border-left-color: ${color}; }
           .yRemoteSelectionHead-${clientId}::after {
             background: ${color};
             content: ${JSON.stringify(initial)};
           }`
        );
      }
      styleEl.textContent = blocks.join("\n");
    };

    provider.awareness.on("change", update);
    update();
    return () => {
      provider.awareness.off("change", update);
      styleEl.remove();
    };
  }, [roomId]);

  // Belt-and-suspenders: also poll room status. The Yjs meta.deleted
  // broadcast is the fast path, but a network blip during the broadcast
  // (or a ws restart) could swallow it. Both paths converge on setDeleted.
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
          return;
        }
      } catch {
        // network blip — try again on next tick
      }
    };
    const id = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [roomId, deleted]);

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

  const updateLanguage = useCallback((id: string) => {
    metaRef.current?.set("language", id);
  }, []);

  const runCode = useCallback(async () => {
    if (!language.piston) return;
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const code = ydoc.getText("content").toString();
    const args = argsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    setRunning(true);
    setOutput(null);
    const startedAt = performance.now();
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: language.piston.language,
          version: language.piston.version,
          code,
          args,
        }),
      });
      const json = (await res.json()) as RunResult | RunError;
      const durationMs = Math.round(performance.now() - startedAt);
      if ("error" in json) {
        setOutput(json);
      } else {
        setOutput({ ...json, durationMs });
      }
    } catch (err) {
      setOutput({
        error: "client_error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }, [language, argsText]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-divider bg-content1 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-default-400 hover:text-default-700"
            aria-label="Home"
          >
            ←
          </Link>
          <span className="flex items-center gap-1 text-sm font-medium">
            {hasPassword ? (
              <span title="Private — password required" aria-label="locked">
                🔒
              </span>
            ) : null}
            {roomName}
          </span>
          {isOwner ? (
            <span className="rounded bg-primary-100 px-1.5 py-0.5 text-xs text-primary-700">
              owner
            </span>
          ) : null}
          {isOwner && !deleted ? (
            <RoomSettings
              roomId={roomId}
              roomName={roomName}
              hasPassword={hasPassword}
            />
          ) : null}
          <span className="font-mono text-xs text-default-400">{roomId}</span>
          <span
            className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}
          >
            {status}
          </span>
          <select
            value={languageId}
            onChange={(e) => updateLanguage(e.target.value)}
            className="rounded border border-divider bg-content1 px-2 py-1 text-sm"
            aria-label="Language"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.label}
                {lang.piston ? "" : " (no run)"}
              </option>
            ))}
          </select>
          <Stopwatch />
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-3">
          {users.map((u, i) => (
            <span
              key={`${u.name}-${i}`}
              className="flex items-center gap-1.5 text-sm"
            >
              {u.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={u.avatarUrl}
                  alt=""
                  className="h-5 w-5 rounded-full ring-2"
                  style={{ boxShadow: `0 0 0 2px ${u.color}` }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: u.color }}
                />
              )}
              {u.name}
            </span>
          ))}
        </div>
      </header>

      {deleted ? (
        <div className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This pad was deleted by the owner. The content shown is read-only —
          select and copy anything you want to keep before leaving.
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language={languageId}
          theme={monacoTheme}
          onMount={handleEditorMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            readOnly: !!deleted,
            domReadOnly: !!deleted,
          }}
        />
      </div>

      <div className="flex items-start gap-2 border-t border-divider bg-content2 px-4 py-2">
        <div className="flex flex-1 flex-col gap-1">
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder={
              language.piston
                ? "args — one per line (passed as command-line arguments)"
                : `${language.label} is not runnable`
            }
            disabled={!language.piston}
            rows={2}
            className="resize-none rounded border border-divider bg-content1 px-3 py-1.5 font-mono text-sm disabled:opacity-50"
          />
          {language.piston ? (
            <span className="text-[11px] text-default-500">
              {language.piston.argsHint}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            onPress={runCode}
            isDisabled={!language.piston || running}
            variant="primary"
            size="sm"
          >
            {running ? "Running…" : "Run ▶"}
          </Button>
          <Button
            type="button"
            onPress={() => setOutput(null)}
            isDisabled={running || output === null}
            variant="outline"
            size="sm"
          >
            Clear
          </Button>
        </div>
      </div>

      <OutputPanel result={output} />
    </div>
  );
}

function OutputPanel({ result }: { result: RunResult | RunError | null }) {
  if (!result) {
    return (
      <div className="h-40 overflow-auto border-t border-zinc-200 bg-zinc-950 px-4 py-2 font-mono text-xs text-zinc-500 dark:border-zinc-800">
        (no output yet — press Run)
      </div>
    );
  }
  if ("error" in result) {
    return <ErrorPanel result={result} />;
  }
  return (
    <div className="h-40 overflow-auto border-t border-zinc-200 bg-zinc-950 px-4 py-2 font-mono text-xs dark:border-zinc-800">
      <div className="mb-1 text-zinc-500">
        exit {result.code}
        {result.signal ? ` (signal ${result.signal})` : ""} · {result.durationMs}ms
      </div>
      {result.compileStderr ? (
        <pre className="whitespace-pre-wrap text-amber-400">{result.compileStderr}</pre>
      ) : null}
      {result.stdout ? (
        <pre className="whitespace-pre-wrap text-zinc-100">{result.stdout}</pre>
      ) : null}
      {result.stderr ? (
        <pre className="whitespace-pre-wrap text-red-400">{result.stderr}</pre>
      ) : null}
      {!result.stdout && !result.stderr && !result.compileStderr ? (
        <span className="text-zinc-500">(no output)</span>
      ) : null}
    </div>
  );
}

const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  piston_unreachable:
    "Code execution server is starting up or unreachable. Try again in a few seconds.",
  piston_error: "Code execution server returned an error.",
  piston_rejected: "Code execution server rejected the request.",
  piston_invalid_response:
    "Code execution server returned an unexpected response.",
  rate_limited: "You're running code too fast.",
  timeout: "Request timed out before the server responded.",
  invalid_request: "Invalid request payload.",
  invalid_json: "Invalid request body.",
  client_error: "Could not reach the API.",
};

function ErrorPanel({ result }: { result: RunError }) {
  const friendly =
    FRIENDLY_ERROR_MESSAGES[result.error] ?? "Something went wrong.";
  const isWarmup = result.error === "piston_unreachable";
  return (
    <div className="h-40 overflow-auto border-t border-zinc-200 bg-zinc-950 px-4 py-2 font-mono text-xs dark:border-zinc-800">
      <div
        className={`font-semibold ${isWarmup ? "text-amber-300" : "text-red-400"}`}
      >
        {friendly}
      </div>
      {result.retryAfterSec !== undefined ? (
        <div className="text-zinc-400">
          Retry in {result.retryAfterSec}s.
        </div>
      ) : null}
      {result.message ? (
        <div className="mt-1 text-zinc-500">{result.message}</div>
      ) : null}
      <div className="mt-1 text-[10px] text-zinc-600">
        ({result.error})
      </div>
    </div>
  );
}
