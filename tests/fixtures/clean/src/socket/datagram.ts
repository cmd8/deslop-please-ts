import { Ready } from "../kinds.ts";

export function send(): Ready {
  return Ready.create();
}
