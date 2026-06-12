# Color Aliases + `color:0`=default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept named color aliases (`visited`/`visiting`/`unvisited`/`edge_visited`/`edge_visited2`) and make `color:0` mean "default/uncoloured" (the themed default node colour), in directive `color:` values.

**Architecture:** A pure `resolveColor(token)` maps an alias name OR `0..16` to a hex (or `""` for 0, or `null` for invalid), used in the shared `parseDecoChain` color branch (covers node + edge). The renderer already falls back to the themed default when `data("color")` is empty, so `color:0` → `""` renders like an un-coloured element. The help legend gains a `0 default` swatch and the USAGE text lists the aliases.

**Tech Stack:** TypeScript, Vitest (node env). Commands from `apps/web/`. Lint is clean — keep it clean.

**Spec:** `docs/superpowers/specs/2026-06-11-color-aliases-design.md`

---

### Task 1: Color resolver (aliases + `0`=default) in the parser

**Files:**
- Modify: `apps/web/src/lib/graph-directives.ts`
- Test: `apps/web/src/lib/graph-directives.test.ts`

- [ ] **Step 1: Write the failing tests (append to `apps/web/src/lib/graph-directives.test.ts`)**

```ts
describe("color aliases + color:0=default", () => {
  it("resolves node color aliases to the right PALETTE hex", () => {
    const p = parseGraphProgram(
      "graph: [[1],[0]]\ngraph_node:0:color:visited\ngraph_node:1:color:visiting"
    );
    const s = frameAt(p, p.stepCount - 1);
    expect(s.main.nodes[0]).toEqual({ color: PALETTE[6] });  // visited = 7
    expect(s.main.nodes[1]).toEqual({ color: PALETTE[15] }); // visiting = 16
  });

  it("resolves edge color aliases", () => {
    const p = parseGraphProgram(
      "graph: [[1],[0]]\ngraph_edge:0:1:color:edge_visited\ngraph_edge:1:0:color:edge_visited2"
    );
    const s = frameAt(p, p.stepCount - 1);
    expect(s.main.edges["0->1"]).toEqual({ color: PALETTE[9] });  // 10
    expect(s.main.edges["1->0"]).toEqual({ color: PALETTE[10] }); // 11
  });

  it("color:0 and color:unvisited resolve to empty (default/uncoloured)", () => {
    const p = parseGraphProgram(
      "graph: [[1],[0]]\ngraph_node:0:color:0\ngraph_node:1:color:unvisited"
    );
    const s = frameAt(p, p.stepCount - 1);
    expect(s.main.nodes[0]).toEqual({ color: "" });
    expect(s.main.nodes[1]).toEqual({ color: "" });
  });

  it("unvisited reverts an already-coloured node to default", () => {
    const p = parseGraphProgram(
      "graph: [[]]\ngraph_node:0:color:visited\ngraph_node:0:color:unvisited"
    );
    expect(frameAt(p, p.stepCount - 1).main.nodes[0]).toEqual({ color: "" });
  });

  it("an unknown alias ignores the whole line", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:color:bogus");
    expect(p.stepCount).toBe(1); // only the graph: event
    expect(frameAt(p, 0).main.nodes[0]).toBeUndefined();
  });

  it("aliases work in a combined directive", () => {
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:color:visiting:info:hi");
    expect(frameAt(p, 1).main.nodes[0]).toEqual({ color: PALETTE[15], info: "hi" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/graph-directives.test.ts`
Expected: FAIL — aliases not recognized (`color:visited` → `parseIndex` null → line ignored); `color:0` rejected (`c < 1`).

- [ ] **Step 3: Implement** in `apps/web/src/lib/graph-directives.ts`

(a) Add the alias map + resolver just above `function parseDecoChain(` (after `parseIndex`):
```ts
const COLOR_ALIASES: Record<string, number> = {
  unvisited: 0,
  visited: 7,
  visiting: 16,
  edge_visited: 10,
  edge_visited2: 11,
};

// Resolve a color token (alias name or 0..16) to a PALETTE hex, or "" for 0
// (default/uncoloured — the renderer falls back to the themed default), or null
// when invalid (→ the directive line is ignored).
function resolveColor(token: string): string | null {
  const t = token.trim();
  const n = t in COLOR_ALIASES ? COLOR_ALIASES[t]! : parseIndex(t);
  if (n === null) return null;
  if (n === 0) return "";
  if (n < 1 || n > 16) return null;
  return PALETTE[n - 1]!;
}
```

(b) In `parseDecoChain`'s `color` branch, replace:
```ts
      const c = parseIndex(token);
      if (c === null || c < 1 || c > 16) return null;
      deco.color = PALETTE[c - 1]!;
```
with:
```ts
      const hex = resolveColor(token);
      if (hex === null) return null; // invalid color/alias → ignore whole line
      deco.color = hex; // hex, or "" for color:0 (themed default)
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run src/lib/graph-directives.test.ts` → all pass. Then `pnpm test` (full) → green. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/graph-directives.ts apps/web/src/lib/graph-directives.test.ts
git commit -m "feat(graph): color aliases (visited/visiting/...) + color:0=default"
```

---

### Task 2: Legend `0 default` swatch + alias usage text

**Files:**
- Modify: `apps/web/src/components/pad/useCytoscapeGraph.ts`
- Modify: `apps/web/src/components/pad/GraphView.tsx`

- [ ] **Step 1: Export the default node bg from the hook**

In `apps/web/src/components/pad/useCytoscapeGraph.ts`, add a const near the top
(after the `LAYOUTS` export) and use it in `buildStyle`.

Add:
```ts
// Default node background per theme — also the colour `color:0` ("default")
// resolves to, surfaced in the GraphView legend.
export const DEFAULT_NODE_BG = { dark: "#3f3f46", light: "#d4d4d8" } as const;
```
Then in `buildStyle`, replace:
```ts
  const nodeBg = isDark ? "#3f3f46" : "#d4d4d8";
```
with:
```ts
  const nodeBg = isDark ? DEFAULT_NODE_BG.dark : DEFAULT_NODE_BG.light;
```

- [ ] **Step 2: GraphView — import the const**

In `apps/web/src/components/pad/GraphView.tsx`, change:
```ts
import { type LayoutName, useCytoscapeGraph } from "./useCytoscapeGraph";
```
to:
```ts
import {
  DEFAULT_NODE_BG,
  type LayoutName,
  useCytoscapeGraph,
} from "./useCytoscapeGraph";
```

- [ ] **Step 3: Add the alias line to USAGE**

In the `USAGE` template string, add this line right after the
`graph_node:0:color:1 …` line:
```
  color names: unvisited(0) visited(7) visiting(16) edge_visited(10) edge_visited2(11)
```

- [ ] **Step 4: Add a `0 default` swatch before the 1..16 swatches**

In the legend block, replace:
```tsx
          {/* colour number -> colour mapping (1..16) */}
          <div className="flex flex-wrap gap-x-2 gap-y-1 px-2 pb-2 pt-1">
            {PALETTE.map((hex, i) => (
              <span
                key={hex}
                title={COLOR_NAMES[i]}
                className="flex items-center gap-1 font-mono text-[10px] text-default-600"
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-divider"
                  style={{ background: hex }}
                />
                {i + 1} {COLOR_NAMES[i]}
              </span>
            ))}
          </div>
```
with:
```tsx
          {/* colour number -> colour mapping (0 = default, 1..16 = palette) */}
          <div className="flex flex-wrap gap-x-2 gap-y-1 px-2 pb-2 pt-1">
            <span
              title="default / unvisited"
              className="flex items-center gap-1 font-mono text-[10px] text-default-600"
            >
              <span
                className="inline-block h-3 w-3 rounded-sm border border-divider"
                style={{
                  background: isDark ? DEFAULT_NODE_BG.dark : DEFAULT_NODE_BG.light,
                }}
              />
              0 default
            </span>
            {PALETTE.map((hex, i) => (
              <span
                key={hex}
                title={COLOR_NAMES[i]}
                className="flex items-center gap-1 font-mono text-[10px] text-default-600"
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-divider"
                  style={{ background: hex }}
                />
                {i + 1} {COLOR_NAMES[i]}
              </span>
            ))}
          </div>
```
(`isDark` is already in scope in `GraphView`.)

- [ ] **Step 5: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint` → clean. Then (repo root) `pnpm --filter @piepad/web build` → Compiled successfully.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/pad/useCytoscapeGraph.ts apps/web/src/components/pad/GraphView.tsx
git commit -m "feat(graph): legend 0=default swatch + color alias names in usage help"
```

---

### Task 3: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start dev (`pnpm dev:ws`, `pnpm dev:web`, Piston up). Open a pad, Python, paste, Run:**

```python
print("graph: [[1,2],[],[]]")
print("graph_node:0:color:visiting")
print("graph_node:1:color:visited")
print("graph_node:2:color:unvisited")
print("graph_edge:0:1:color:edge_visited")
print("graph_node:0:color:0")
```

- [ ] **Step 2: Verify — confirm each:**

- [ ] Node 0 is colour 16 (pink) then, at the last step, reverts to the **default gray** (same as un-coloured node 2) — and that gray matches an un-coloured node in BOTH light and dark themes (toggle theme to check).
- [ ] Node 1 = colour 7; node 2 = default gray; edge 0→1 = colour 10.
- [ ] `?` help: USAGE shows the `color names:` alias line; the legend shows a `0 default` swatch before `1 red … 16 pink`.
- [ ] A typo alias (e.g. `graph_node:0:color:visted`) is ignored (no colour change, line not shown in output).

- [ ] **Step 3: Fix any discrepancy; add a regression test for any parser bug; then:**

Run: `pnpm test && pnpm typecheck && pnpm lint`
```bash
git add -A
git commit -m "fix(graph): address color-alias verification findings"
```

---

## Self-Review

**Spec coverage:**
- Named aliases (5) → Task 1 `COLOR_ALIASES` + tests (node & edge).
- `color:0` = default (`""`, themed fallback) → Task 1 `resolveColor` + tests; renderer fallback already exists (no renderer change).
- `unvisited` reverts to default → Task 1 test.
- aliases global (node+edge), work in combined directives → Task 1 (shared `parseDecoChain`) + combined test.
- invalid alias → line ignored → Task 1 test.
- legend `0 default` swatch (themed) + USAGE alias line → Task 2; `DEFAULT_NODE_BG` exported and shared with `buildStyle`.

**Placeholder scan:** none — all steps have exact code.

**Type consistency:** `resolveColor(token: string): string | null` (`""` = default, `null` = invalid); used in `parseDecoChain` which already returns `Record<string,string>|null`. `COLOR_ALIASES: Record<string, number>`. `parseIndex`/`PALETTE` reused. `DEFAULT_NODE_BG = { dark, light }` exported from `useCytoscapeGraph`, consumed by `buildStyle` and `GraphView`. No change to `GraphEvent`, `frameAt`, `applyEvent`, `messageFor`, `DIRECTIVE_RE`, or the renderer's empty-color fallback.
