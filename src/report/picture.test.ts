import { test } from "node:test";
import assert from "node:assert/strict";
import type { Picture, PlacesInModule, Step } from "../lint/index.ts";
import { Paint } from "./paint.ts";
import { draw } from "./picture.ts";

function plain(picture: Picture): string[] {
  return draw(picture, new Paint(false));
}

function step(member: string, file: string, line: number, uses: string): Step {
  return { member, site: { file, line }, uses };
}

test("a circle runs down its ties and back up from the last", () => {
  const picture: Picture = {
    kind: "circle",
    steps: [
      step("kinds", "src/kinds.ts", 10, "Stream.new uses BACKLOG_MOST"),
      step("socket", "src/net/socket.ts", 5, "listen uses Stream"),
    ],
    rest: "not drawn: 1 more module",
  };
  assert.deepEqual(plain(picture), [
    "    ┌─▶ kinds",
    "    │     ┃ kinds.ts:10      Stream.new uses BACKLOG_MOST",
    "    │     ▼",
    "    │   socket",
    "    │     │ net/socket.ts:5  listen uses Stream",
    "    └─────┘",
    "    not drawn: 1 more module",
  ]);
});

test("a spread draws an arm from each module into the field", () => {
  const spread = (modules: PlacesInModule[]): Picture => ({
    kind: "spread",
    owner: "q:RunQueue",
    field: "items",
    modules,
    others: ["kept: limit"],
  });
  assert.deepEqual(plain(spread([{ places: 1, module: "q/app" }])), [
    "    q:RunQueue",
    "      items ◀━━━ 1  q/app",
    "      kept: limit",
  ]);
  const modules = [
    { places: 12, module: "q/sched" },
    { places: 3, module: "q/app" },
    { places: 2, module: "in 2 more modules" },
  ];
  assert.deepEqual(plain(spread(modules)), [
    "    q:RunQueue",
    "      items ◀━┳━ 12  q/sched",
    "              ┣━  3  q/app",
    "              ┗━  2  in 2 more modules",
    "      kept: limit",
  ]);
});

test("a bar crosses the line at seven and ends short of eighty columns", () => {
  const picture: Picture = { kind: "lists", shown: 50, hidden: 3, lists: [{ name: "Store", length: 9 }] };
  assert.deepEqual(plain(picture), [
    "                  7",
    "    shows  ███████│█████████████████████████████████⋯ 50",
    "    hides  ███    │ 3",
    "    Store  ███████│██ 9",
  ]);
});

test("a bar against a larger most puts its line halfway along", () => {
  const bar = (label: string, length: number, most: number): Picture => ({ kind: "bar", label, length, most });
  assert.deepEqual(plain(bar("holds", 17, 15)), [
    "                         15",
    "    holds  ███████████████│██ 17",
  ]);
  assert.deepEqual(plain(bar("lines", 2_001, 2_000)), [
    "                            2000",
    "    lines  ████████████████████│█ 2001",
  ]);
  assert.deepEqual(plain(bar("lines", 9_000, 2_000)), [
    "                            2000",
    "    lines  ████████████████████│████████████████████⋯ 9000",
  ]);
});
