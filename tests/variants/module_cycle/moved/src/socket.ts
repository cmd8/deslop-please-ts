import { Stream } from "./kinds.ts";

export function listen(backlog: number): Stream | undefined {
  return Stream.open(backlog);
}
