import { test } from "node:test";
import assert from "node:assert/strict";
import { grouped, shortestCircle, withoutGenerics } from "./reporting.ts";

test("a name without its generic arguments", () => {
  assert.equal(withoutGenerics("<Vec<T> as From<(A, B)>>::from"), "<Vec as From>::from");
  assert.equal(withoutGenerics("Map<K, Array<V>>.set"), "Map.set");
  assert.equal(withoutGenerics("Ready.new"), "Ready.new");
});

test("the circle drawn is the shortest through the first tie of the cheapest", () => {
  const tie = (user: string, used: string): { user: string; used: string } => ({ user, used });
  const ring = [tie("a", "b"), tie("b", "c"), tie("c", "a")];
  assert.deepEqual(shortestCircle(ring), [0, 1, 2]);
  const chord = [tie("a", "b"), tie("b", "c"), tie("c", "a"), tie("b", "a")];
  assert.deepEqual(shortestCircle(chord), [0, 3]);
  const twoWays = [tie("a", "b"), tie("b", "d"), tie("b", "c"), tie("c", "a"), tie("d", "a")];
  assert.deepEqual(shortestCircle(twoWays), [0, 1, 4]);
});

test("names under one name are written once", () => {
  assert.equal(grouped(["LIMIT"]), "LIMIT");
  assert.equal(grouped(["Stream.new"]), "Stream.new");
  assert.equal(grouped(["Stream.new", "Stream.push"]), "Stream.{new, push}");
  assert.equal(
    grouped(["Stream", "LIMIT", "Stream.new", "Stream.Kind.Ready"]),
    "Stream, Stream.{new, Kind.Ready}, LIMIT",
  );
});
