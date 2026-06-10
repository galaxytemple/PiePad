import { describe, expect, it } from "vitest";
import { clampStep, frameAt, parseGraphProgram } from "./graph-directives";
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
