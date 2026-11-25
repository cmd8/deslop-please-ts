import { test } from "node:test";
import assert from "node:assert/strict";
import { Sample } from "../model/sample.ts";
import { moduleCycles } from "./cycles.ts";

function keys(sample: Sample): string[] {
  return moduleCycles(sample.model, undefined).map((diagnostic) => diagnostic.key);
}

test("siblings that use each other are a circle though no two things are", () => {
  const sample = new Sample();
  const socket = sample.module("socket");
  const kinds = sample.module("kinds");
  const open = sample.item(socket, "open", "function");
  const limit = sample.item(socket, "LIMIT", "constant");
  const stream = sample.item(kinds, "Stream", "type");
  const fits = sample.item(kinds, "fits", "function");
  sample.refer(open, stream);
  assert.deepEqual(keys(sample), []);
  sample.refer(fits, limit);
  const diagnostics = moduleCycles(sample.model, undefined);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.key, "p/kinds,p/socket");
  assert.equal(diagnostics[0]?.message, "2 modules in `p` use each other in a circle");
  assert.deepEqual(diagnostics[0]?.notes, [
    "members: kinds, socket",
    "src/kinds.ts:2:1: `kinds` uses `socket` by 1 item: LIMIT",
    "src/socket.ts:1:1: `socket` uses `kinds` by 1 item: Stream",
  ]);
  assert.deepEqual(diagnostics[0]?.picture, {
    kind: "circle",
    steps: [
      { member: "kinds", site: { file: "src/kinds.ts", line: 2 }, uses: "fits uses LIMIT" },
      { member: "socket", site: { file: "src/socket.ts", line: 1 }, uses: "open uses Stream" },
    ],
    rest: undefined,
  });
});

test("a circle is between the children of the module that holds it", () => {
  const sample = new Sample();
  const epoll = sample.module("kinds/epoll");
  const address = sample.module("socket/address");
  const wait = sample.item(epoll, "wait", "function");
  const parse = sample.item(address, "parse", "function");
  sample.refer(wait, parse);
  sample.refer(parse, wait);
  assert.deepEqual(keys(sample), ["p/kinds,p/socket"]);
});

test("a module and what is inside it make no circle", () => {
  const sample = new Sample();
  const kinds = sample.module("kinds");
  const epoll = sample.module("kinds/epoll");
  const kind = sample.item(kinds, "Kind", "type");
  const wait = sample.item(epoll, "wait", "function");
  const poll = sample.item(kinds, "poll", "function");
  sample.refer(wait, kind);
  sample.refer(poll, wait);
  assert.deepEqual(keys(sample), []);
});

test("a method counts where it is written", () => {
  const sample = new Sample();
  const tasks = sample.module("tasks");
  const timers = sample.module("timers");
  const task = sample.item(tasks, "Tasks", "type");
  const timer = sample.item(timers, "Timers", "type");
  const fire = sample.member(timer, timers, "Timers.fire", "function");
  sample.refer(fire, task);
  const spawnInTimers = sample.member(task, timers, "Tasks.spawn", "function");
  sample.refer(spawnInTimers, timer);
  assert.deepEqual(keys(sample), []);
  const spawnInTasks = sample.member(task, tasks, "Tasks.spawn", "function");
  sample.refer(spawnInTasks, timer);
  assert.deepEqual(keys(sample), ["p/tasks,p/timers"]);
});
