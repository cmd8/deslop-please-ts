import { test } from "node:test";
import assert from "node:assert/strict";
import { circles } from "./components.ts";

test("finds each circle and leaves out the rest", () => {
  const nodes = ["a", "b", "c", "d", "e", "f"];
  const edges = new Map([
    ["a", ["b"]],
    ["b", ["c"]],
    ["c", ["a", "d"]],
    ["d", ["e"]],
    ["e", ["d"]],
  ]);
  assert.deepEqual(circles(nodes, edges), [
    ["a", "b", "c"],
    ["d", "e"],
  ]);
});
