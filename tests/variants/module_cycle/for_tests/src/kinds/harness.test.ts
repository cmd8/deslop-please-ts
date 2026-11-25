import { stream } from "./__mocks__/fixtures.ts";

export function acceptsUpToTheBacklog(): void {
  if (!stream().accept()) {
    throw new Error("a stream with a backlog of one accepts one connection");
  }
}
