const RESET = "\u001b[0m";

export class Paint {
  readonly #color: boolean;

  constructor(color: boolean) {
    this.#color = color;
  }

  error(text: string): string {
    return this.#select("1;31", text);
  }

  gutter(text: string): string {
    return this.#select("1;34", text);
  }

  ok(text: string): string {
    return this.#select("1;32", text);
  }

  bold(text: string): string {
    return this.#select("1", text);
  }

  #select(code: string, text: string): string {
    return this.#color ? `\u001b[${code}m${text}${RESET}` : text;
  }
}
