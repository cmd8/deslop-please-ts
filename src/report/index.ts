import type { Diagnostic } from "../lint/index.ts";
import { TOOL } from "../tool.ts";
import { Paint } from "./paint.ts";
import { draw } from "./picture.ts";

export function render(diagnostics: readonly Diagnostic[], fixedAllowed: number, allowPath: string | undefined): string {
  const paint = new Paint(stdoutHasColor());
  let out = "";
  for (const diagnostic of diagnostics) {
    out += `${paint.error(`error[${diagnostic.lint}]`)}${paint.bold(`: ${diagnostic.message}`)}\n`;
    if (diagnostic.location !== undefined) {
      out += `  ${paint.gutter("-->")} ${diagnostic.location.file}:${diagnostic.location.line}:1\n`;
    }
    for (const note of diagnostic.notes) {
      out += `  ${paint.gutter("=")} ${paint.bold("note:")} ${note}\n`;
    }
    for (const line of draw(diagnostic.picture, paint)) {
      out += `${line}\n`;
    }
    out += "\n";
  }
  if (fixedAllowed > 0 && allowPath !== undefined) {
    const noun = fixedAllowed === 1 ? "entry" : "entries";
    out += `${paint.bold("note:")} ${fixedAllowed} allowed ${noun} in ${allowPath} are now fixed (run \`${TOOL} --update-allow ${allowPath}\` to tighten it)\n`;
  }
  if (diagnostics.length === 0) {
    out += `${TOOL}: ${paint.ok("ok")}\n`;
  } else {
    const noun = diagnostics.length === 1 ? "error" : "errors";
    out += `${TOOL}: ${paint.error(`${diagnostics.length} ${noun}`)}, well done!\n`;
  }
  return out;
}

function stdoutHasColor(): boolean {
  const forced = process.env["FORCE_COLOR"];
  if (forced !== undefined) {
    return forced !== "0";
  }
  const noColor = process.env["NO_COLOR"];
  return (noColor === undefined || noColor === "") && process.stdout.isTTY;
}
