import {
  isArrayLiteralExpression,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isDeleteExpression,
  isDoStatement,
  isElementAccessExpression,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isIfStatement,
  isNewExpression,
  isObjectLiteralExpression,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isTaggedTemplateExpression,
  isTypeOfExpression,
  isWhileStatement,
  SyntaxKind,
  type Node,
} from "typescript/ast";
import { nodeIndex, wrappedExpression } from "./syntax.ts";
import type { ValueShape } from "./valueShape.ts";

export type AccessUse = "writes" | "reachesInto" | "tests" | "calls" | "takesValue";

const ASSIGNMENTS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

const COMPARISONS = new Set<SyntaxKind>([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
]);

export function onlyReadsValue(use: AccessUse, shape: ValueShape): boolean {
  switch (use) {
    case "writes":
      return false;
    case "reachesInto":
      return shape === "primitive";
    case "tests":
    case "calls":
      return true;
    case "takesValue":
      return shape !== "structured";
  }
}

export function accessUseOf(access: Node): AccessUse {
  const at = outermostWrapping(access);
  const parent = at.parent;
  if (isWrittenAt(at)) {
    return "writes";
  }
  if ((isPropertyAccessExpression(parent) || isElementAccessExpression(parent)) && same(parent.expression, at)) {
    return "reachesInto";
  }
  if ((isCallExpression(parent) || isNewExpression(parent)) && same(parent.expression, at)) {
    return "calls";
  }
  if (isTaggedTemplateExpression(parent) && same(parent.tag, at)) {
    return "calls";
  }
  return isTestedAt(at) ? "tests" : "takesValue";
}

function outermostWrapping(node: Node): Node {
  let at = node;
  for (let wrapped = wrappedExpression(at.parent); wrapped !== undefined && same(wrapped, at); wrapped = wrappedExpression(at.parent)) {
    at = at.parent;
  }
  return at;
}

function isWrittenAt(at: Node): boolean {
  const parent = at.parent;
  if (isBinaryExpression(parent) && ASSIGNMENTS.has(parent.operatorToken.kind) && same(parent.left, at)) {
    return true;
  }
  if ((isPrefixUnaryExpression(parent) || isPostfixUnaryExpression(parent)) && isIncrement(parent.operator)) {
    return true;
  }
  if (isDeleteExpression(parent)) {
    return true;
  }
  if ((isForOfStatement(parent) || isForInStatement(parent)) && same(parent.initializer, at)) {
    return true;
  }
  return isDestructuringTarget(at);
}

function isIncrement(operator: SyntaxKind): boolean {
  return operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken;
}

function isDestructuringTarget(at: Node): boolean {
  let literal: Node | undefined;
  for (let node = at; ; node = node.parent) {
    const parent = node.parent;
    if (isArrayLiteralExpression(parent) || isObjectLiteralExpression(parent)) {
      literal = parent;
    } else if (
      !(isPropertyAssignment(parent) && same(parent.initializer, node)) &&
      !isShorthandPropertyAssignment(parent) &&
      !isSpreadElement(parent) &&
      !isSpreadAssignment(parent)
    ) {
      break;
    }
  }
  if (literal === undefined) {
    return false;
  }
  const container = outermostWrapping(literal).parent;
  return (
    (isBinaryExpression(container) &&
      container.operatorToken.kind === SyntaxKind.EqualsToken &&
      same(container.left, outermostWrapping(literal))) ||
    ((isForOfStatement(container) || isForInStatement(container)) && same(container.initializer, outermostWrapping(literal)))
  );
}

function isTestedAt(at: Node): boolean {
  const parent = at.parent;
  if (isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind;
    if (COMPARISONS.has(operator)) {
      return true;
    }
    if (operator === SyntaxKind.InstanceOfKeyword && same(parent.left, at)) {
      return true;
    }
    if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
      return isTestedAt(outermostWrapping(parent));
    }
    return false;
  }
  if (isPrefixUnaryExpression(parent)) {
    return parent.operator === SyntaxKind.ExclamationToken;
  }
  if (isTypeOfExpression(parent)) {
    return true;
  }
  if (isIfStatement(parent) || isWhileStatement(parent) || isDoStatement(parent)) {
    return same(parent.expression, at);
  }
  if (isForStatement(parent)) {
    return parent.condition !== undefined && same(parent.condition, at);
  }
  if (isConditionalExpression(parent)) {
    return same(parent.condition, at);
  }
  return false;
}

function same(a: Node, b: Node): boolean {
  return a === b || (a.kind === b.kind && nodeIndex(a) === nodeIndex(b));
}
