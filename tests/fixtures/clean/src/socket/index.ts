import type { Ready } from "../kinds.ts";
import { send } from "./datagram.ts";

export { send } from "./datagram.ts";

export function sendNow(): Ready {
  return send();
}
