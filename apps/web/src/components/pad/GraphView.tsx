"use client";

import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { clampStep, frameAt } from "@/lib/graph-directives";
import type { GraphProgram, SingleGraphState } from "./graph-types";
import { LAYOUTS, type LayoutName, useCytoscapeGraph } from "./useCytoscapeGraph";

const USAGE = `print directives in your Python code:
  graph: [[1,2],[1],[2]]            define a directed graph (adjacency list)
  graph:undirected: [[1],[0]]       undirected graph
  graph_node:0:color:1              colour node 0 (1..16)
  graph_node:0:info:children 1      label under node 0
  graph_edge:0:1:color:3            colour edge 0->1
  graph_edge:0:1:label:w=5          label edge 0->1 (weights)
  graph@tree:...  graph_node@tree:..multiple graphs via @id`;

function GraphCanvas({
  state,
  layout,
  isDark,
}: {
  state: SingleGraphState;
  layout: LayoutName;
  isDark: boolean;
}) {
  const containerRef = useCytoscapeGraph(state, layout, isDark);
  return (
    <div className="border-b border-divider">
      <div className="px-2 py-1 font-mono text-[11px] text-default-500">
        [@{state.id}] {state.mode}
      </div>
      <div ref={containerRef} className="h-56 w-full" />
    </div>
  );
}

export function GraphView({ program }: { program: GraphProgram }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const [layout, setLayout] = useState<LayoutName>("breadthfirst");
  const [showHelp, setShowHelp] = useState(false);

  // Track rawStep alongside the last seen program so we can reset to the
  // final step when the program identity changes — without an effect or
  // ref reads during render.
  const [stepState, setStepState] = useState<{
    seenProgram: GraphProgram;
    rawStep: number;
  }>(() => ({ seenProgram: program, rawStep: program.stepCount - 1 }));

  // When the program prop changes to a new object, reset the step to the
  // final step via a derived-state update (no effect needed).
  const rawStep =
    stepState.seenProgram === program
      ? stepState.rawStep
      : program.stepCount - 1;
  if (stepState.seenProgram !== program) {
    setStepState({ seenProgram: program, rawStep: program.stepCount - 1 });
  }

  const setRawStep = (updater: number | ((prev: number) => number)) => {
    setStepState((prev) => {
      const next =
        typeof updater === "function" ? updater(prev.rawStep) : updater;
      return { seenProgram: prev.seenProgram, rawStep: next };
    });
  };

  const step = clampStep(rawStep, program.stepCount);
  const state = useMemo(() => frameAt(program, step), [program, step]);
  const ids = Object.keys(state);
  const currentEvent = program.events[step];
  const infoLine =
    currentEvent?.kind === "node" && currentEvent.attr === "info"
      ? currentEvent.value
      : "";

  return (
    <div className="flex h-full flex-col bg-content1">
      <div className="flex items-center gap-2 border-b border-divider px-2 py-1">
        <span className="text-xs font-medium">Graph</span>
        <select
          value={layout}
          onChange={(e) => setLayout(e.target.value as LayoutName)}
          className="rounded border border-divider bg-content1 px-1 py-0.5 text-xs"
          aria-label="Layout"
        >
          {LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="ml-auto rounded px-1.5 text-xs text-default-500 hover:text-default-800"
          aria-label="Toggle usage help"
          aria-pressed={showHelp}
        >
          ?
        </button>
      </div>

      {showHelp ? (
        <pre className="whitespace-pre-wrap border-b border-divider bg-content2 px-2 py-1 font-mono text-[10px] text-default-600">
          {USAGE}
        </pre>
      ) : null}

      {program.warnings.length > 0 ? (
        <div className="border-b border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {program.warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {ids.length === 0 ? (
          <div className="px-3 py-4 text-xs text-default-500">
            No <code>graph:</code> directives found. Toggle <strong>?</strong>{" "}
            for usage.
          </div>
        ) : (
          ids.map((id) => {
            const graphState = state[id];
            if (!graphState) return null;
            return (
              <GraphCanvas
                key={id}
                state={graphState}
                layout={layout}
                isDark={isDark}
              />
            );
          })
        )}
      </div>

      {program.stepCount > 0 ? (
        <div className="flex items-center gap-2 border-t border-divider px-2 py-1">
          <button
            type="button"
            onClick={() => setRawStep((s) => clampStep(s - 1, program.stepCount))}
            className="rounded border border-divider px-2 text-sm disabled:opacity-40"
            disabled={step <= 0}
            aria-label="Previous step"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => setRawStep((s) => clampStep(s + 1, program.stepCount))}
            className="rounded border border-divider px-2 text-sm disabled:opacity-40"
            disabled={step >= program.stepCount - 1}
            aria-label="Next step"
          >
            ▶
          </button>
          <input
            type="range"
            min={0}
            max={program.stepCount - 1}
            value={step}
            onChange={(e) => setRawStep(Number(e.target.value))}
            className="flex-1"
            aria-label="Step"
          />
          <span className="font-mono text-[11px] text-default-500">
            step {step + 1}/{program.stepCount}
          </span>
        </div>
      ) : null}

      {infoLine ? (
        <div className="border-t border-divider px-2 py-1 font-mono text-[11px] text-default-600">
          {infoLine}
        </div>
      ) : null}
    </div>
  );
}
