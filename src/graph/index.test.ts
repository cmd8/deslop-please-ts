import { test } from "node:test";
import assert from "node:assert/strict";
import { Sample } from "../model/sample.ts";
import { buildGraph } from "./index.ts";

test("a method written anywhere is part of its type and things that use each other are a tangle", () => {
  const sample = new Sample();
  const a = sample.module("a");
  const b = sample.module("b");
  const tasks = sample.item(a, "Tasks", "type");
  const timers = sample.item(b, "Timers", "type");
  const fire = sample.member(timers, a, "Timers.fire", "function");
  const spawn = sample.member(tasks, a, "Tasks.spawn", "function");
  sample.refer(fire, tasks);
  sample.refer(spawn, timers);
  const graph = buildGraph(sample.model);
  const ofFire = graph.thingOf.get(fire);
  assert.equal(ofFire?.item, timers);
  assert.equal(ofFire?.home, b);
  assert.equal(graph.tangles.length, 1);
  assert.equal(graph.tangles[0]?.length, 2);
});

test("a use of a wrapper is a use of what is behind it and its own body is no use", () => {
  const sample = new Sample();
  const a = sample.module("a");
  const b = sample.module("b");
  const queue = sample.item(a, "Queue", "type");
  const inner = sample.item(a, "Inner", "type");
  const items = sample.member(inner, a, "Inner.items", "field");
  const field = sample.member(queue, a, "Queue.inner", "field");
  const getter = sample.member(inner, a, "Inner.items", "function");
  const forwarder = sample.member(queue, a, "Queue.items", "function");
  sample.wrappers.set(getter, { kind: "accessor", lent: [items], copied: [], lendsOnlyToRead: true });
  sample.wrappers.set(forwarder, { kind: "forwarder", target: getter, fieldsCalledOn: [field] });
  sample.refer(getter, items);
  sample.refer(forwarder, field);
  sample.refer(forwarder, getter);
  const report = sample.item(b, "report", "function");
  sample.refer(report, forwarder);
  const graph = buildGraph(sample.model);
  assert.deepEqual(
    graph.uses.map((usage) => [usage.item, usage.through]),
    [
      [field, forwarder],
      [items, forwarder],
    ],
  );
  const reporter = graph.thingOf.get(report);
  assert.ok(graph.uses.every((usage) => usage.user === reporter));
});
