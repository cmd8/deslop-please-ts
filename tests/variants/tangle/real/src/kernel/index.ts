import type { Tasks } from "./tasks.ts";
import type { Timers } from "./timers.ts";

export function tick(now: number, tasks: Tasks, timers: Timers): void {
  for (const id of timers.fire(now)) {
    tasks.wake(id);
  }
}
