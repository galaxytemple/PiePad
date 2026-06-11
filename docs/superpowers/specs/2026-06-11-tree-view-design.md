# PiePad Tree View — Design Spec

**Date:** 2026-06-11
**Status:** Approved (pending implementation plan)
**Builds on:** `docs/superpowers/specs/2026-06-10-graph-view-design.md`

## 1. Purpose

Add a `tree:` directive that renders a **binary tree** from a LeetCode-style
level-order array (with `null` for missing children) in the existing graph
panel. Non-binary / arbitrary tree shapes are out of scope — users express those
with `graph:undirected: [[...]]`.

The feature reuses the entire existing graph pipeline (parser events, `frameAt`
timeline, `@id` multi-graph, `graph_node`/`graph_edge` decorations, Cytoscape
rendering, step controls). `tree:` is only a new *front-end* for defining the
structure; it emits the same event the `graph:` directive does.

## 2. Directive & Format

```
tree[@id]: [1,2,3,null,null,4,5]
```

- The payload is an array of `number | null/None`, in **LeetCode level-order**:
  the array is a breadth-first listing where a present node contributes its two
  child slots to the array, and a missing child is marked `null` (JSON) **or
  `None`** (Python). Both are accepted — `None` is normalised to `null` before
  parsing (Python users naturally write `print("tree:", [1, 2, None, 3])`, which
  prints `tree: [1, 2, None, 3]`).
- `@id` is the optional graph id (default `main`), identical to `graph:`.

### 2.0 Whitespace

Inputs are whitespace-tolerant where it matters:
- Leading/trailing whitespace on the stdout line is trimmed.
- Whitespace **inside the array payload** is ignored (`JSON.parse` handles
  `[1, 2, null, 3]`), so a Python-printed list works verbatim.
- Whitespace around the keyword / `@id` / mode tokens is trimmed at their
  boundaries, but arbitrary whitespace *inside* a token (e.g. `dire cted`) is
  not supported — no realistic stdout contains it.

### 2.1 Decode (standard LeetCode deserialization)

First normalise Python `None` to JSON `null` (`payload.replace(/\bNone\b/g, "null")`),
then `JSON.parse`. Decode the array into a **children adjacency list** keyed by a
compact **level-order index** assigned in node-creation order (root = 0):

```
decodeBinaryTree(vals): number[][]
  if vals is empty OR vals[0] === null: return []   // empty tree
  children = [[]]            // node 0 = root
  queue = [0]; i = 1; next = 1
  while queue not empty AND i < vals.length:
    parent = queue.shift()
    for slot in [left, right]:
      if i >= vals.length: break
      v = vals[i]; i++
      if v !== null:
        idx = next; next++
        children[idx] = []
        children[parent].push(idx)
        queue.push(idx)
  return children
```

Example `[1,2,3,null,null,4,5]` → `[[1,2],[],[3,4],[],[]]`
(node 0 → children 1,2; node 2 → children 3,4). Node count = 5, labels 0..4.

## 3. Reuse Model (minimal new code)

`tree:` does **not** create a new rendering path. After decoding to adjacency,
it emits the existing graph event with a new mode:

```ts
{ kind: "graph"; id; mode: "tree"; adjacency }   // adjacency = children lists
```

Consequences (all free, no new code):
- `frameAt`, step timeline, `@id` multi-graph, structure-replace-clears-deco,
  caps/warnings all apply unchanged.
- `graph_node@id:<i>:color|info` and `graph_edge@id:<src>:<dst>:color|label`
  apply to tree nodes/edges, addressed by the **level-order index** `<i>`.

The only type change: `GraphMode` gains `"tree"`:
```ts
type GraphMode = "directed" | "undirected" | "tree";
```

## 4. Labels & Decorations

- **Node label = level-order index** (`0,1,2,…`) — consistent with `graph:`.
- The array **values only determine node presence** (`null` = absent, any number
  including `0` = present). Values are **not displayed** (per the chosen
  index-label convention). `[1,2,3]` and `[9,8,7]` render identically.
- Decorations reuse the existing directives by index, e.g. for
  `tree: [1,2,3,null,5]` (nodes 0=val1, 1=val2, 2=val3, 3=val5):
  - `graph_node:0:color:1` → colour the root
  - `graph_node:3:info:found` → annotate the node that holds value 5
  - `graph_edge:0:1:label:L` → label the root→left-child edge

## 5. Rendering (`useCytoscapeGraph`)

When `state.mode === "tree"`:
- Layout: `breadthfirst` rooted at node 0 (`{ name: "breadthfirst", roots: ["n0"], padding: 12 }`) so the root sits on top and children descend.
- Edges: **no arrowhead** (parent–child lines only) — same treatment as the
  `undirected` class.
- Panel title shows `[@id] tree`.

`directed`/`undirected` behaviour is unchanged. Layout still recomputes only on
structure change (existing stability rule).

## 6. Validation & Caps (reuse)

- After normalising `None`→`null`, the payload must `JSON.parse` to an array
  whose entries are each `number` or `null`; anything else (malformed JSON,
  nested arrays, strings) → ignore the line, keep the previous state
  (line-by-line, per existing rules).
- Empty array or `vals[0] === null` → empty tree (0 nodes); the directive is
  still a valid event (an empty graph for that id) — or skipped if it would
  produce nothing meaningful. Decision: **emit the event with 0 nodes** (renders
  an empty canvas + lets a later `tree:` replace it), consistent with how an
  empty `graph: []` behaves.
- Node count > 500 → reject + warning (reuse `MAX_NODES`).
- > 8 graphs → reject new id + warning (reuse `MAX_GRAPHS`).
- `graph_node`/`graph_edge` indices out of range → ignore (existing behaviour).

## 7. Parser wiring (`lib/graph-directives.ts`)

- Add `parseTreeLine(id, body, structures, warnings)`: parse + validate the
  array, `decodeBinaryTree`, apply caps, store adjacency in `structures`, return
  `{ kind: "graph", id, mode: "tree", adjacency }`.
- `parseLine`: the current guard `if (!line.startsWith("graph")) return null;`
  must also accept `tree` → `if (!line.startsWith("graph") && !line.startsWith("tree")) return null;`. Route `kw === "tree"` to `parseTreeLine`.
- `parseHead` already handles the optional `@id` on any keyword.
- `stripGraphDirectives`: extend `DIRECTIVE_RE` to also match the `tree` keyword
  so `tree:` lines are stripped from the run-output panel:
  `/^(graph(_node|_edge)?|tree)(@[A-Za-z0-9_-]+)?:/`.

No change to `frameAt`, `clampStep`, `applyEvent` (they operate on the generic
graph event, which `tree:` reuses).

## 8. Components Touched

| File | Change |
|------|--------|
| `components/pad/graph-types.ts` | `GraphMode` += `"tree"` |
| `lib/graph-directives.ts` | `decodeBinaryTree`, `parseTreeLine`, wire `tree` into `parseLine` + `DIRECTIVE_RE` |
| `lib/graph-directives.test.ts` | decode/null/caps/`@id`/mode/decoration/strip tests |
| `components/pad/useCytoscapeGraph.ts` | `mode === "tree"` → rooted breadthfirst + no arrowhead |
| `components/pad/GraphView.tsx` | (none required — title already prints `state.mode`; "tree" shows automatically) |

## 9. Testing

- **Unit** (`graph-directives.test.ts`, vitest node env):
  - `decodeBinaryTree([1,2,3,null,null,4,5])` → `[[1,2],[],[3,4],[],[]]`.
  - left-only / right-only children (`[1,2,null]`, `[1,null,2]`).
  - empty (`[]`) and root-null (`[null]`) → 0 nodes.
  - **`None` accepted like `null`**: `tree: [1, 2, None, 3]` parses (and the
    Python-printed spacing `[1, 2, None, 3]` works verbatim).
  - non-null `0` is a present node (`[0,0,0]`).
  - `tree@t: [...]` routes to id `t` with `mode: "tree"`.
  - invalid payloads ignored (`tree: [1,[2]]`, `tree: {}`, `tree: nope`).
  - `graph_node:1:color:N` on a tree decorates by index; `frameAt` reflects it.
  - `stripGraphDirectives` removes `tree:`/`tree@id:` lines, keeps real output.
  - caps: > 500 nodes warns + rejected.
- **Manual** (in-app): paste a `tree:` sample, confirm rooted top-down layout,
  no arrowheads, index labels, `graph_node`/`graph_edge` decorations land,
  multi-graph with a `graph:` + `tree:` together, step timeline works.

## 10. Out of Scope (YAGNI)

- Displaying node values (index labels only, per decision; trivial to add later
  via a `values` field if desired).
- n-ary / children-list / parent-array tree formats — use `graph:undirected:`.
- Tree-specific decoration directives (`tree_node`) — reuse `graph_node`.
- Binary-search-tree validation, balancing, or traversal helpers.
