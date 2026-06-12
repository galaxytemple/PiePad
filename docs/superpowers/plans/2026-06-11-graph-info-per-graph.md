# `graph_info:` Per-Graph Header-Anchored Sticky Message — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `graph_info[@id]:` a per-graph message shown under that graph's `[@id] mode` header, sticky (persists across steps until the next one), and remove the bottom footer + its node-info fallback.

**Architecture:** `graph_info` now carries its `@id` (default `main`). `GraphProgram.messages` becomes `Record<string, Record<number, string>>` (graphId → stepIndex → text). A pure `messageFor(messages, id, step)` returns the latest message at-or-before `step` for that id. `GraphCanvas` renders that message under its header; the panel-bottom footer is deleted.

**Tech Stack:** TypeScript, Vitest (node env). Commands from `apps/web/`.

**Spec:** `docs/superpowers/specs/2026-06-11-graph-info-per-graph-design.md`

**Testing note:** parser tested via `parseGraphProgram` + `messageFor`. The GraphView/GraphCanvas change is verified by typecheck/lint/build + manual. Lint is currently clean — keep it clean.

---

### Task 1: Per-graph messages model + `messageFor`

**Files:**
- Modify: `apps/web/src/components/pad/graph-types.ts`
- Modify: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Change the `messages` type**

In `apps/web/src/components/pad/graph-types.ts`, replace:
```ts
  messages: Record<number, string>;
```
with:
```ts
  // graphId -> stepIndex -> message (a graph_info: line attaches to that graph
  // at the previous step). Sticky in the UI via messageFor().
  messages: Record<string, Record<number, string>>;
```

- [ ] **Step 2: Migrate + add tests in `apps/web/src/lib/graph-directives.test.ts`**

(a) In the existing `describe("graph_info: panel message", ...)` block, migrate the assertions to the nested shape and fix the `@id` test (id is now honoured, not ignored):
- `expect(p.messages[1]).toBe("visiting 0");` → `expect(p.messages.main[1]).toBe("visiting 0");`
- `expect(p.messages[0]).toBe("a\nb");` → `expect(p.messages.main[0]).toBe("a\nb");`
- `expect(p.messages[0]).toBe("second");` → `expect(p.messages.main[0]).toBe("second");`
- the "ignores graph_info before any event" test keeps `expect(p.messages).toEqual({});`
- REPLACE the test `it("ignores the @id on graph_info (panel-global)", ...)` (which asserted `messages[0]`) with:
  ```ts
  it("routes graph_info@id to that graph's bucket", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph@b: [[]]\ngraph_info@b: hi");
    expect(p.messages.b[1]).toBe("hi"); // attached after the 2nd event (graph b)
    expect(p.messages.main).toBeUndefined();
  });
  ```
- `expect(p.messages[0]).toBe("rooted");` (the tree test) → `expect(p.messages.main[0]).toBe("rooted");`

(b) Append a new describe for `messageFor`:
```ts
import { messageFor } from "./graph-directives";

describe("messageFor (sticky per-graph message)", () => {
  it("returns the latest message at or before the step, sticky across steps", () => {
    const m = { main: { 1: "a", 3: "b" } };
    expect(messageFor(m, "main", 0)).toBe("");
    expect(messageFor(m, "main", 1)).toBe("a");
    expect(messageFor(m, "main", 2)).toBe("a"); // sticky — persists past step 1
    expect(messageFor(m, "main", 3)).toBe("b");
    expect(messageFor(m, "main", 9)).toBe("b");
  });

  it("is isolated per graph id and empty when none", () => {
    const m = { main: { 0: "x" }, b: { 0: "y" } };
    expect(messageFor(m, "main", 5)).toBe("x");
    expect(messageFor(m, "b", 5)).toBe("y");
    expect(messageFor(m, "missing", 5)).toBe("");
    expect(messageFor({}, "main", 5)).toBe("");
  });
});
```
(If `messageFor` is already imported via the top `import { ... } from "./graph-directives"`, add it there instead of a second import line — keep imports tidy.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — `messages` is still flat; `messageFor` not exported; `messages.main`/`messages.b` undefined.

- [ ] **Step 4: Implement** in `apps/web/src/lib/graph-directives.ts`

(a) Extend the `ParseResult` info variant with `id` — replace:
```ts
type ParseResult = GraphEvent | { kind: "info"; text: string };
```
with:
```ts
type ParseResult = GraphEvent | { kind: "info"; id: string; text: string };
```

(b) The `graph_info` branch in `parseLine` — replace:
```ts
  // graph_info: panel-bottom narration. @id (in `id`) is ignored — the message
  // is panel-global. trimStart drops the conventional space in "graph_info: hi".
  if (kw === "graph_info") {
    return { kind: "info", text: body.trimStart().replace(/\\n/g, "\n") };
  }
```
with:
```ts
  // graph_info[@id]: per-graph narration shown under that graph's header.
  // trimStart drops the conventional space in "graph_info: hi".
  if (kw === "graph_info") {
    return { kind: "info", id, text: body.trimStart().replace(/\\n/g, "\n") };
  }
```

(c) `parseGraphProgram` — replace:
```ts
  const messages: Record<number, string> = {};
```
with:
```ts
  const messages: Record<string, Record<number, string>> = {};
```
and replace the info-handling line:
```ts
      if (events.length > 0) messages[events.length - 1] = result.text;
```
with:
```ts
      if (events.length > 0) {
        (messages[result.id] ??= {})[events.length - 1] = result.text;
      }
```

(d) Add the exported `messageFor` helper (place it next to `clampStep`/`frameAt`):
```ts
// The message shown for graph `id` at `step` is the most recent graph_info for
// that id at or before `step` (sticky — persists until the next one). "" if none.
export function messageFor(
  messages: Record<string, Record<number, string>>,
  id: string,
  step: number
): string {
  const byStep = messages[id];
  if (!byStep) return "";
  for (let k = step; k >= 0; k--) {
    const m = byStep[k];
    if (m !== undefined) return m;
  }
  return "";
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/lib/graph-directives.test.ts` → all pass. Then `pnpm test` (full) → green. Then `pnpm typecheck` → it will FAIL in `GraphView.tsx` (still uses the old flat `program.messages[step]`) — that's expected and fixed in Task 2. Confirm the ONLY typecheck error is in `GraphView.tsx`; the parser/test files are clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/pad/graph-types.ts apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): graph_info per-graph messages + sticky messageFor helper"
```

---

### Task 2: Render the message under each graph header; remove the footer

**Files:**
- Modify: `apps/web/src/components/pad/GraphView.tsx`

- [ ] **Step 1: Import `messageFor`**

Change the import:
```ts
import { clampStep, frameAt } from "@/lib/graph-directives";
```
to:
```ts
import { clampStep, frameAt, messageFor } from "@/lib/graph-directives";
```

- [ ] **Step 2: Give `GraphCanvas` a `message` prop and render it under the header**

Replace the whole `GraphCanvas` function:
```ts
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
      <div ref={containerRef} className="h-96 w-full" />
    </div>
  );
}
```
with:
```ts
function GraphCanvas({
  state,
  layout,
  isDark,
  message,
}: {
  state: SingleGraphState;
  layout: LayoutName;
  isDark: boolean;
  message: string;
}) {
  const containerRef = useCytoscapeGraph(state, layout, isDark);
  return (
    <div className="border-b border-divider">
      <div className="px-2 py-1 font-mono text-[11px] text-default-500">
        [@{state.id}] {state.mode}
      </div>
      {message ? (
        <div className="whitespace-pre-line px-2 pb-1 font-mono text-[11px] text-default-700">
          {message}
        </div>
      ) : null}
      <div ref={containerRef} className="h-96 w-full" />
    </div>
  );
}
```

- [ ] **Step 3: Remove the old footer derivation**

Delete these lines (the `currentEvent`/`nodeInfo`/`infoLine` derivation):
```ts
  const currentEvent = program.events[step];
  // The bottom footer shows the step's graph_info: narration if present;
  // otherwise it falls back to the current node event's own info label.
  const nodeInfo =
    currentEvent?.kind === "node" && currentEvent.deco.info !== undefined
      ? currentEvent.deco.info
      : "";
  const infoLine = program.messages[step] ?? nodeInfo;
```
(Leave the surrounding `state`/`ids`/`stepBy` lines intact.)

- [ ] **Step 4: Pass `message` to each `GraphCanvas`**

Replace:
```ts
              <GraphCanvas
                key={id}
                state={graphState}
                layout={layout}
                isDark={isDark}
              />
```
with:
```ts
              <GraphCanvas
                key={id}
                state={graphState}
                layout={layout}
                isDark={isDark}
                message={messageFor(program.messages, id, step)}
              />
```

- [ ] **Step 5: Remove the bottom footer JSX**

Delete this block (after the step-bar block, before the closing `</div>`):
```tsx
      {infoLine ? (
        <div className="whitespace-pre-line border-t border-divider px-2 py-1 font-mono text-[11px] text-default-600">
          {infoLine}
        </div>
      ) : null}
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint` → both clean (no errors). Then (repo root) `pnpm --filter @piepad/web build` → Compiled successfully.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/pad/GraphView.tsx
git commit -m "feat(graph): show graph_info under each graph header; drop bottom footer + node-info fallback"
```

---

### Task 3: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start dev (`pnpm dev:ws`, `pnpm dev:web`, Piston up). Open a pad, Python, paste, Run:**

```python
print("graph: [[1,2],[],[]]")
print("graph@b: [[1],[0]]")
print("graph_node:0:color:1")
print("graph_info: visiting root")
print("graph_node:0:info:d:5")
print("graph_node@b:1:color:4")
print("graph_info@b: low:3 on b")
```

- [ ] **Step 2: Verify — confirm each:**

- [ ] Under `[@main] directed` the message shows ("visiting root"); under `[@b] directed` its own message shows ("low:3 on b") — each graph has its own line under its header.
- [ ] Stepping the timeline: the per-graph message **persists** (sticky) until a newer `graph_info` for that graph — it does NOT blink out on the next step.
- [ ] There is **no message box below the step bar** anymore.
- [ ] The node's own `info` (`d:5`) appears **only as that node's sub-label on the canvas**, never in a separate panel slot.
- [ ] `graph_info`/directive lines are stripped from RunOutput; a plain `info:` log line still shows.

- [ ] **Step 3: Fix any discrepancy; add a regression test for any parser bug; then:**

Run: `pnpm test && pnpm typecheck && pnpm lint`
```bash
git add -A
git commit -m "fix(graph): address per-graph message verification findings"
```

---

## Self-Review

**Spec coverage:**
- `graph_info[@id]:` honours `@id` (default main) → Task 1 (b).
- `messages: Record<string, Record<number,string>>` → Task 1 (a)(c).
- attach to previous step, no new step, ignore-before-event → Task 1 (c) (unchanged loop) + migrated tests.
- sticky `messageFor` → Task 1 (d) + tests.
- render under each graph header → Task 2 (2)(4).
- remove bottom footer + node-info fallback → Task 2 (3)(5).
- node info stays on the node only → unchanged `toElements` (no task touches it).
- strip unchanged → no task (DIRECTIVE_RE already covers graph_info@id).
- orphan message (id with no graph) not rendered → naturally, GraphView only maps over `ids` present in the frame.

**Placeholder scan:** none — every step has exact code/edits.

**Type consistency:** `messages: Record<string, Record<number, string>>` used in graph-types, parseGraphProgram, `messageFor`, and GraphView. `ParseResult` info variant gains `id: string`. `GraphCanvas` gains `message: string`. `messageFor(messages, id, step): string` signature matches its call site. No change to `GraphEvent`, `frameAt`, `clampStep`, `applyEvent`, `SingleGraphState`, `DIRECTIVE_RE`.
