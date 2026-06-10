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
