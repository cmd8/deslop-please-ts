export interface A {
  next: B | undefined;
}

export interface B {
  next: C | undefined;
}

export interface C {
  next: D | undefined;
}

export interface D {
  next: E | undefined;
}

export interface E {
  next: F | undefined;
}

export interface F {
  next: G | undefined;
}

export interface G {
  next: H | undefined;
}

export interface H {
  next: A | undefined;
}
