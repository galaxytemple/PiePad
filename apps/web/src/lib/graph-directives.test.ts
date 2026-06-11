import { describe, expect, it } from "vitest";
import { clampStep, frameAt, parseGraphProgram, stripGraphDirectives } from "./graph-directives";
import { PALETTE } from "@/components/pad/types";

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

  it("converts a literal \\n in info to a real newline", () => {
    // The stdout line carries the two characters backslash + n.
    const p = parseGraphProgram("graph: [[]]\ngraph_node:0:info:line1\\nline2");
    expect(p.events[1]).toMatchObject({ attr: "info", value: "line1\nline2" });
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

describe("invalid input is ignored (no step consumed)", () => {
  it("ignores malformed JSON in graph: payload", () => {
    const p = parseGraphProgram("graph: [not json");
    expect(p.stepCount).toBe(0);
  });

  it("ignores non-array graph: payload", () => {
    const p = parseGraphProgram("graph: {}");
    expect(p.stepCount).toBe(0);
  });

  it("ignores adjacency with a non-array row", () => {
    const p = parseGraphProgram("graph: [1,[0]]");
    expect(p.stepCount).toBe(0);
  });

  it("ignores adjacency with a non-integer neighbor", () => {
    const p = parseGraphProgram("graph: [[1.5],[0]]");
    expect(p.stepCount).toBe(0);
  });

  it("ignores a neighbor index out of range", () => {
    const p = parseGraphProgram("graph: [[9],[0]]");
    expect(p.stepCount).toBe(0);
  });

  it("ignores graph_edge before any graph: for that id", () => {
    const p = parseGraphProgram("graph_edge:0:1:label:x\ngraph: [[1],[0]]");
    expect(p.stepCount).toBe(1);
    expect(p.events[0].kind).toBe("graph");
  });

  it("ignores an unknown node attribute", () => {
    const p = parseGraphProgram("graph: [[1],[0]]\ngraph_node:0:tooltip:hi");
    expect(p.stepCount).toBe(1);
  });

  it("ignores an unknown edge attribute", () => {
    const p = parseGraphProgram("graph: [[1],[0]]\ngraph_edge:0:1:weightx:5");
    expect(p.stepCount).toBe(1);
  });
});

describe("undirected edge keys remain directional in state", () => {
  it("stores graph_edge under src->dst even when the graph is undirected", () => {
    const p = parseGraphProgram(
      ["graph:undirected: [[1],[0]]", "graph_edge:0:1:color:1"].join("\n")
    );
    const s = frameAt(p, p.stepCount - 1);
    expect(s.main.edges["0->1"]).toEqual({ color: PALETTE[0] });
    expect(s.main.edges["1->0"]).toBeUndefined();
  });
});

describe("strict decimal index parsing", () => {
  it("rejects an empty node index (double colon)", () => {
    const p = parseGraphProgram("graph: [[1],[0]]\ngraph_node::color:1");
    expect(p.stepCount).toBe(1);
  });
  it("rejects a non-decimal color index", () => {
    const p = parseGraphProgram("graph: [[1],[0]]\ngraph_node:0:color:0x3");
    expect(p.stepCount).toBe(1);
  });
});

describe("tree: directive (binary tree array)", () => {
  it("decodes a LeetCode level-order array into child adjacency, mode tree", () => {
    const p = parseGraphProgram("tree: [1,2,3,null,null,4,5]");
    expect(p.stepCount).toBe(1);
    const s = frameAt(p, 0);
    expect(s.main.mode).toBe("tree");
    expect(s.main.adjacency).toEqual([[1, 2], [], [3, 4], [], []]);
  });

  it("accepts Python None like null (and Python-printed spacing)", () => {
    // [1, 2, None, 3]: root(0).left=2(idx1), root.right=null(absent),
    // node1(idx1).left=3(idx2). Standard LeetCode level-order decoding.
    const p = parseGraphProgram("tree: [1, 2, None, 3]");
    const s = frameAt(p, 0);
    expect(s.main.adjacency).toEqual([[1], [2], []]);
  });

  it("handles left-only and right-only children", () => {
    expect(frameAt(parseGraphProgram("tree: [1,2,null]"), 0).main.adjacency).toEqual([[1], []]);
    expect(frameAt(parseGraphProgram("tree: [1,null,2]"), 0).main.adjacency).toEqual([[1], []]);
  });

  it("treats value 0 as a present node (only null/None are absent)", () => {
    expect(frameAt(parseGraphProgram("tree: [0,0,0]"), 0).main.adjacency).toEqual([[1, 2], [], []]);
  });

  it("empty array and root-null produce a 0-node tree", () => {
    expect(frameAt(parseGraphProgram("tree: []"), 0).main.adjacency).toEqual([]);
    expect(frameAt(parseGraphProgram("tree: [null]"), 0).main.adjacency).toEqual([]);
  });

  it("routes @id and applies graph_node decorations by level-order index", () => {
    const src = ["tree@t: [1,2,3]", "graph_node@t:0:color:1", "graph_node@t:2:info:hit"].join("\n");
    const p = parseGraphProgram(src);
    const s = frameAt(p, p.stepCount - 1);
    expect(Object.keys(s)).toEqual(["t"]);
    expect(s.t.mode).toBe("tree");
    expect(s.t.nodes[0]).toEqual({ color: PALETTE[0] });
    expect(s.t.nodes[2]).toEqual({ info: "hit" });
  });

  it("ignores invalid payloads (nested array, object, non-array, garbage)", () => {
    expect(parseGraphProgram("tree: [1,[2]]").stepCount).toBe(0);
    expect(parseGraphProgram("tree: {}").stepCount).toBe(0);
    expect(parseGraphProgram("tree: nope").stepCount).toBe(0);
    expect(parseGraphProgram('tree: ["a"]').stepCount).toBe(0);
  });

  it("rejects a tree over 500 nodes with a warning", () => {
    const big = JSON.stringify(Array.from({ length: 501 }, (_, i) => i));
    const p = parseGraphProgram(`tree: ${big}`);
    expect(p.stepCount).toBe(0);
    expect(p.warnings.some((w) => w.includes("max 500"))).toBe(true);
  });
});
