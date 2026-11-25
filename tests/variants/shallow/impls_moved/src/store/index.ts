import { Table } from "./table.ts";

export class Store {
  readonly table = new Table();

  constructor(readonly capacity: number) {}
}
