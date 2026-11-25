import { Rate, Tally, Window, percent } from "./stats/index.ts";

export function summarize(lines: ReadonlyArray<readonly [second: number, level: number, latency: number]>): string {
  const first = lines[0];
  if (first === undefined) {
    return "no lines";
  }
  const tally = new Tally(4);
  const window = new Window(16);
  const rate = new Rate(first[0]);
  for (const [second, level, latency] of lines) {
    tally.record(level);
    window.push(latency);
    rate.observe(second);
  }
  const busiest = tally.busiest();
  const share = percent(tally.count(busiest), tally.total());
  return `level ${busiest} is ${share}% of lines; latency ${window.mean()} ms mean, ${window.worst()} ms worst; ${rate.perSecond()} lines a second`;
}
