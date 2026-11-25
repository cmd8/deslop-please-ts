export { Rate } from "./rate.ts";
export { Tally } from "./tally.ts";
export { Window } from "./window.ts";

export function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.floor((part * 100) / whole);
}
