# Multi-Attribute Directives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one `graph_node`/`graph_edge` directive carry multiple attributes (e.g. `graph_node:0:color:6:info:hello`) so colour + info/label change together in a single timeline step.

**Architecture:** The directive parser reads a chain of `attr:value` pairs (`color` = one numeric token, `info`/`label` = terminal, consumes the rest) into a partial decoration object, and emits ONE event carrying that `deco`. `applyEvent` merges the `deco` into the node/edge. `frameAt`'s output (`SingleGraphState`) is unchanged, so rendering is untouched.

**Tech Stack:** TypeScript, Vitest (node env). Commands from `apps/web/`.

**Spec:** `docs/superpowers/specs/2026-06-11-multi-attr-directives-design.md`

**Testing note:** parser is pure — tested via `parseGraphProgram` + `frameAt` (matches existing style). The `GraphView` change is verified by typecheck/lint + manual run. Pre-existing `PadEditorInner.tsx` `react-hooks/refs` lint error is out of scope — leave it.

---

### Task 1: Parse attr:value chains into a `deco` event

**Files:**
- Modify: `apps/web/src/components/pad/graph-types.ts`
- Modify: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Change the `GraphEvent` node/edge variants to carry `deco`**

In `apps/web/src/components/pad/graph-types.ts`, replace:
```ts
export type GraphEvent =
  | { kind: "graph"; id: string; mode: GraphMode; adjacency: number[][] }
  | { kind: "node"; id: string; node: number; attr: "color" | "info"; value: string }
  | { kind: "edge"; id: string; src: number; dst: number; attr: "color" | "label"; value: string };
```
with:
```ts
export type GraphEvent =
  | { kind: "graph"; id: string; mode: GraphMode; adjacency: number[][] }
  | { kind: "node"; id: string; node: number; deco: NodeDeco }
  | { kind: "edge"; id: string; src: number; dst: number; deco: EdgeDeco };
```
(`NodeDeco` and `EdgeDeco` are already declared above in this file.)

- [ ] **Step 2: Add the new combined-directive tests + migrate the existing event-shape assertions**

In `apps/web/src/lib/graph-directives.test.ts`:

(a) **Migrate** these existing assertions to the new `deco` shape:

- The node color/info block (currently `expect(p.events[1]).toEqual({ kind:"node", id:"main", node:0, attr:"color", value: PALETTE[0] })` and the `events[2]` info one) becomes:
```ts
    expect(p.events[1]).toEqual({
      kind: "node",
      id: "main",
      node: 0,
      deco: { color: PALETTE[0] },
    });
    expect(p.events[2]).toEqual({
      kind: "node",
      id: "main",
      node: 0,
      deco: { info: "children 1" },
    });
```
- `expect(p.events[1]).toMatchObject({ attr: "info", value: "a:b:c" });` → `expect(p.events[1]).toMatchObject({ deco: { info: "a:b:c" } });`
- `expect(p.events[1]).toMatchObject({ attr: "info", value: "line1\nline2" });` → `expect(p.events[1]).toMatchObject({ deco: { info: "line1\nline2" } });`
- The edge color assertion `expect(p.events[1]).toEqual({ kind: "edge", id: "main", src: 0, dst: 1, attr: "color", value: PALETTE[2] });` → `expect(p.events[1]).toEqual({ kind: "edge", id: "main", src: 0, dst: 1, deco: { color: PALETTE[2] } });`

(After implementing, run the suite; any other `attr:`/`value:` event-shape assertion that fails follows the same rule: `{ attr: A, value: V }` → `{ deco: { [A]: V } }`. Assertions on `frameAt` output, e.g. `s.main.nodes[0]`/`s.main.edges["0->1"]`, do NOT change.)

(b) **Append** new combined-directive tests:
```ts
describe("combined attributes in one directive", () => {
  it("sets node color + info in a single event/step", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:color:6:info:hello");
    expect(p.stepCount).toBe(2);
    expect(p.events[1]).toEqual({
      kind: "node",
      id: "main",
      node: 0,
      deco: { color: PALETTE[5], info: "hello" },
    });
    expect(frameAt(p, 1).main.nodes[0]).toEqual({ color: PALETTE[5], info: "hello" });
  });

  it("sets edge color + label in one event", () => {
    const p = parseGraphProgram("graph: [[1],[0]]\ngraph_edge:0:1:color:3:label:w=5");
    expect(frameAt(p, p.stepCount - 1).main.edges["0->1"]).toEqual({
      color: PALETTE[2],
      label: "w=5",
    });
  });

  it("terminal info keeps colons after a color pair", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:color:1:info:a:b");
    expect(frameAt(p, 1).main.nodes[0]).toEqual({ color: PALETTE[0], info: "a:b" });
  });

  it("last color wins when repeated before info", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:color:1:color:2:info:x");
    expect(frameAt(p, 1).main.nodes[0]).toEqual({ color: PALETTE[1], info: "x" });
  });

  it("converts literal \\n in combined info", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:color:1:info:a\\nb");
    expect(frameAt(p, 1).main.nodes[0]).toEqual({ color: PALETTE[0], info: "a\nb" });
  });

  it("empty terminal info is allowed", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:color:1:info:");
    expect(frameAt(p, 1).main.nodes[0]).toEqual({ color: PALETTE[0], info: "" });
  });

  it("ignores the whole line on a bad part (bad color, unknown attr, missing value, no attr)", () => {
    expect(parseGraphProgram("graph: [[]]\ngraph_node:0:color:99:info:x").stepCount).toBe(1);
    expect(parseGraphProgram("graph: [[]]\ngraph_node:0:foo:1").stepCount).toBe(1);
    expect(parseGraphProgram("graph: [[]]\ngraph_node:0:color:").stepCount).toBe(1);
    expect(parseGraphProgram("graph: [[]]\ngraph_node:0").stepCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — `deco` doesn't exist on events yet; combined directives produce single/again events.

- [ ] **Step 4: Implement the pair-chain parser + merge**

In `apps/web/src/lib/graph-directives.ts`, replace the whole `parseNodeLine` and `parseEdgeLine` functions (the two functions spanning the current `function parseNodeLine(...) { ... }` through the end of `function parseEdgeLine(...) { ... }`) with:
```ts
// Parse a chain of `attr:value` pairs. `color` consumes one numeric token
// (1..16 -> PALETTE hex); the terminal attr (`info`/`label`) consumes the rest
// of the line (so it may contain colons). Returns null on any invalid/unknown
// part, a missing value, or if no attribute was set. `convertNewlines` turns a
// literal "\n" in the terminal value into a real newline (node info only).
function parseDecoChain(
  rest: string,
  terminalAttr: "info" | "label",
  convertNewlines: boolean
): Record<string, string> | null {
  const deco: Record<string, string> = {};
  let s = rest;
  let any = false;
  while (s.length > 0) {
    const colon = s.indexOf(":");
    if (colon === -1) return null; // attr without a value
    const attr = s.slice(0, colon);
    const after = s.slice(colon + 1);
    if (attr === terminalAttr) {
      deco[attr] = convertNewlines ? after.replace(/\\n/g, "\n") : after;
      any = true;
      break;
    }
    if (attr === "color") {
      const next = after.indexOf(":");
      const token = next === -1 ? after : after.slice(0, next);
      const c = parseIndex(token);
      if (c === null || c < 1 || c > 16) return null;
      deco.color = PALETTE[c - 1]!;
      any = true;
      s = next === -1 ? "" : after.slice(next + 1);
      continue;
    }
    return null; // unknown attr
  }
  return any ? deco : null;
}

function parseNodeLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>
): GraphEvent | null {
  const adj = structures.get(id);
  if (!adj) return null; // node before graph for this id
  const colon = body.indexOf(":");
  if (colon === -1) return null;
  const node = parseIndex(body.slice(0, colon));
  if (node === null || node >= adj.length) return null;
  const deco = parseDecoChain(body.slice(colon + 1), "info", true);
  if (!deco) return null;
  return { kind: "node", id, node, deco: deco as NodeDeco };
}

function parseEdgeLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>
): GraphEvent | null {
  const adj = structures.get(id);
  if (!adj) return null;
  const c1 = body.indexOf(":");
  if (c1 === -1) return null;
  const srcN = parseIndex(body.slice(0, c1));
  const after = body.slice(c1 + 1);
  const c2 = after.indexOf(":");
  if (c2 === -1) return null;
  const dstN = parseIndex(after.slice(0, c2));
  if (srcN === null || dstN === null || srcN >= adj.length || dstN >= adj.length) {
    return null;
  }
  const deco = parseDecoChain(after.slice(c2 + 1), "label", false);
  if (!deco) return null;
  return { kind: "edge", id, src: srcN, dst: dstN, deco: deco as EdgeDeco };
}
```
Add `NodeDeco` and `EdgeDeco` to the type import at the top of the file (the existing `import type { ... } from "@/components/pad/graph-types";` block) if they are not already imported.

Then update `applyEvent` — replace:
```ts
  if (ev.kind === "node") {
    g.nodes[ev.node] = { ...(g.nodes[ev.node] ?? {}), [ev.attr]: ev.value };
  }
  if (ev.kind === "edge") {
    const key = `${ev.src}->${ev.dst}`;
    g.edges[key] = { ...(g.edges[key] ?? {}), [ev.attr]: ev.value };
  }
```
with:
```ts
  if (ev.kind === "node") {
    g.nodes[ev.node] = { ...(g.nodes[ev.node] ?? {}), ...ev.deco };
  }
  if (ev.kind === "edge") {
    const key = `${ev.src}->${ev.dst}`;
    g.edges[key] = { ...(g.edges[key] ?? {}), ...ev.deco };
  }
```

The now-unused `splitMax` helper: check whether anything else still uses it (`grep splitMax`). If `parseGraphLine` or others still use it, leave it. If nothing uses it anymore, delete the `splitMax` function to avoid a dead-code/lint warning.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/lib/graph-directives.test.ts` → all pass (migrated + new + existing). Then `pnpm test` (full) → green. Then `pnpm typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/pad/graph-types.ts apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): multi-attribute directives (color+info/label in one step)"
```

---

### Task 2: GraphView info footer reads the new event shape

**Files:**
- Modify: `apps/web/src/components/pad/GraphView.tsx`

- [ ] **Step 1: Update the `infoLine` derivation**

In `apps/web/src/components/pad/GraphView.tsx`, replace:
```ts
  const currentEvent = program.events[step];
  const infoLine =
    currentEvent?.kind === "node" && currentEvent.attr === "info"
      ? currentEvent.value
      : "";
```
with:
```ts
  const currentEvent = program.events[step];
  const infoLine =
    currentEvent?.kind === "node" ? currentEvent.deco.info ?? "" : "";
```
(Shows the info set by the current step's node directive, if any — including when it was set alongside a colour in the same directive.)

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: typecheck clean; lint shows only the pre-existing `PadEditorInner.tsx` error.

- [ ] **Step 3: Build (catches client/SSR issues)**

Run (repo root): `pnpm --filter @piepad/web build`
Expected: Compiled successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/pad/GraphView.tsx
git commit -m "feat(graph): info footer reads combined node deco"
```

---

### Task 3: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start dev (`pnpm dev:ws`, `pnpm dev:web`, Piston up). Open a pad, Python, paste, Run:**

```python
print("graph: [[1,2],[],[]]")
print("graph_node:0:color:6:info:start here")
print("graph_edge:0:1:color:4:label:w=5")
print("graph_node:0:color:2:info:done:final")
print("regular output line")
```

- [ ] **Step 2: Verify — confirm each:**

- [ ] Stepping the timeline: the directive `graph_node:0:color:6:info:start here` advances **one** step and node 0 gets **both** the colour and the `start here` label at the same time (not two steps).
- [ ] The edge 0→1 shows colour + label `w=5` together.
- [ ] The last directive recolours node 0 and its info becomes `done:final` (terminal info keeps the colon) — colour + info change together.
- [ ] The bottom info footer shows the current step's info text.
- [ ] Backward compat: a plain `graph_node:0:color:1` (single attr) still works.
- [ ] RunOutput shows only `regular output line`.

- [ ] **Step 3: Fix any discrepancies, add a regression test in `graph-directives.test.ts` for any parser bug found, then:**

Run: `pnpm test && pnpm typecheck && pnpm lint`
```bash
git add -A
git commit -m "fix(graph): address multi-attr directive verification findings"
```

---

## Self-Review

**Spec coverage:**
- Combined `attr:value` chain, color single-token, info/label terminal → Task 1 `parseDecoChain`.
- color repeatable, last wins → Task 1 (loop overwrites `deco.color`) + test.
- One event per directive (one timeline step) → Task 1 (single `deco` event) + applyEvent merge + step test.
- Event model change to `deco` → Task 1 Step 1 + applyEvent.
- frameAt/render unchanged → no rendering task; verified by unchanged `SingleGraphState` assertions.
- Backward compat (single-attr still parses) → migrated existing tests + a plain-color manual check.
- `\n` in info preserved → Task 1 (`convertNewlines` true for node info) + test.
- Validation: bad part → whole line ignored; no-attr ignored; empty info allowed → Task 1 tests.
- GraphView info footer → Task 2.

**Placeholder scan:** none — all code steps are complete. The "any other failing assertion follows the same rule" note is a precise mechanical transform (`{attr,value}` → `{deco:{[attr]:value}}`) with examples, not a vague placeholder.

**Type consistency:** `GraphEvent` node/edge now use `deco: NodeDeco`/`deco: EdgeDeco`; `parseDecoChain` returns `Record<string,string> | null`, cast to `NodeDeco`/`EdgeDeco` at the call sites (keys are `color` + the terminal attr, matching the types). `applyEvent` spreads `ev.deco`. `parseIndex`, `PALETTE`, `structures: Map<string, number[][]>` reused unchanged. `GraphView` reads `currentEvent.deco.info`.
