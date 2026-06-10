# PiePad Graph View — Design Spec

**Date:** 2026-06-10
**Status:** Approved (pending implementation plan)

## 1. Purpose

Help users understand the data structures their Python code builds (trees,
graphs, MSTs, BFS/DFS traversals) by rendering them visually beside the editor.
The user emits special directives via `print(...)`; a collapsible split panel
parses the run's stdout and draws the graph, with a user-controlled timeline to
step through algorithm progress.

Scope is **Python only**. For any other language the panel and its toggle are
hidden entirely.

## 2. User Experience

### 2.1 Layout — right vertical split

```
┌─────────────┬──────────────────────┐
│             │  [Graph]  layout▾  ?ⓘ│  header: layout dropdown + usage toggle
│   editor    │   [@main] directed   │
│             │      ①─⟶⓪─⟶②  w=5  │
│             │   red    'children 1' │
│             │  ───────────────────  │
│             │   [@mst] undirected   │
│             │      ①──⓪  ②        │
│             │                       │
│             │  ◀ ▶  step 5/12  ●──── │  global timeline (< > user-controlled)
│             │  'visiting node 0'    │
├─────────────┴──────────────────────┤
│ args  [Run ▶] [Clear]               │
│ RunOutput (directive lines hidden)  │
└─────────────────────────────────────┘
```

- The panel sits to the **right of the Monaco editor**, in a horizontal split.
  It stays visible while editing code (it is **not** a drawer).
- **Collapse/expand**: a toggle in the panel header (and the drag handle)
  collapses the panel so the editor takes full width; expanding restores the
  split. Implemented with `react-resizable-panels` (collapsible `Panel` +
  imperative collapse + width persistence).
- Gated on `languageId === "python"`. When the language is not Python, neither
  the panel nor the toggle is rendered.
- **Usage toggle** (`?` in the panel header) shows/hides an inline help block
  documenting the directive syntax. Default off.
- The bottom `RunOutput` panel is unchanged in position, but recognized
  directive lines are **stripped** from the displayed stdout (they are consumed
  by the graph view); all other stdout is shown normally.

### 2.2 Timeline / stepping

- **One step = one directive event.** The global timeline spans every
  recognized directive across all graphs, in stdout order.
- `◀ ▶` buttons (user-controlled, as required) and a slider move the current
  step. A `step k/N` counter and the current event's `info` text are shown.
- color/info/edge decorations **accumulate** as the step advances
  (last-write-wins per attribute). Stepping backward removes later events.
- Default position on a fresh run = **last step** (final state), so a user who
  does not care about stepping just sees the end result and can rewind.

## 3. Directive Protocol

Each stdout line is `trim()`-ed and matched. Every keyword accepts an optional
graph id `@<id>`; omitting it targets the default graph `@main`. This keeps the
original simple examples (`graph:`, `graph_node:0:...`) fully backward
compatible — single-graph usage needs no `@id`.

`<id>` matches `[A-Za-z0-9_-]+`. Node ids are non-negative integers.

| Form | Effect |
|------|--------|
| `graph[@id]: [[1,2],[1],[2]]` | Define/replace structure — **directed** (arrows) by default. `adj[i]` = out-neighbors of node `i`. Node count = array length. Replacing a graph clears its node/edge decorations. |
| `graph[@id]:directed: [[...]]` | Explicit directed (same as default). |
| `graph[@id]:undirected: [[...]]` | Undirected: no arrows; reciprocal pairs (`i→j` and `j→i`) drawn as a single edge. |
| `graph_node[@id]:<n>:color:<1-16>` | Fill node `n` with `PALETTE[c-1]`. |
| `graph_node[@id]:<n>:info:<text>` | Sub-label under node `n`. Everything after the 3rd `:` is the text (may contain `:`). |
| `graph_edge[@id]:<src>:<dst>:color:<1-16>` | Color edge `src→dst`. |
| `graph_edge[@id]:<src>:<dst>:label:<text>` | Label edge `src→dst` (used for weights, e.g. `w=5`). Everything after the 4th `:` is the text. |
| anything else | Ignored — left untouched in stdout, no effect on graph. |

### 3.1 Direction handling

Auto-detection is **not** used. Adjacency lists are inherently directed
(out-neighbors), so `graph:` defaults to directed; `:undirected` is the explicit
override. Self-loops (`i ∈ adj[i]`) render as a small loop on the node.

### 3.2 Validation & ignore rules (system-boundary input)

Treat stdout as untrusted. A directive that fails validation is **silently
ignored line-by-line**; the last valid state is retained.

- `graph:` payload must parse as a JSON array of arrays of non-negative
  integers. Malformed JSON, non-array, or out-of-range neighbor indices →
  ignore the line (keep previous graph for that id).
- `graph_node` / `graph_edge` referencing a node index outside `[0, n)` of the
  current graph for that id → ignore.
- `color` outside `1..16` → ignore.
- A `graph_node`/`graph_edge` for an id with no `graph:` declared yet → ignore.

### 3.3 Caps (no silent truncation)

- Max **500 nodes** per graph. Beyond that the graph is rejected and a warning
  is shown in the help/empty-state area.
- Max **8 graphs** per run. Additional `graph@id:` declarations beyond 8 are
  ignored with a visible warning.

## 4. Parser & Frame Model — `lib/graph-directives.ts` (pure, no React)

- `parseGraphProgram(stdout: string): GraphProgram`
  - Walks stdout top→bottom, emitting one `GraphEvent` per recognized
    directive in order. Unrecognized lines are skipped (and separately
    available for stdout filtering — see §6).
- `frameAt(program: GraphProgram, step: number): MultiGraphState`
  - Folds events `0..step` into an immutable multi-graph state.
  - color/info accumulate, last-write-wins per `(graphId, nodeId, attr)` and
    per `(graphId, src, dst, attr)`.
  - A `graph[@id]:` event replaces that id's structure and clears its
    decorations.
- All functions return **new objects** (no mutation), per the immutability rule.
  Zero React dependency → fully unit-testable.

### 4.1 Types — `components/pad/graph-types.ts`

```ts
type GraphMode = "directed" | "undirected";

interface NodeDeco { color?: string; info?: string; }       // color = PALETTE hex
interface EdgeDeco { color?: string; label?: string; }

interface SingleGraphState {
  id: string;
  mode: GraphMode;
  adjacency: number[][];          // node -> out-neighbors
  nodes: Record<number, NodeDeco>;
  edges: Record<string, EdgeDeco>; // key = `${src}->${dst}`
}

type MultiGraphState = Record<string, SingleGraphState>; // keyed by graph id

type GraphEvent =
  | { kind: "graph"; id: string; mode: GraphMode; adjacency: number[][] }
  | { kind: "node"; id: string; node: number; attr: "color" | "info"; value: string }
  | { kind: "edge"; id: string; src: number; dst: number; attr: "color" | "label"; value: string };

interface GraphProgram {
  events: GraphEvent[];
  stepCount: number;     // = events.length
  warnings: string[];    // caps exceeded, etc. (surfaced in UI)
}
```

(`color` events resolve `1..16` to a `PALETTE` hex string at parse time.)

## 5. Cytoscape Integration

- One `cytoscape()` instance **per graph id**, rendered in a vertical stack
  inside the panel, each with a title (`[@id] directed/undirected`).
- `components/pad/useCytoscapeGraph.ts` manages an instance's lifecycle and
  applies a `SingleGraphState` to it (elements + styles + layout).
- Node fill from `NodeDeco.color` (reuses existing `PALETTE` in
  `components/pad/types.ts` — already 16 colors, index `c-1`). Node main label =
  node id; `info` rendered as a second line / sub-label.
- Edge styling: `label` shown on the edge; `color` sets `line-color` +
  `target-arrow-color`. `directed` → `target-arrow-shape: triangle`;
  `undirected` → no arrow.
- **Layout stability (key UX):** layout (`breadthfirst` default; dropdown for
  `cose` / `circle` / `grid`) is recomputed **only when a graph's structure
  changes** (a new `graph:` event for that id). Color/info/edge-only step
  changes keep node positions fixed so nodes do not jump while stepping.

## 6. Wiring into `PadEditorInner`

- Wrap the existing editor `<div>` and the new `GraphView` in a horizontal
  `react-resizable-panels` group, gated on `languageId === "python"`.
- `output.stdout` is parsed via `useMemo` into a `GraphProgram` and passed to
  `GraphView`. The current step index is local component state.
- `RunOutput` receives stdout with recognized directive lines removed. A small
  helper (`stripGraphDirectives(stdout): string`) lives alongside the parser.
- **Local only:** the graph is derived from the local run's stdout and is **not**
  synced via Yjs to collaborators. No change to the CRDT document.

## 7. Component Inventory

| File | Responsibility |
|------|----------------|
| `lib/graph-directives.ts` | Pure parser + `frameAt` + `stripGraphDirectives` |
| `components/pad/graph-types.ts` | Types (above) |
| `components/pad/GraphView.tsx` | Panel: step state, `◀ ▶` + slider, layout dropdown, usage toggle, empty/warning states; maps graph ids to canvases |
| `components/pad/useCytoscapeGraph.ts` | cytoscape instance lifecycle + state application |

## 8. Error Handling & Edge Cases

- Malformed/invalid directives → ignored line-by-line, last valid state kept
  (§3.2).
- No `graph:` directive in stdout → empty state: "No `graph:` directives found"
  + a hint to open the usage toggle.
- Caps exceeded → visible warnings (§3.3), never silent.
- Non-Python language → feature fully hidden.
- New run replaces the program and resets the timeline to the last step.

## 9. Testing

- **Unit** `lib/graph-directives.test.ts` (vitest, matches existing `*.test.ts`):
  - each directive form (with and without `@id`),
  - directed vs undirected, self-loops, reciprocal dedup,
  - edge color/label, node color/info,
  - accumulation + last-write-wins, graph replace clears decorations,
  - invalid input ignored (bad JSON, out-of-range node, color out of range,
    edge/node before `graph:`),
  - caps (>500 nodes, >8 graphs) produce warnings,
  - `frameAt` reconstruction at arbitrary steps,
  - `stripGraphDirectives` removes only recognized lines.
- **Component** `components/pad/GraphView.test.tsx`:
  - `◀ ▶` bounds and slider, step counter,
  - usage toggle, empty/warning states,
  - cytoscape mounting smoke test (jsdom; cytoscape mocked as needed).
- Target ≥80% coverage on the parser module.

## 10. Dependencies

- `cytoscape` (graph rendering + layouts). `react-cytoscapejs` wrapper optional;
  may instead manage the instance directly in `useCytoscapeGraph`.
- `react-resizable-panels` (collapsible/resizable split).

## 11. Out of Scope (YAGNI)

- Syncing graph state to collaborators via Yjs (local only).
- Non-Python languages.
- Weighted adjacency in the `graph:` payload itself (weights are expressed via
  `graph_edge:...:label`).
- Image/PNG export of the graph.
- Per-graph independent timelines (single global timeline only).
