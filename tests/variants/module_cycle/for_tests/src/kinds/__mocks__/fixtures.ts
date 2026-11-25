import type { Stream } from "../../kinds.ts";
import { listen } from "../../socket.ts";

export function stream(): Stream {
  const opened = listen(1);
  if (opened === undefined) {
    throw new Error("a backlog of one is allowed");
  }
  return opened;
}
