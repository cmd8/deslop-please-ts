export class Window {
  readonly #latencies: number[] = [];

  constructor(private readonly size: number) {}

  push(latency: number): void {
    if (this.#latencies.length === this.size) {
      this.#latencies.shift();
    }
    this.#latencies.push(latency);
  }

  mean(): number {
    const sum = this.#latencies.reduce((total, latency) => total + latency, 0);
    return Math.floor(sum / Math.max(this.#latencies.length, 1));
  }

  worst(): number {
    return Math.max(0, ...this.#latencies);
  }
}
