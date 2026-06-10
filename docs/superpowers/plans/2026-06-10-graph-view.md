# Graph View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible right-split panel to the PiePad editor that parses a Python run's stdout for `graph:` directives and renders the data structure with Cytoscape, including a user-controlled step timeline, multi-graph support, directed/undirected modes, and edge labels/colors.

**Architecture:** A pure, React-free parser (`lib/graph-directives.ts`) turns stdout into an ordered list of `GraphEvent`s; `frameAt` folds events `0..i` into an immutable `MultiGraphState`. The UI (`GraphView` + `useCytoscapeGraph`) renders one Cytoscape canvas per graph id, driven by a single global step index. Wiring lives in `PadEditorInner`, gated on `languageId === "python"`, using `react-resizable-panels` for the collapsible split. The graph is derived from the local run only — no Yjs sync.

**Tech Stack:** Next.js 16 (client component), React 19, TypeScript, Cytoscape, react-resizable-panels, Vitest (node env, parser only).

**Spec:** `docs/superpowers/specs/2026-06-10-graph-view-design.md`

**Testing note:** The repo's Vitest env is `node` and there is no React Testing Library / jsdom. To keep the change minimal and match the existing pattern (pure-logic `lib/*.test.ts`), all automated tests target the pure parser module. The React layer (`GraphView`, `useCytoscapeGraph`, wiring) is verified by `pnpm typecheck`, `pnpm lint`, and a scripted manual run in the app. Cytoscape requires a real DOM/canvas and is not unit-tested.

All commands run from `apps/web/` unless noted. Tests: `pnpm test` (or `pnpm vitest run <file>`).

---

### Task 1: Install dependencies

**Files:**
- Modify: `apps/web/package.json` (via pnpm)

- [ ] **Step 1: Add runtime + type deps**

Run (from repo root):
```bash
pnpm --filter @piepad/web add cytoscape react-resizable-panels
pnpm --filter @piepad/web add -D @types/cytoscape
```

- [ ] **Step 2: Verify install**

Run: `pnpm --filter @piepad/web exec tsc --noEmit`
Expected: PASS (no new errors; deps resolve).

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add cytoscape + react-resizable-panels"
```

---

### Task 2: Types + parser scaffold + `graph:` directive (directed)

**Files:**
- Create: `apps/web/src/components/pad/graph-types.ts`
- Create: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Write the types**

Create `apps/web/src/components/pad/graph-types.ts`:
```ts
// Visual model for the graph view. color is a resolved PALETTE hex string
// (the 1..16 index is resolved to hex at parse time).
export type GraphMode = "directed" | "undirected";

export interface NodeDeco {
  color?: string;
  info?: string;
}

export interface EdgeDeco {
  color?: string;
  label?: string;
}

export interface SingleGraphState {
  id: string;
  mode: GraphMode;
  adjacency: number[][]; // node -> out-neighbors
  nodes: Record<number, NodeDeco>;
  edges: Record<string, EdgeDeco>; // key = `${src}->${dst}`
}

export type MultiGraphState = Record<string, SingleGraphState>; // keyed by graph id

export type GraphEvent =
  | { kind: "graph"; id: string; mode: GraphMode; adjacency: number[][] }
  | { kind: "node"; id: string; node: number; attr: "color" | "info"; value: string }
  | { kind: "edge"; id: string; src: number; dst: number; attr: "color" | "label"; value: string };

export interface GraphProgram {
  events: GraphEvent[];
  stepCount: number; // = events.length
  warnings: string[];
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/graph-directives.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseGraphProgram } from "./graph-directives";

describe("parseGraphProgram — graph: directive", () => {
  it("parses a directed adjacency list into one graph event", () => {
    const p = parseGraphProgram("graph: [[1,2],[1],[2]]");
    expect(p.stepCount).toBe(1);
    expect(p.events[0]).toEqual({
      kind: "graph",
      id: "main",
      mode: "directed",
      adjacency: [[1, 2], [1], [2]],
    });
    expect(p.warnings).toEqual([]);
  });

  it("ignores non-directive lines and keeps real output out of events", () => {
    const p = parseGraphProgram("hello\ngraph: [[1],[0]]\nworld");
    expect(p.stepCount).toBe(1);
    expect(p.events[0].kind).toBe("graph");
  });

  it("accepts explicit directed: prefix", () => {
    const p = parseGraphProgram("graph:directed: [[1],[0]]");
    expect(p.events[0]).toMatchObject({ kind: "graph", mode: "directed" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — `parseGraphProgram` is not exported / not defined.

- [ ] **Step 4: Write minimal implementation**

Create `apps/web/src/lib/graph-directives.ts`:
```ts
import { PALETTE } from "@/components/pad/types";
import type {
  GraphEvent,
  GraphMode,
  GraphProgram,
} from "@/components/pad/graph-types";

const ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_NODES = 500;
const MAX_GRAPHS = 8;

// Split `s` on `sep` into at most `max` parts; the final part keeps any
// remaining separators (so info/label text may contain colons).
function splitMax(s: string, sep: string, max: number): string[] {
  const parts: string[] = [];
  let rest = s;
  while (parts.length < max - 1) {
    const i = rest.indexOf(sep);
    if (i === -1) break;
    parts.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  parts.push(rest);
  return parts;
}

function parseHead(head: string): { kw: string; id: string } | null {
  const at = head.indexOf("@");
  if (at === -1) return { kw: head, id: "main" };
  const kw = head.slice(0, at);
  const id = head.slice(at + 1);
  if (!ID_RE.test(id)) return null;
  return { kw, id };
}

function parseGraphLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>,
  warnings: string[]
): GraphEvent | null {
  let mode: GraphMode = "directed";
  let payload = body.trimStart();
  if (payload.startsWith("undirected:")) {
    mode = "undirected";
    payload = payload.slice("undirected:".length);
  } else if (payload.startsWith("directed:")) {
    payload = payload.slice("directed:".length);
  }

  let json: unknown;
  try {
    json = JSON.parse(payload.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;

  const adjacency: number[][] = [];
  for (const row of json) {
    if (!Array.isArray(row)) return null;
    const out: number[] = [];
    for (const v of row) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
      out.push(v);
    }
    adjacency.push(out);
  }

  const n = adjacency.length;
  for (const row of adjacency) {
    for (const v of row) if (v >= n) return null; // neighbor out of range
  }
  if (n > MAX_NODES) {
    warnings.push(`graph @${id} has ${n} nodes (max ${MAX_NODES}); ignored`);
    return null;
  }
  if (!structures.has(id) && structures.size >= MAX_GRAPHS) {
    warnings.push(`more than ${MAX_GRAPHS} graphs; @${id} ignored`);
    return null;
  }

  structures.set(id, adjacency);
  return { kind: "graph", id, mode, adjacency };
}

// `structures` is a local accumulator tracking each id's current adjacency so
// node/edge directives can be range-validated against the graph in effect at
// that point in the stream. Mutating it during this forward pass is local
// construction state, not shared mutation.
function parseLine(
  raw: string,
  structures: Map<string, number[][]>,
  warnings: string[]
): GraphEvent | null {
  const line = raw.trim();
  if (!line.startsWith("graph")) return null;
  const firstColon = line.indexOf(":");
  if (firstColon === -1) return null;
  const head = line.slice(0, firstColon).trim();
  const body = line.slice(firstColon + 1);
  const parsed = parseHead(head);
  if (!parsed) return null;
  const { kw, id } = parsed;
  if (kw === "graph") return parseGraphLine(id, body, structures, warnings);
  return null; // graph_node / graph_edge added in later tasks
}

export function parseGraphProgram(stdout: string): GraphProgram {
  const events: GraphEvent[] = [];
  const warnings: string[] = [];
  const structures = new Map<string, number[][]>();
  for (const raw of stdout.split("\n")) {
    const ev = parseLine(raw, structures, warnings);
    if (ev) events.push(ev);
  }
  return { events, stepCount: events.length, warnings };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/pad/graph-types.ts apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): parse graph: directive into events"
```

---

### Task 3: Node color/info + frameAt + clampStep

**Files:**
- Modify: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Write the failing test (append to the test file)**

```ts
import { clampStep, frameAt } from "./graph-directives";
import { PALETTE } from "@/components/pad/types";

describe("graph_node directives + frameAt", () => {
  const src = [
    "graph: [[1,2],[],[]]",
    "graph_node:0:color:1",
    "graph_node:0:info:children 1",
  ].join("\n");

  it("emits node events and resolves color index to PALETTE hex", () => {
    const p = parseGraphProgram(src);
    expect(p.stepCount).toBe(3);
    expect(p.events[1]).toEqual({
      kind: "node",
      id: "main",
      node: 0,
      attr: "color",
      value: PALETTE[0],
    });
    expect(p.events[2]).toEqual({
      kind: "node",
      id: "main",
      node: 0,
      attr: "info",
      value: "children 1",
    });
  });

  it("frameAt folds events 0..i inclusive and accumulates decorations", () => {
    const p = parseGraphProgram(src);
    const s0 = frameAt(p, 0);
    expect(s0.main.nodes).toEqual({});
    const s2 = frameAt(p, 2);
    expect(s2.main.nodes[0]).toEqual({ color: PALETTE[0], info: "children 1" });
    expect(s2.main.mode).toBe("directed");
    expect(s2.main.adjacency).toEqual([[1, 2], [], []]);
  });

  it("last-write-wins per attribute", () => {
    const p = parseGraphProgram(
      "graph: [[1],[0]]\ngraph_node:0:color:1\ngraph_node:0:color:2"
    );
    expect(frameAt(p, 2).main.nodes[0]).toEqual({ color: PALETTE[1] });
  });

  it("info text may contain colons", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:info:a:b:c");
    expect(p.events[1]).toMatchObject({ attr: "info", value: "a:b:c" });
  });

  it("ignores out-of-range node and bad color (not counted as steps)", () => {
    const p = parseGraphProgram(
      "graph: [[1],[0]]\ngraph_node:5:color:1\ngraph_node:0:color:99"
    );
    expect(p.stepCount).toBe(1);
  });

  it("ignores node directive before any graph: for that id", () => {
    const p = parseGraphProgram("graph_node:0:color:1\ngraph: [[1],[0]]");
    expect(p.stepCount).toBe(1);
    expect(p.events[0].kind).toBe("graph");
  });

  it("clampStep keeps index within [0, stepCount-1]", () => {
    expect(clampStep(-3, 5)).toBe(0);
    expect(clampStep(99, 5)).toBe(4);
    expect(clampStep(2, 5)).toBe(2);
    expect(clampStep(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — `frameAt`/`clampStep` not exported; node events not produced.

- [ ] **Step 3: Implement node parsing + frameAt + clampStep**

In `apps/web/src/lib/graph-directives.ts`, add the `MultiGraphState` + `SingleGraphState` to the type import:
```ts
import type {
  GraphEvent,
  GraphMode,
  GraphProgram,
  MultiGraphState,
  SingleGraphState,
} from "@/components/pad/graph-types";
```

Add a node parser:
```ts
function parseNodeLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>
): GraphEvent | null {
  const adj = structures.get(id);
  if (!adj) return null; // node before graph for this id
  const parts = splitMax(body, ":", 3); // [node, attr, value]
  if (parts.length < 3) return null;
  const node = Number(parts[0]);
  if (!Number.isInteger(node) || node < 0 || node >= adj.length) return null;
  const attr = parts[1];
  const value = parts[2];
  if (attr === "color") {
    const c = Number(value.trim());
    if (!Number.isInteger(c) || c < 1 || c > 16) return null;
    return { kind: "node", id, node, attr: "color", value: PALETTE[c - 1]! };
  }
  if (attr === "info") {
    return { kind: "node", id, node, attr: "info", value };
  }
  return null;
}
```

Wire it into `parseLine` (replace the `graph_node` branch):
```ts
  if (kw === "graph") return parseGraphLine(id, body, structures, warnings);
  if (kw === "graph_node") return parseNodeLine(id, body, structures);
  return null; // graph_edge added in a later task
```

Append `clampStep`, `frameAt`, and the fold helper:
```ts
export function clampStep(index: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  if (index < 0) return 0;
  if (index > stepCount - 1) return stepCount - 1;
  return index;
}

// Fold events 0..index (inclusive) into an immutable multi-graph state.
// `state` is a fresh local accumulator built per call, so mutating it while
// folding is local construction — never touches caller-owned objects.
export function frameAt(program: GraphProgram, index: number): MultiGraphState {
  const last = clampStep(index, program.stepCount);
  const state: MultiGraphState = {};
  if (program.stepCount === 0) return state;
  for (let k = 0; k <= last; k++) applyEvent(state, program.events[k]!);
  return state;
}

function applyEvent(state: MultiGraphState, ev: GraphEvent): void {
  if (ev.kind === "graph") {
    // Replacing structure clears the id's decorations.
    state[ev.id] = {
      id: ev.id,
      mode: ev.mode,
      adjacency: ev.adjacency,
      nodes: {},
      edges: {},
    } satisfies SingleGraphState;
    return;
  }
  const g = state[ev.id];
  if (!g) return; // validated unreachable, defensive
  if (ev.kind === "node") {
    g.nodes[ev.node] = { ...(g.nodes[ev.node] ?? {}), [ev.attr]: ev.value };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: PASS (all node + frameAt + clampStep tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): node color/info directives + frameAt timeline fold"
```

---

### Task 4: Edge color/label directives

**Files:**
- Modify: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("graph_edge directives", () => {
  it("emits edge color (PALETTE hex) and label events keyed by src->dst", () => {
    const p = parseGraphProgram(
      ["graph: [[1],[0]]", "graph_edge:0:1:color:3", "graph_edge:0:1:label:w=5"].join("\n")
    );
    expect(p.stepCount).toBe(3);
    expect(p.events[1]).toEqual({
      kind: "edge", id: "main", src: 0, dst: 1, attr: "color", value: PALETTE[2],
    });
    const s = frameAt(p, 2);
    expect(s.main.edges["0->1"]).toEqual({ color: PALETTE[2], label: "w=5" });
  });

  it("label may contain colons; ignores out-of-range endpoints", () => {
    const p = parseGraphProgram(
      ["graph: [[1],[0]]", "graph_edge:0:1:label:a:b", "graph_edge:9:0:color:1"].join("\n")
    );
    expect(p.stepCount).toBe(2);
    expect(frameAt(p, 1).main.edges["0->1"]).toEqual({ label: "a:b" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — edge events not produced; `edges` not populated.

- [ ] **Step 3: Implement edge parsing + fold**

Add an edge parser in `apps/web/src/lib/graph-directives.ts`:
```ts
function parseEdgeLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>
): GraphEvent | null {
  const adj = structures.get(id);
  if (!adj) return null;
  const parts = splitMax(body, ":", 4); // [src, dst, attr, value]
  if (parts.length < 4) return null;
  const srcN = Number(parts[0]);
  const dstN = Number(parts[1]);
  if (!Number.isInteger(srcN) || !Number.isInteger(dstN)) return null;
  if (srcN < 0 || dstN < 0 || srcN >= adj.length || dstN >= adj.length) return null;
  const attr = parts[2];
  const value = parts[3];
  if (attr === "color") {
    const c = Number(value.trim());
    if (!Number.isInteger(c) || c < 1 || c > 16) return null;
    return { kind: "edge", id, src: srcN, dst: dstN, attr: "color", value: PALETTE[c - 1]! };
  }
  if (attr === "label") {
    return { kind: "edge", id, src: srcN, dst: dstN, attr: "label", value };
  }
  return null;
}
```

Wire into `parseLine` (replace the `graph_edge` placeholder line):
```ts
  if (kw === "graph_node") return parseNodeLine(id, body, structures);
  if (kw === "graph_edge") return parseEdgeLine(id, body, structures);
  return null;
```

Extend `applyEvent` to fold edge events (add before the final closing brace of the function, after the node branch):
```ts
  if (ev.kind === "edge") {
    const key = `${ev.src}->${ev.dst}`;
    g.edges[key] = { ...(g.edges[key] ?? {}), [ev.attr]: ev.value };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): edge color/label directives"
```

---

### Task 5: `@id` multi-graph + undirected mode

**Files:**
- Modify: `apps/web/src/lib/graph-directives.ts` (no code change expected — `@id` and mode already implemented; this task adds coverage and fixes any gap it reveals)
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("@id multi-graph + undirected", () => {
  it("routes directives to named graphs and keeps default @main separate", () => {
    const p = parseGraphProgram(
      [
        "graph: [[1],[0]]",
        "graph@tree:undirected: [[1,2],[],[]]",
        "graph_node@tree:0:color:1",
        "graph_node:1:color:2",
      ].join("\n")
    );
    const s = frameAt(p, p.stepCount - 1);
    expect(Object.keys(s).sort()).toEqual(["main", "tree"]);
    expect(s.tree.mode).toBe("undirected");
    expect(s.tree.nodes[0]).toEqual({ color: PALETTE[0] });
    expect(s.main.nodes[1]).toEqual({ color: PALETTE[1] });
    expect(s.main.nodes[0]).toBeUndefined();
  });

  it("rejects invalid @id syntax", () => {
    const p = parseGraphProgram("graph@bad id: [[]]");
    expect(p.stepCount).toBe(0);
  });

  it("a second graph: for an id replaces structure and clears its decorations", () => {
    const p = parseGraphProgram(
      ["graph: [[1],[0]]", "graph_node:0:color:1", "graph: [[1,2],[],[]]"].join("\n")
    );
    const s = frameAt(p, p.stepCount - 1);
    expect(s.main.adjacency).toEqual([[1, 2], [], []]);
    expect(s.main.nodes).toEqual({});
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: PASS (the `@id`/mode/replace logic from Tasks 2–4 already covers this). If any assertion fails, fix the relevant parser branch until green — do not edit the tests.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/graph-directives.test.ts apps/web/src/lib/graph-directives.ts
git commit -m "test(graph): cover @id multi-graph, undirected, structure replace"
```

---

### Task 6: Caps + warnings

**Files:**
- Modify: `apps/web/src/lib/graph-directives.ts` (coverage; logic from Task 2)
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("caps and warnings", () => {
  it("rejects a graph over 500 nodes with a warning", () => {
    const big = JSON.stringify(Array.from({ length: 501 }, () => []));
    const p = parseGraphProgram(`graph: ${big}`);
    expect(p.stepCount).toBe(0);
    expect(p.warnings.some((w) => w.includes("max 500"))).toBe(true);
  });

  it("rejects more than 8 graphs with a warning", () => {
    const lines = Array.from({ length: 9 }, (_, i) => `graph@g${i}: [[]]`);
    const p = parseGraphProgram(lines.join("\n"));
    expect(p.stepCount).toBe(8);
    expect(p.warnings.some((w) => w.includes("more than 8 graphs"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: PASS (caps implemented in Task 2). If the warning strings differ, align the parser's warning text to contain `max 500` and `more than 8 graphs` — do not weaken the tests.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/graph-directives.test.ts apps/web/src/lib/graph-directives.ts
git commit -m "test(graph): cover node/graph caps + warnings"
```

---

### Task 7: `stripGraphDirectives` for clean stdout

**Files:**
- Modify: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { stripGraphDirectives } from "./graph-directives";

describe("stripGraphDirectives", () => {
  it("removes recognized directive lines (valid or not) and keeps real output", () => {
    const stdout = [
      "starting",
      "graph: [[1],[0]]",
      "graph_node:0:color:1",
      "graph@tree:undirected: [[]]",
      "graph_edge:0:1:label:x",
      "done",
    ].join("\n");
    expect(stripGraphDirectives(stdout)).toBe("starting\ndone");
  });

  it("leaves lines that merely start with the word graph but are not directives", () => {
    expect(stripGraphDirectives("graphing is fun")).toBe("graphing is fun");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — `stripGraphDirectives` not exported.

- [ ] **Step 3: Implement**

Append to `apps/web/src/lib/graph-directives.ts`:
```ts
// Matches the directive keyword shape (with optional @id). Strips even invalid
// directives so stdout stays clean; validity is surfaced via the graph panel.
const DIRECTIVE_RE = /^graph(_node|_edge)?(@[A-Za-z0-9_-]+)?:/;

export function stripGraphDirectives(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !DIRECTIVE_RE.test(line.trim()))
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: PASS. Then run the full suite: `pnpm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): stripGraphDirectives to clean run output"
```

---

### Task 8: `useCytoscapeGraph` hook (one canvas per graph)

**Files:**
- Create: `apps/web/src/components/pad/useCytoscapeGraph.ts`

- [ ] **Step 1: Implement the hook**

Create `apps/web/src/components/pad/useCytoscapeGraph.ts`:
```ts
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useRef } from "react";
import type { SingleGraphState } from "./graph-types";

export const LAYOUTS = ["breadthfirst", "cose", "circle", "grid"] as const;
export type LayoutName = (typeof LAYOUTS)[number];

function toElements(s: SingleGraphState): ElementDefinition[] {
  const nodes: ElementDefinition[] = s.adjacency.map((_, i) => {
    const deco = s.nodes[i] ?? {};
    const label = deco.info ? `${i}\n${deco.info}` : `${i}`;
    return { data: { id: `n${i}`, label, color: deco.color ?? "" } };
  });

  const seen = new Set<string>();
  const edges: ElementDefinition[] = [];
  s.adjacency.forEach((row, src) => {
    row.forEach((dst) => {
      const key =
        s.mode === "undirected"
          ? [src, dst].sort((a, b) => a - b).join("-")
          : `${src}->${dst}`;
      if (seen.has(key)) return;
      seen.add(key);
      const deco =
        s.edges[`${src}->${dst}`] ??
        (s.mode === "undirected" ? s.edges[`${dst}->${src}`] : undefined) ??
        {};
      edges.push({
        data: {
          id: `e${src}-${dst}`,
          source: `n${src}`,
          target: `n${dst}`,
          label: deco.label ?? "",
          color: deco.color ?? "",
        },
        classes: s.mode === "undirected" ? "undirected" : "",
      });
    });
  });

  return [...nodes, ...edges];
}

function buildStyle(isDark: boolean): cytoscape.Stylesheet[] {
  const text = isDark ? "#e4e4e7" : "#18181b";
  const nodeBg = isDark ? "#3f3f46" : "#d4d4d8";
  const line = isDark ? "#71717a" : "#a1a1aa";
  return [
    {
      selector: "node",
      style: {
        "background-color": (ele) => ele.data("color") || nodeBg,
        label: "data(label)",
        color: text,
        "text-wrap": "wrap",
        "text-valign": "center",
        "text-halign": "center",
        "font-size": 11,
        width: 36,
        height: 36,
      },
    },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": (ele) => ele.data("color") || line,
        "target-arrow-color": (ele) => ele.data("color") || line,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": 10,
        color: text,
      },
    },
    { selector: "edge.undirected", style: { "target-arrow-shape": "none" } },
  ];
}

// Renders one graph into a container. Re-layout happens only when the graph's
// structure (adjacency + mode) changes, so node positions stay fixed while
// stepping through color/info/edge changes.
export function useCytoscapeGraph(
  state: SingleGraphState,
  layout: LayoutName,
  isDark: boolean
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const structureKeyRef = useRef<string>("");

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({ container: containerRef.current, elements: [] });
    cyRef.current = cy;
    structureKeyRef.current = "";
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.json({ elements: toElements(state) });
    cy.style(buildStyle(isDark));
    const structureKey = `${state.mode}:${JSON.stringify(state.adjacency)}`;
    if (structureKey !== structureKeyRef.current) {
      cy.layout({ name: layout, padding: 12 }).run();
      structureKeyRef.current = structureKey;
    }
  }, [state, layout, isDark]);

  return containerRef;
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (If the cytoscape `Stylesheet` style-function typing complains, the mapper functions are valid at runtime; adjust the style array's type annotation to `cytoscape.StylesheetStyle[]` or cast the style functions — keep behavior identical.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/pad/useCytoscapeGraph.ts
git commit -m "feat(graph): cytoscape canvas hook with stable layout"
```

---

### Task 9: `GraphView` panel component

**Files:**
- Create: `apps/web/src/components/pad/GraphView.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/src/components/pad/GraphView.tsx`:
```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { clampStep, frameAt } from "@/lib/graph-directives";
import type { GraphProgram } from "./graph-types";
import type { SingleGraphState } from "./graph-types";
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
  const [rawStep, setRawStep] = useState(0);
  const [layout, setLayout] = useState<LayoutName>("breadthfirst");
  const [showHelp, setShowHelp] = useState(false);

  // A new run resets the timeline to the final step.
  useEffect(() => {
    setRawStep(program.stepCount - 1);
  }, [program]);

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
          {program.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
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
          ids.map((id) => (
            <GraphCanvas
              key={id}
              state={state[id]!}
              layout={layout}
              isDark={isDark}
            />
          ))
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
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/pad/GraphView.tsx
git commit -m "feat(graph): GraphView panel with step timeline + usage toggle"
```

---

### Task 10: Wire into `PadEditorInner` (split + Python gate + stdout strip)

**Files:**
- Modify: `apps/web/src/components/PadEditorInner.tsx`
- Modify: `apps/web/src/components/pad/RunOutput.tsx`

- [ ] **Step 1: Filter directives out of RunOutput stdout**

In `apps/web/src/components/pad/RunOutput.tsx`, import the stripper and apply it to the success branch's stdout. Add at top:
```ts
import { stripGraphDirectives } from "@/lib/graph-directives";
```

Replace the stdout block in the success panel:
```tsx
      {result.stdout ? (
        <pre className="whitespace-pre-wrap text-zinc-100">{result.stdout}</pre>
      ) : null}
```
with:
```tsx
      {stripGraphDirectives(result.stdout) ? (
        <pre className="whitespace-pre-wrap text-zinc-100">
          {stripGraphDirectives(result.stdout)}
        </pre>
      ) : null}
```

- [ ] **Step 2: Add the resizable split + Python gate in `PadEditorInner`**

In `apps/web/src/components/PadEditorInner.tsx`, add imports near the existing ones:
```ts
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { GraphView } from "@/components/pad/GraphView";
import { parseGraphProgram } from "@/lib/graph-directives";
```

After `const language = findLanguage(languageId);` add the derived program:
```ts
  const showGraph = languageId === "python";
  const stdout =
    output && !("error" in output) ? output.stdout : "";
  const graphProgram = useMemo(() => parseGraphProgram(stdout), [stdout]);
```

Replace the editor container block:
```tsx
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
```
with:
```tsx
      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal" autoSaveId="piepad-graph-split">
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
              <PanelResizeHandle className="w-1 bg-divider hover:bg-primary" />
              <Panel
                defaultSize={35}
                minSize={20}
                collapsible
                collapsedSize={0}
              >
                <GraphView program={graphProgram} />
              </Panel>
            </>
          ) : null}
        </PanelGroup>
      </div>
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PadEditorInner.tsx apps/web/src/components/pad/RunOutput.tsx
git commit -m "feat(graph): wire collapsible graph split into pad editor (python only)"
```

---

### Task 11: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start dev servers**

Run (two terminals, from repo root):
```bash
pnpm dev:ws
pnpm dev:web
```
Ensure Piston is up for Python (`pnpm piston:up` if needed).

- [ ] **Step 2: Open a pad, select Python, paste this snippet, press Run**

```python
print("graph: [[1,2],[0,3],[0,3],[1,2]]")
print("graph_edge:0:1:label:5")
print("graph_node:0:color:6")
print("graph_node:0:info:start")
print("graph_node:1:color:4")
print("graph@tree:undirected: [[1,2],[],[]]")
print("graph_node@tree:0:color:1")
print("regular output line")
```

- [ ] **Step 3: Verify behavior — confirm each:**

- [ ] Graph panel is visible to the right of the editor (Python selected).
- [ ] Two graphs render: `[@main] directed` (with arrows + edge label `5`) and `[@tree] undirected` (no arrows).
- [ ] Node 0 of `@main` is colored and shows `start` beneath it; node 1 colored.
- [ ] `◀ ▶` step through the timeline; the slider + `step k/N` update; node colors appear incrementally; **node positions do not jump** when only colors change.
- [ ] The `?` toggle shows/hides the usage block.
- [ ] The bottom RunOutput shows only `regular output line` (directive lines stripped).
- [ ] Dragging the resize handle resizes; collapsing the panel gives the editor full width and editing still works.
- [ ] Switch language to TypeScript → graph panel and split disappear; editor is full width.

- [ ] **Step 4: Fix any discrepancies**

If a check fails, debug the relevant module (parser → `graph-directives.test.ts`; rendering → `useCytoscapeGraph.ts`; layout/gate → `PadEditorInner.tsx`) and re-verify. Add a regression test to `graph-directives.test.ts` for any parser bug found.

- [ ] **Step 5: Final full check + commit (if fixes were made)**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.
```bash
git add -A
git commit -m "fix(graph): address manual verification findings"
```

---

## Self-Review

**Spec coverage:**
- Right-split, collapsible, stays during editing → Task 10 (react-resizable-panels collapsible Panel).
- Python only → Task 10 `showGraph` gate.
- `graph:` adjacency rendering → Tasks 2, 8.
- `graph_node:color` (1..16 via PALETTE) → Tasks 3, 8.
- `graph_node:info` under node → Tasks 3, 8 (`label` newline).
- Unsupported formats ignored → Tasks 2–6 (line-by-line null).
- Usage toggle → Task 9.
- Step timeline `< >` user-controlled → Task 9.
- Edge labels/weights + edge color → Tasks 4, 8.
- Multiple graphs via `@id` → Tasks 5, 9 (one canvas each).
- Directed/undirected → Tasks 2, 5, 8.
- Caps/warnings, no silent truncation → Tasks 2, 6, 9.
- stdout cleanliness → Tasks 7, 10.
- Local-only (no Yjs) → Task 10 (derives from local `output` state only).

**Placeholder scan:** none — every code step contains full code; verification steps list concrete checks.

**Type consistency:** `GraphProgram`, `GraphEvent`, `SingleGraphState`, `MultiGraphState`, `NodeDeco`, `EdgeDeco`, `GraphMode` defined in Task 2 and used unchanged in Tasks 3–10. Functions `parseGraphProgram`, `frameAt`, `clampStep`, `stripGraphDirectives` and the hook `useCytoscapeGraph(state, layout, isDark)` / `LayoutName` / `LAYOUTS` are referenced with matching signatures across tasks.
