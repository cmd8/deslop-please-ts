import { Timers } from "./timers.ts";

declare module "./timers.ts" {
  interface Timers {
    arm(id: number, at: number): void;
    fire(now: number, tasks: Tasks): void;
  }
}

export interface Task {
  readonly id: number;
  asleep: boolean;
}

export class Tasks {
  readonly #list: Task[] = [];

  spawn(id: number, timers: Timers): void {
    this.#list.push({ id, asleep: true });
    timers.arm(id, 10);
  }

  wake(id: number): void {
    for (const task of this.#list) {
      if (task.id === id) {
        task.asleep = false;
      }
    }
  }

  runnable(): number {
    return this.#list.filter((task) => !task.asleep).length;
  }
}

Timers.prototype.arm = function (this: Timers, id: number, at: number): void {
  this.due.push([id, at]);
};

Timers.prototype.fire = function (this: Timers, now: number, tasks: Tasks): void {
  for (const [id, at] of this.due) {
    if (at <= now) {
      tasks.wake(id);
    }
  }
  this.due = this.due.filter(([, at]) => at > now);
};
