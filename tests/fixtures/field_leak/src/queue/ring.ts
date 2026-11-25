export class RunQueue {
  items: number[] = [];
  head = 0;

  constructor(private readonly limit: number) {}

  full(): boolean {
    return this.items.length - this.head >= this.limit;
  }
}
