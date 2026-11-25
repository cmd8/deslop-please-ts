import { detail, inner, Shown } from "lib";

export function main(): readonly (object | undefined)[] {
  const kept: detail.Kept | undefined = undefined;
  return [new inner.Hidden(), new Shown(), kept];
}
