import { stripGraphDirectives } from "@/lib/graph-directives";
import type { RunError, RunResult } from "./types";

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

export function RunOutput({
  result,
}: {
  result: RunResult | RunError | null;
}) {
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
  {
    const visibleStdout = stripGraphDirectives(result.stdout);
    return (
      <div className="h-40 overflow-auto border-t border-zinc-200 bg-zinc-950 px-4 py-2 font-mono text-xs dark:border-zinc-800">
        <div className="mb-1 text-zinc-500">
          exit {result.code}
          {result.signal ? ` (signal ${result.signal})` : ""} ·{" "}
          {result.durationMs}ms
        </div>
        {result.compileStderr ? (
          <pre className="whitespace-pre-wrap text-amber-400">
            {result.compileStderr}
          </pre>
        ) : null}
        {visibleStdout ? (
          <pre className="whitespace-pre-wrap text-zinc-100">{visibleStdout}</pre>
        ) : null}
        {result.stderr ? (
          <pre className="whitespace-pre-wrap text-red-400">{result.stderr}</pre>
        ) : null}
        {!visibleStdout && !result.stderr && !result.compileStderr ? (
          <span className="text-zinc-500">(no output)</span>
        ) : null}
      </div>
    );
  }
}

function ErrorPanel({ result }: { result: RunError }) {
  const friendly =
    FRIENDLY_ERROR_MESSAGES[result.error] ?? "Something went wrong.";
  const isWarmup = result.error === "piston_unreachable";
  return (
    <div className="h-40 overflow-auto border-t border-zinc-200 bg-zinc-950 px-4 py-2 font-mono text-xs dark:border-zinc-800">
      <div
        className={`font-semibold ${
          isWarmup ? "text-amber-300" : "text-red-400"
        }`}
      >
        {friendly}
      </div>
      {result.retryAfterSec !== undefined ? (
        <div className="text-zinc-400">Retry in {result.retryAfterSec}s.</div>
      ) : null}
      {result.message ? (
        <div className="mt-1 text-zinc-500">{result.message}</div>
      ) : null}
      <div className="mt-1 text-[10px] text-zinc-600">({result.error})</div>
    </div>
  );
}
