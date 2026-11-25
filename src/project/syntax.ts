import {
  isArrowFunction,
  isAsExpression,
  isComputedPropertyName,
  isConstructorDeclaration,
  isExportAssignment,
  isFunctionDeclaration,
  isGetAccessorDeclaration,
  isMethodDeclaration,
  isMethodSignatureDeclaration,
  isPropertyDeclaration,
  isSetAccessorDeclaration,
  isVariableDeclaration,
  isFunctionExpression,
  isIdentifier,
  isNonNullExpression,
  isNumericLiteral,
  isParenthesizedExpression,
  isPrivateIdentifier,
  isSatisfiesExpression,
  isStringLiteral,
  isTypeAssertion,
  SyntaxKind,
  type Node,
  type ParameterDeclaration,
} from "typescript/ast";

export function nodeIndex(node: Node): number {
  const index: unknown = Reflect.get(node, "index");
  if (typeof index !== "number") {
    throw new TypeError("a syntax node without an index");
  }
  return index;
}

export function wrappedExpression(node: Node): Node | undefined {
  return isParenthesizedExpression(node) ||
    isNonNullExpression(node) ||
    isAsExpression(node) ||
    isSatisfiesExpression(node) ||
    isTypeAssertion(node)
    ? node.expression
    : undefined;
}

export function withoutParentheses(node: Node): Node {
  let at = node;
  for (let inner = wrappedExpression(at); inner !== undefined; inner = wrappedExpression(at)) {
    at = inner;
  }
  return at;
}

export function isFunctionValue(node: Node | undefined): boolean {
  if (node === undefined) {
    return false;
  }
  const value = withoutParentheses(node);
  return isArrowFunction(value) || isFunctionExpression(value);
}

export function hasModifier(node: Node, modifier: SyntaxKind): boolean {
  const modifiers: unknown = Reflect.get(node, "modifiers");
  return Array.isArray(modifiers) && modifiers.some((each: Node) => each.kind === modifier);
}

export function isStatic(node: Node): boolean {
  return hasModifier(node, SyntaxKind.StaticKeyword);
}

export function propertyNameText(name: Node): string {
  if (isIdentifier(name) || isPrivateIdentifier(name) || isStringLiteral(name) || isNumericLiteral(name)) {
    return name.text;
  }
  if (isComputedPropertyName(name)) {
    return `[${name.expression.getText()}]`;
  }
  return name.getText();
}

export function isNameNode(name: Node): boolean {
  return isIdentifier(name) || isPrivateIdentifier(name) || isStringLiteral(name) || isNumericLiteral(name);
}

export interface FunctionParts {
  readonly body: Node | undefined;
  readonly parameters: readonly ParameterDeclaration[];
}

export function functionPartsOf(declaration: Node): FunctionParts | undefined {
  if (
    isFunctionDeclaration(declaration) ||
    isMethodDeclaration(declaration) ||
    isGetAccessorDeclaration(declaration) ||
    isSetAccessorDeclaration(declaration) ||
    isConstructorDeclaration(declaration)
  ) {
    return { body: declaration.body, parameters: ownParameters(declaration.parameters) };
  }
  if (isMethodSignatureDeclaration(declaration)) {
    return { body: undefined, parameters: ownParameters(declaration.parameters) };
  }
  const value = isVariableDeclaration(declaration) || isPropertyDeclaration(declaration)
    ? declaration.initializer
    : isExportAssignment(declaration)
      ? declaration.expression
      : undefined;
  const callable = value === undefined ? undefined : withoutParentheses(value);
  if (callable !== undefined && (isArrowFunction(callable) || isFunctionExpression(callable))) {
    return { body: callable.body, parameters: ownParameters(callable.parameters) };
  }
  return undefined;
}

function ownParameters(parameters: readonly ParameterDeclaration[]): readonly ParameterDeclaration[] {
  return parameters.filter((parameter) => !(isIdentifier(parameter.name) && parameter.name.text === "this"));
}
