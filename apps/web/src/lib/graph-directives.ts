import { PALETTE } from "@/components/pad/types";
import type {
  EdgeDeco,
  GraphEvent,
  GraphMode,
  GraphProgram,
  MultiGraphState,
  NodeDeco,
  SingleGraphState,
} from "@/components/pad/graph-types";

const ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_NODES = 500;
const MAX_GRAPHS = 8;

// Strict non-negative decimal integer (rejects "", "0x3", "1.0", "1e2").
function parseIndex(s: string): number | null {
  return /^\d+$/.test(s.trim()) ? Number(s) : null;
}

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
  const chain = parseDecoChain(body.slice(colon + 1), "info", true);
  if (!chain) return null;
  // Build the typed deco from known keys (avoids an unsound `as` cast that
  // would let a future stray key slip through unchecked).
  const deco: NodeDeco = {};
  if (chain.color !== undefined) deco.color = chain.color;
  if (chain.info !== undefined) deco.info = chain.info;
  return { kind: "node", id, node, deco };
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
  const chain = parseDecoChain(after.slice(c2 + 1), "label", false);
  if (!chain) return null;
  const deco: EdgeDeco = {};
  if (chain.color !== undefined) deco.color = chain.color;
  if (chain.label !== undefined) deco.label = chain.label;
  return { kind: "edge", id, src: srcN, dst: dstN, deco };
}

// Decode a LeetCode level-order binary-tree array into a children adjacency
// list keyed by compact level-order index (root = 0). `None` must already be
// normalised to null by the caller.
//
// Slot position (left vs right) is NOT preserved: two trees that differ only in
// which subtree is absent (e.g. [1,2,null] vs [1,null,2]) produce identical
// adjacency. That's fine for the current breadthfirst, index-labelled layout.
// If BST-aware left/right placement is ever needed, return {child, slot} pairs.
function decodeBinaryTree(vals: (number | null)[]): number[][] {
  if (vals.length === 0 || vals[0] === null) return [];
  const children: number[][] = [[]];
  const queue: number[] = [0];
  let i = 1;
  let next = 1;
  while (queue.length > 0 && i < vals.length) {
    const parent = queue.shift()!;
    for (let slot = 0; slot < 2 && i < vals.length; slot++) {
      const v = vals[i];
      i++;
      if (v !== null) {
        const idx = next;
        next++;
        children[idx] = [];
        children[parent]!.push(idx);
        queue.push(idx);
      }
    }
  }
  return children;
}

function parseTreeLine(
  id: string,
  body: string,
  structures: Map<string, number[][]>,
  warnings: string[]
): GraphEvent | null {
  // Accept Python None as well as JSON null; whitespace inside the array is
  // tolerated by JSON.parse.
  const payload = body.trim().replace(/\bNone\b/g, "null");
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;

  const vals: (number | null)[] = [];
  for (const v of json) {
    if (v === null) {
      vals.push(null);
    } else if (typeof v === "number" && Number.isFinite(v)) {
      // Any finite number = a present node. Unlike graph adjacency (which holds
      // node indices and requires integers), tree entries are node *values* —
      // only null-vs-present matters here, so floats are accepted as present.
      vals.push(v);
    } else {
      return null; // strings, booleans, nested arrays, etc.
    }
  }

  const adjacency = decodeBinaryTree(vals);
  const n = adjacency.length;
  if (n > MAX_NODES) {
    warnings.push(`tree @${id} has ${n} nodes (max ${MAX_NODES}); ignored`);
    return null;
  }
  if (!structures.has(id) && structures.size >= MAX_GRAPHS) {
    warnings.push(`more than ${MAX_GRAPHS} graphs; @${id} ignored`);
    return null;
  }

  structures.set(id, adjacency);
  return { kind: "graph", id, mode: "tree", adjacency };
}

// parseLine yields either a timeline event or a panel message instruction.
// The `info` variant is internal — it never enters `GraphProgram.events`.
type ParseResult = GraphEvent | { kind: "info"; text: string };

// `structures` is a local accumulator tracking each id's current adjacency so
// node/edge directives can be range-validated against the graph in effect at
// that point in the stream. Mutating it during this forward pass is local
// construction state, not shared mutation.
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
      adjacency: ev.adjacency.map((row) => [...row]),
      nodes: {},
      edges: {},
    } satisfies SingleGraphState;
    return;
  }
  const g = state[ev.id];
  if (!g) return; // validated unreachable, defensive
  if (ev.kind === "node") {
    g.nodes[ev.node] = { ...(g.nodes[ev.node] ?? {}), ...ev.deco };
  }
  if (ev.kind === "edge") {
    const key = `${ev.src}->${ev.dst}`;
    g.edges[key] = { ...(g.edges[key] ?? {}), ...ev.deco };
  }
}

// Matches the directive keyword shape (with optional @id). Strips even invalid
// directives so stdout stays clean; validity is surfaced via the graph panel.
const DIRECTIVE_RE = /^(graph(_node|_edge)?|tree)(@[A-Za-z0-9_-]+)?:/;

export function stripGraphDirectives(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !DIRECTIVE_RE.test(line.trim()))
    .join("\n");
}
