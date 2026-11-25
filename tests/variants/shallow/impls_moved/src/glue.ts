import { Store } from "./store/index.ts";

declare module "./store/index.ts" {
  interface Store {
    limit(): number;
    insert(key: number, value: number): boolean;
    get(key: number): number | undefined;
    remove(key: number): number | undefined;
    contains(key: number): boolean;
    room(): number;
    isFull(): boolean;
    total(): number;
    largest(): number | undefined;
  }
}

Store.prototype.limit = function (this: Store): number {
  return this.capacity;
};

Store.prototype.insert = function (this: Store, key: number, value: number): boolean {
  if (this.table.count() >= this.capacity) {
    return false;
  }
  this.table.put(key, value);
  return true;
};

Store.prototype.get = function (this: Store, key: number): number | undefined {
  const at = this.table.find(key);
  return at === undefined ? undefined : this.table.value(at);
};

Store.prototype.remove = function (this: Store, key: number): number | undefined {
  const at = this.table.find(key);
  return at === undefined ? undefined : this.table.take(at);
};

Store.prototype.contains = function (this: Store, key: number): boolean {
  return this.table.find(key) !== undefined;
};

Store.prototype.room = function (this: Store): number {
  return this.capacity - this.table.count();
};

Store.prototype.isFull = function (this: Store): boolean {
  return this.room() === 0;
};

Store.prototype.total = function (this: Store): number {
  let sum = 0;
  for (let at = 0; at < this.table.count(); at += 1) {
    sum += this.table.value(at);
  }
  return sum;
};

Store.prototype.largest = function (this: Store): number | undefined {
  let most: number | undefined;
  for (let at = 0; at < this.table.count(); at += 1) {
    most = Math.max(most ?? 0, this.table.value(at));
  }
  return most;
};
