import { backlogMost } from "./limits.ts";

export class Stream {
  #pending = 0;

  private constructor(private readonly backlog: number) {}

  static open(backlog: number): Stream | undefined {
    return backlog <= backlogMost() ? new Stream(backlog) : undefined;
  }

  accept(): boolean {
    const room = this.#pending < this.backlog;
    if (room) {
      this.#pending += 1;
    }
    return room;
  }
}
