"use client";

import { Editor } from "@monaco-editor/react";
import { Button } from "@heroui/react";
import type { editor } from "monaco-editor";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { MonacoBinding } from "y-monaco";
import { findLanguage, LANGUAGES } from "@/lib/languages";
import { LockIcon } from "@/components/icons";
import { RemoteCursorStyles } from "@/components/pad/RemoteCursorStyles";
import { RunOutput } from "@/components/pad/RunOutput";
import { GraphView } from "@/components/pad/GraphView";
import { parseGraphProgram } from "@/lib/graph-directives";
import {
  type AwarenessUser,
  colorFor,
  type RunError,
  type RunResult,
} from "@/components/pad/types";
import { useRoomStatusPolling } from "@/components/pad/useRoomStatusPolling";
import { useYjsEditor } from "@/components/pad/useYjsEditor";
import { RoomSettings } from "@/components/RoomSettings";
import { Stopwatch } from "@/components/Stopwatch";
import { ThemeToggle } from "@/components/ThemeToggle";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  connecting: "bg-yellow-100 text-yellow-700",
  connected: "bg-green-100 text-green-700",
  disconnected: "bg-red-100 text-red-700",
};

interface PadEditorInnerProps {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  isOwner: boolean;
  user: { name: string; avatarUrl: string | null; color: string | null };
}

export function PadEditorInner({
  roomId,
  roomName,
  hasPassword,
  isOwner,
  user: viewer,
}: PadEditorInnerProps) {
  const [argsText, setArgsText] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [output, setOutput] = useState<RunResult | RunError | null>(null);
  const [runSeq, setRunSeq] = useState<number>(0);

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "light" ? "vs" : "vs-dark";

  const localUser = useMemo<AwarenessUser>(
    () => ({
      name: viewer.name,
      // User-picked colour (when set on /me) wins; otherwise fall back to
      // the stable name-hashed default.
      color: viewer.color ?? colorFor(viewer.name),
      avatarUrl: viewer.avatarUrl,
    }),
    [viewer.name, viewer.avatarUrl, viewer.color]
  );

  const {
    ydocRef,
    providerRef,
    status,
    users,
    languageId,
    setLanguageId,
    deleted,
    setDeleted,
  } = useYjsEditor({ roomId, localUser });

  useRoomStatusPolling(roomId, deleted, setDeleted);

  const language = findLanguage(languageId);

  const showGraph = languageId === "python";
  const stdout = output && !("error" in output) ? output.stdout : "";
  const graphProgram = useMemo(() => parseGraphProgram(stdout), [stdout]);

  const bindingRef = useRef<MonacoBinding | null>(null);
  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, []);

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
        setRunSeq((n) => n + 1);
      } else {
        setOutput({ ...json, durationMs });
        setRunSeq((n) => n + 1);
      }
    } catch (err) {
      setOutput({
        error: "client_error",
        message: err instanceof Error ? err.message : String(err),
      });
      setRunSeq((n) => n + 1);
    } finally {
      setRunning(false);
    }
  }, [language, argsText, ydocRef]);

  return (
    <div className="flex h-screen flex-col">
      <RemoteCursorStyles provider={providerRef.current} roomId={roomId} />
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
              <LockIcon label="Private — password required" />
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
            onChange={(e) => setLanguageId(e.target.value)}
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
          {users.map(({ clientId, user: u }) => (
            <span
              key={clientId}
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
        <Group orientation="horizontal" style={{ height: "100%" }}>
          <Panel defaultSize={showGraph ? 65 : 100} minSize={30}>
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
          </Panel>
          {showGraph ? (
            <>
              <Separator className="w-1 bg-divider hover:bg-primary" />
              <Panel defaultSize={35} minSize={20} collapsible collapsedSize={0}>
                <GraphView key={`graph-${runSeq}`} program={graphProgram} />
              </Panel>
            </>
          ) : null}
        </Group>
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

      <RunOutput result={output} />
    </div>
  );
}
