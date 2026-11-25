import { test } from "node:test";
import assert from "node:assert/strict";
import { circles } from "./components.ts";

test("finds each circle and leaves out the rest", () => {
  const edges = [[1], [2], [0, 3], [4], [3], []];
  assert.deepEqual(circles(edges), [
    [0, 1, 2],
    [3, 4],
  ]);
});
