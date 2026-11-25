import { HELD_IN_MIND } from "../lint/index.ts";
import type { Picture, PlacesInModule, Step } from "../lint/index.ts";
import type { Paint } from "./paint.ts";

const LONGEST_BAR_IN_CELLS = 40;

interface BarRow {
  readonly name: string;
  readonly length: number;
  readonly judged: boolean;
}

export function draw(picture: Picture, paint: Paint): string[] {
  return linesOf(picture, paint).map((line) => `    ${line}`);
}

function linesOf(picture: Picture, paint: Paint): string[] {
  switch (picture.kind) {
    case "circle":
      return circle(picture.steps, picture.rest, paint);
    case "spread":
      return spread(picture.owner, picture.field, picture.modules, picture.others, paint);
    case "lists":
      return bars(
        [
          { name: "shows", length: picture.shown, judged: true },
          { name: "hides", length: picture.hidden, judged: false },
          ...picture.lists.map(({ name, length }) => ({ name, length, judged: true })),
        ],
        HELD_IN_MIND,
        paint,
      );
    case "bar":
      return bars([{ name: picture.label, length: picture.length, judged: true }], picture.most, paint);
  }
}

function circle(steps: readonly Step[], rest: string | undefined, paint: Paint): string[] {
  const skip = commonDirectoryLength(steps);
  const drawn = steps.map((step) => ({ step, site: `${step.site.file.slice(skip)}:${step.site.line}` }));
  const width = Math.max(0, ...drawn.map(({ site }) => site.length));
  const lines: string[] = [];
  drawn.forEach(({ step, site }, index) => {
    const cheapest = index === 0;
    const heavy = (light: string, heavyText: string): string => (cheapest ? paint.error(heavyText) : light);
    const into = cheapest ? "┌─▶ " : "│   ";
    lines.push(`${into}${paint.bold(step.member)}`);
    lines.push(`│     ${heavy("│", "┃")} ${site.padEnd(width)}  ${step.uses}`);
    if (index + 1 < steps.length) {
      lines.push(`│     ${heavy("▼", "▼")}`);
    }
  });
  lines.push("└─────┘");
  if (rest !== undefined) {
    lines.push(rest);
  }
  return lines;
}

function commonDirectoryLength(steps: readonly Step[]): number {
  const directoryOf = (step: Step): string[] => step.site.file.split("/").slice(0, -1);
  const [first] = steps;
  let common = first === undefined ? [] : directoryOf(first);
  for (const step of steps) {
    const directory = directoryOf(step);
    const differsAt = common.findIndex((part, at) => part !== directory[at]);
    if (differsAt >= 0) {
      common = common.slice(0, differsAt);
    }
  }
  return common.reduce((sum, part) => sum + part.length + 1, 0);
}

function spread(
  owner: string,
  field: string,
  modules: readonly PlacesInModule[],
  others: readonly string[],
  paint: Paint,
): string[] {
  const lines = [owner];
  const digits = Math.max(0, ...modules.map(({ places }) => String(places).length));
  const under = " ".repeat([...field].length + 3);
  modules.forEach(({ places, module }, index) => {
    const lead = index === 0 ? `  ${paint.bold(field)} ` : under;
    const arm = armOf(index, modules.length);
    lines.push(`${lead}${paint.error(arm)} ${String(places).padStart(digits)}  ${module}`);
  });
  lines.push(...others.map((other) => `  ${other}`));
  return lines;
}

function armOf(index: number, count: number): string {
  if (index === 0) {
    return count === 1 ? "◀━━━" : "◀━┳━";
  }
  return index + 1 === count ? "  ┗━" : "  ┣━";
}

function bars(rows: readonly BarRow[], most: number, paint: Paint): string[] {
  const unit = Math.max(1, Math.ceil(most / (LONGEST_BAR_IN_CELLS / 2)));
  const line = Math.ceil(most / unit);
  const width = Math.max(0, ...rows.map(({ name }) => [...name].length));
  const lines = [`${"".padEnd(width)}  ${String(most).padStart(line + 1)}`];
  for (const { name, length, judged } of rows) {
    const cells = Math.ceil(length / unit);
    const inside = Math.min(cells, line);
    const past = cells - inside;
    let beyond = "█".repeat(Math.min(past, LONGEST_BAR_IN_CELLS - line));
    if (past > LONGEST_BAR_IN_CELLS - line) {
      beyond += "⋯";
    }
    if (judged && past > 0) {
      beyond = paint.error(beyond);
    }
    lines.push(`${name.padEnd(width)}  ${"█".repeat(inside)}${" ".repeat(line - inside)}│${beyond} ${length}`);
  }
  return lines;
}
