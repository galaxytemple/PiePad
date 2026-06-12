# `graph_info:` Panel Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `graph_info: <text>` directive that shows per-step narration at the bottom of the graph panel without consuming a timeline step — it attaches its text to the previous directive's step.

**Architecture:** `parseLine` returns a small union `GraphEvent | {kind:"info",text}`. `parseGraphProgram` attaches an `info` result's text to the last event's index in a new `GraphProgram.messages` map (no new step). `GraphView`'s footer shows `messages[step]` with the node-info as fallback. `frameAt`/events/rendering are unchanged.

**Tech Stack:** TypeScript, Vitest (node env). Commands from `apps/web/`.

**Spec:** `docs/superpowers/specs/2026-06-11-graph-info-message-design.md`

**Testing note:** parser is pure — tested via `parseGraphProgram`. The `GraphView` footer change is verified by typecheck/lint + manual run. Pre-existing `PadEditorInner.tsx` lint is now clean; keep it clean.

---

### Task 1: Parse `graph_info:` into a per-step message

**Files:**
- Modify: `apps/web/src/components/pad/graph-types.ts`
- Modify: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Add `messages` to `GraphProgram`**

In `apps/web/src/components/pad/graph-types.ts`, replace:
```ts
export interface GraphProgram {
  events: GraphEvent[];
  stepCount: number; // = events.length
  warnings: string[];
}
```
with:
```ts
export interface GraphProgram {
  events: GraphEvent[];
  stepCount: number; // = events.length
  warnings: string[];
  // graph_info: <text> lines attach a panel-bottom message to a step index
  // (the directive that preceded them). Not every step has a message.
  messages: Record<number, string>;
}
```

- [ ] **Step 2: Write the failing tests (append to `apps/web/src/lib/graph-directives.test.ts`)**

```ts
describe("graph_info: panel message", () => {
  it("attaches to the previous step without adding a step", () => {
    const p = parseGraphProgram(
      "graph: [[]]\ngraph_node:0:color:1\ngraph_info: visiting 0"
    );
    expect(p.stepCount).toBe(2); // graph + node, NOT 3
    expect(p.messages[1]).toBe("visiting 0");
  });

  it("trims the conventional leading space and converts \\n", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_info: a\\nb");
    expect(p.messages[0]).toBe("a\nb");
  });

  it("last graph_info wins for the same step", () => {
    const p = parseGraphProgram(
      "graph: [[]]\ngraph_info: first\ngraph_info: second"
    );
    expect(p.messages[0]).toBe("second");
  });

  it("ignores graph_info before any event", () => {
    const p = parseGraphProgram("graph_info: nothing yet\ngraph: [[]]");
    expect(p.stepCount).toBe(1);
    expect(p.messages).toEqual({});
  });

  it("ignores the @id on graph_info (panel-global)", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_info@x: hi");
    expect(p.messages[0]).toBe("hi");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — `messages` is undefined; `graph_info:` is currently ignored (so `messages[...]` is undefined and `stepCount` may differ).

- [ ] **Step 4: Implement**

In `apps/web/src/lib/graph-directives.ts`:

(a) Add a local result-union type just above `function parseLine(` (after the `parseEdgeLine` function):
```ts
// parseLine yields either a timeline event or a panel message instruction.
// The `info` variant is internal — it never enters `GraphProgram.events`.
type ParseResult = GraphEvent | { kind: "info"; text: string };
```

(b) Change `parseLine`'s return type and add the `graph_info` route. Replace:
```ts
function parseLine(
  raw: string,
  structures: Map<string, number[][]>,
  warnings: string[]
): GraphEvent | null {
  const line = raw.trim();
  if (!line.startsWith("graph") && !line.startsWith("tree")) return null;
  const firstColon = line.indexOf(":");
  if (firstColon === -1) return null;
  const head = line.slice(0, firstColon).trim();
  const body = line.slice(firstColon + 1);
  const parsed = parseHead(head);
  if (!parsed) return null;
  const { kw, id } = parsed;
  if (kw === "graph") return parseGraphLine(id, body, structures, warnings);
  if (kw === "graph_node") return parseNodeLine(id, body, structures);
  if (kw === "graph_edge") return parseEdgeLine(id, body, structures);
  if (kw === "tree") return parseTreeLine(id, body, structures, warnings);
  return null;
}
```
with:
```ts
function parseLine(
  raw: string,
  structures: Map<string, number[][]>,
  warnings: string[]
): ParseResult | null {
  const line = raw.trim();
  if (!line.startsWith("graph") && !line.startsWith("tree")) return null;
  const firstColon = line.indexOf(":");
  if (firstColon === -1) return null;
  const head = line.slice(0, firstColon).trim();
  const body = line.slice(firstColon + 1);
  const parsed = parseHead(head);
  if (!parsed) return null;
  const { kw, id } = parsed;
  if (kw === "graph") return parseGraphLine(id, body, structures, warnings);
  if (kw === "graph_node") return parseNodeLine(id, body, structures);
  if (kw === "graph_edge") return parseEdgeLine(id, body, structures);
  if (kw === "tree") return parseTreeLine(id, body, structures, warnings);
  // graph_info: panel-bottom narration. @id (in `id`) is ignored — the message
  // is panel-global. trimStart drops the conventional space in "graph_info: hi".
  if (kw === "graph_info") {
    return { kind: "info", text: body.trimStart().replace(/\\n/g, "\n") };
  }
  return null;
}
```

(c) Update `parseGraphProgram` to build `messages` and attach `info` results:
```ts
export function parseGraphProgram(stdout: string): GraphProgram {
  const events: GraphEvent[] = [];
  const warnings: string[] = [];
  const messages: Record<number, string> = {};
  const structures = new Map<string, number[][]>();
  for (const raw of stdout.split("\n")) {
    const result = parseLine(raw, structures, warnings);
    if (!result) continue;
    if (result.kind === "info") {
      // Attach to the previous step; ignore if no event has been emitted yet.
      if (events.length > 0) messages[events.length - 1] = result.text;
      continue;
    }
    events.push(result);
  }
  return { events, stepCount: events.length, warnings, messages };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/lib/graph-directives.test.ts` → all pass. Then `pnpm test` (full) → green (any other place constructing a `GraphProgram` literal in tests now needs `messages` — fix by adding `messages: {}`; search the test file for `stepCount:` literals if the compiler flags them). Then `pnpm typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/pad/graph-types.ts apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): graph_info: directive — per-step panel message (no extra step)"
```

---

### Task 2: Strip `graph_info:` from run output

**Files:**
- Modify: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("stripGraphDirectives removes graph_info too", () => {
  it("strips graph_info: and graph_info@x: lines, keeps a plain info: log", () => {
    const stdout = [
      "start",
      "graph_info: hello",
      "graph_info@x: hi",
      "info: a normal log line",
      "end",
    ].join("\n");
    expect(stripGraphDirectives(stdout)).toBe(
      "start\ninfo: a normal log line\nend"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — `graph_info:` lines are not stripped yet (regex lacks `_info`).

- [ ] **Step 3: Implement**

In `apps/web/src/lib/graph-directives.ts`, change:
```ts
const DIRECTIVE_RE = /^(graph(_node|_edge)?|tree)(@[A-Za-z0-9_-]+)?:/;
```
to:
```ts
const DIRECTIVE_RE = /^(graph(_node|_edge|_info)?|tree)(@[A-Za-z0-9_-]+)?:/;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/graph-directives.test.ts` → PASS. Then `pnpm test` → all green. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): strip graph_info: lines from run output"
```

---

### Task 3: GraphView footer shows the step message

**Files:**
- Modify: `apps/web/src/components/pad/GraphView.tsx`

- [ ] **Step 1: Show `messages[step]` with node-info fallback**

In `apps/web/src/components/pad/GraphView.tsx`, replace:
```ts
  const currentEvent = program.events[step];
  // Shows the info annotation from this specific step's event (not the node's
  // accumulated state) — e.g. a `color:6:info:hello` directive surfaces "hello".
  const infoLine =
    currentEvent?.kind === "node" && currentEvent.deco.info !== undefined
      ? currentEvent.deco.info
      : "";
```
with:
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
(The footer JSX that renders `infoLine` already uses `whitespace-pre-line`, so `\n` shows as line breaks — no JSX change needed. `messages[step]` may be `""` for an empty `graph_info:`; `?? ` only falls back on `undefined`, so an explicit empty message correctly shows nothing.)

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: typecheck clean; lint clean (no errors — the prior `PadEditorInner` error was fixed).

- [ ] **Step 3: Build**

Run (repo root): `pnpm --filter @piepad/web build` → Compiled successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/pad/GraphView.tsx
git commit -m "feat(graph): footer shows graph_info step message (node-info fallback)"
```

---

### Task 4: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start dev (`pnpm dev:ws`, `pnpm dev:web`, Piston up). Open a pad, Python, paste, Run:**

```python
print("graph: [[1,2],[],[]]")
print("graph_node:0:color:1")
print("graph_info: start at root")
print("graph_node:1:color:4")
print("graph_info: descend left\\nthen continue")
print("a normal log line")
```

- [ ] **Step 2: Verify — confirm each:**

- [ ] Stepping the timeline: at the `graph_node:0` step the bottom shows "start at root"; at the `graph_node:1` step it shows "descend left" / "then continue" on two lines.
- [ ] The `graph_info:` lines did NOT add their own steps (step count = number of graph/node directives, not including the info lines).
- [ ] The bottom message changes as you step ◀ ▶; a step with no message shows nothing there.
- [ ] RunOutput shows only `a normal log line` (both directive and graph_info lines stripped).
- [ ] A plain `print("info: x")` (no `graph_` prefix) still appears in RunOutput (not hijacked).

- [ ] **Step 3: Fix any discrepancies; add a regression test for any parser bug; then:**

Run: `pnpm test && pnpm typecheck && pnpm lint`
```bash
git add -A
git commit -m "fix(graph): address graph_info verification findings"
```

---

## Self-Review

**Spec coverage:**
- `graph_info: <text>` directive, terminal text, `\n` conversion, `@id` ignored → Task 1 (parseLine `graph_info` branch).
- No step; attach to previous step's index → Task 1 (`parseGraphProgram` attaches to `events.length-1`, only the `info` kind, no push).
- last-wins; ignore if no prior event → Task 1 tests.
- `GraphProgram.messages` model + `ParseResult` union → Task 1.
- `frameAt`/events unchanged → no change to those functions.
- Footer shows `messages[step]`, node-info fallback → Task 3.
- strip `graph_info:` lines → Task 2; plain `info:` not stripped → Task 2 test.
- trimStart of the leading space → Task 1 test ("a\\nb" → "a\nb"; leading-space case covered by the "visiting 0" attach test reading "visiting 0" not " visiting 0").

**Placeholder scan:** none — every code step is complete. Step 5 of Task 1 notes a possible mechanical test-literal fix (`messages: {}`) with the exact remedy.

**Type consistency:** `GraphProgram` gains `messages: Record<number,string>`; `parseLine` returns `ParseResult | null` (`ParseResult = GraphEvent | {kind:"info";text:string}`); `parseGraphProgram` returns the 4-field `GraphProgram`. `GraphView` reads `program.messages[step]`. `DIRECTIVE_RE` extended. No change to `GraphEvent`, `frameAt`, `applyEvent`, `clampStep`, `SingleGraphState`.
