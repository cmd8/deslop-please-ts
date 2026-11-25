import { ToolError } from "../error.ts";
import type { Model } from "../model/index.ts";

export function readProject(workingDirectory: string): Model {
  throw new ToolError(`cannot read ${workingDirectory} yet`);
}
