import { listen } from "../socket.ts";

export function listens(): void {
  if (listen(1) === undefined) {
    throw new Error("listening with a backlog of one");
  }
}
