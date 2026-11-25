import {
  isArrayLiteralExpression,
  isAwaitExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isExpressionStatement,
  isIdentifier,
  isPropertyAccessExpression,
  isReturnStatement,
  isVariableStatement,
  SyntaxKind,
  type CallExpression,
  type Node,
} from "typescript/ast";
import type { Item, Wrapper } from "../model/index.ts";
import type { Catalog, DeclarationRecord } from "./catalog.ts";
import { functionPartsOf, withoutParentheses } from "./syntax.ts";

export type ResolvedAt = (node: Node) => Item | undefined;

interface Forwarding {
  readonly target: Item;
  readonly fieldsCalledOn: readonly Item[];
}

interface HandedFields {
  readonly returned: Item[];
  readonly written: Item[];
}

export interface BodyWrapping {
  readonly forwarding: Forwarding | undefined;
  readonly handed: HandedFields | undefined;
}

export function wrappingOf(catalog: Catalog, node: Node, item: Item, resolvedAt: ResolvedAt): BodyWrapping | undefined {
  const parts = functionPartsOf(node);
  const takesThis = item.takesThis;
  if (parts?.body === undefined || item.kind !== "function") {
    return undefined;
  }
  const parameters = new Set(parts.parameters.flatMap((parameter) => (isIdentifier(parameter.name) ? [parameter.name.text] : [])));
  return {
    forwarding: forwardingOf(catalog, parts.body, parameters, takesThis, resolvedAt),
    handed: takesThis ? handedFieldsOf(catalog, parts.body, parameters, resolvedAt) : undefined,
  };
}

export function assembleWrappers(catalog: Catalog, wrappings: ReadonlyMap<DeclarationRecord, BodyWrapping>): Map<Item, Wrapper> {
  const wrappers = new Map<Item, Wrapper>();
  const forwardings = new Map<Item, Forwarding>();
  for (const item of catalog.items) {
    if (item.kind !== "function") {
      continue;
    }
    const declarations = catalog.declarationsOf.get(item) ?? [];
    const withBody = declarations.filter((declaration) => declaration.hasBody);
    const [only] = withBody;
    const forwarding = only !== undefined && withBody.length === 1 ? wrappings.get(only)?.forwarding : undefined;
    if (forwarding !== undefined) {
      forwardings.set(item, forwarding);
      continue;
    }
    const accessor = item.takesThis ? accessorOf(catalog, declarations, wrappings) : undefined;
    if (accessor !== undefined) {
      wrappers.set(item, accessor);
    }
  }
  for (const [id, forwarding] of withoutLoops(forwardings)) {
    wrappers.set(id, { kind: "forwarder", target: forwarding.target, fieldsCalledOn: forwarding.fieldsCalledOn });
  }
  return wrappers;
}

function withoutLoops(forwardings: ReadonlyMap<Item, Forwarding>): Map<Item, Forwarding> {
  const looping = new Set<Item>();
  for (const start of forwardings.keys()) {
    const path: Item[] = [];
    let at: Item | undefined = start;
    while (at !== undefined && forwardings.has(at) && !path.includes(at)) {
      path.push(at);
      at = forwardings.get(at)?.target;
    }
    if (at !== undefined && path.includes(at)) {
      for (const member of path.slice(path.indexOf(at))) {
        looping.add(member);
      }
    }
  }
  return new Map([...forwardings].filter(([id]) => !looping.has(id)));
}

function forwardingOf(
  catalog: Catalog,
  body: Node,
  parameters: ReadonlySet<string>,
  takesThis: boolean,
  resolvedAt: ResolvedAt,
): Forwarding | undefined {
  const call = onlyCall(body);
  if (call === undefined) {
    return undefined;
  }
  const passesOnlyParameters = call.arguments.every((argument) => isIdentifier(argument) && parameters.has(argument.text));
  if (!passesOnlyParameters) {
    return undefined;
  }
  const callee = withoutParentheses(call.expression);
  const target = isPropertyAccessExpression(callee) ? resolvedAt(callee.name) : resolvedAt(callee);
  if (target === undefined || target.kind !== "function" || parameterCount(catalog, target) !== call.arguments.length) {
    return undefined;
  }
  if (!isPropertyAccessExpression(callee)) {
    return isIdentifier(callee) ? { target, fieldsCalledOn: [] } : undefined;
  }
  const receiver = withoutParentheses(callee.expression);
  if (isIdentifier(receiver) && (parameters.has(receiver.text) || namesTypeOrModule(catalog, receiver, resolvedAt))) {
    return { target, fieldsCalledOn: [] };
  }
  const fields = takesThis ? fieldPathOfThis(catalog, receiver, resolvedAt) : undefined;
  return fields === undefined ? undefined : { target, fieldsCalledOn: fields };
}

function namesTypeOrModule(catalog: Catalog, receiver: Node, resolvedAt: ResolvedAt): boolean {
  const named = resolvedAt(receiver);
  return named === undefined || named.kind === "type";
}

function onlyCall(body: Node): CallExpression | undefined {
  let expression: Node | undefined = body;
  if (isBlock(body)) {
    const [statement] = body.statements;
    expression =
      body.statements.length !== 1 || statement === undefined
        ? undefined
        : isReturnStatement(statement)
          ? statement.expression
          : isExpressionStatement(statement)
            ? statement.expression
            : undefined;
  }
  if (expression === undefined) {
    return undefined;
  }
  let value = withoutParentheses(expression);
  if (isAwaitExpression(value)) {
    value = withoutParentheses(value.expression);
  }
  return isCallExpression(value) ? value : undefined;
}

function parameterCount(catalog: Catalog, target: Item): number | undefined {
  const declarations = catalog.declarationsOf.get(target) ?? [];
  return (declarations.find((declaration) => declaration.hasBody) ?? declarations[0])?.parameterCount;
}

function fieldPathOfThis(catalog: Catalog, receiver: Node, resolvedAt: ResolvedAt): Item[] | undefined {
  const fields: Item[] = [];
  let at = receiver;
  while (isPropertyAccessExpression(at)) {
    const field = resolvedAt(at.name);
    if (field === undefined || field.kind !== "field") {
      return undefined;
    }
    fields.unshift(field);
    at = withoutParentheses(at.expression);
  }
  return at.kind === SyntaxKind.ThisKeyword ? fields : undefined;
}

function accessorOf(
  catalog: Catalog,
  declarations: readonly DeclarationRecord[],
  wrappings: ReadonlyMap<DeclarationRecord, BodyWrapping>,
): Wrapper | undefined {
  if (declarations.length === 0 || declarations.some((declaration) => declaration.form === "other")) {
    return undefined;
  }
  const handed: HandedFields = { returned: [], written: [] };
  for (const declaration of declarations.filter((each) => each.hasBody)) {
    const fields = wrappings.get(declaration)?.handed;
    if (fields === undefined) {
      return undefined;
    }
    handed.returned.push(...fields.returned);
    handed.written.push(...fields.written);
  }
  if (handed.returned.length === 0 && handed.written.length === 0) {
    return undefined;
  }
  const copied = unique(
    handed.returned.filter((field) => catalog.fieldShapes.get(field) === "primitive" && !handed.written.includes(field)),
  );
  const lent = unique([...handed.returned.filter((field) => !copied.includes(field)), ...handed.written]);
  return { kind: "accessor", lent, copied, lendsOnlyToRead: handed.written.length === 0 };
}

function handedFieldsOf(
  catalog: Catalog,
  body: Node,
  parameters: ReadonlySet<string>,
  resolvedAt: ResolvedAt,
): HandedFields | undefined {
  if (!isBlock(body)) {
    return undefined;
  }
  const handed: HandedFields = { returned: [], written: [] };
  const locals = new Map<string, Item>();
  const fieldOfThis = (node: Node): Item | undefined => {
    const value = withoutParentheses(node);
    if (isIdentifier(value)) {
      return locals.get(value.text);
    }
    if (!isPropertyAccessExpression(value) || withoutParentheses(value.expression).kind !== SyntaxKind.ThisKeyword) {
      return undefined;
    }
    const field = resolvedAt(value.name);
    return field !== undefined && field.kind === "field" ? field : undefined;
  };
  const handedOut = (node: Node): Item[] | undefined => {
    const value = withoutParentheses(node);
    if (isArrayLiteralExpression(value)) {
      const parts = value.elements.map(fieldOfThis);
      return parts.every((part) => part !== undefined) ? parts : undefined;
    }
    const field = fieldOfThis(value);
    return field === undefined ? undefined : [field];
  };
  const statements = body.statements;
  for (const [index, statement] of statements.entries()) {
    if (isVariableStatement(statement)) {
      for (const variable of statement.declarationList.declarations) {
        const field = variable.initializer === undefined ? undefined : fieldOfThis(variable.initializer);
        if (!isIdentifier(variable.name) || field === undefined) {
          return undefined;
        }
        locals.set(variable.name.text, field);
      }
    } else if (isExpressionStatement(statement)) {
      const assignment = withoutParentheses(statement.expression);
      if (!isBinaryExpression(assignment) || assignment.operatorToken.kind !== SyntaxKind.EqualsToken) {
        return undefined;
      }
      const field = fieldOfThis(assignment.left);
      const value = withoutParentheses(assignment.right);
      if (field === undefined || isIdentifier(withoutParentheses(assignment.left)) || !isIdentifier(value) || !parameters.has(value.text)) {
        return undefined;
      }
      handed.written.push(field);
    } else if (isReturnStatement(statement) && index === statements.length - 1 && statement.expression !== undefined) {
      const fields = handedOut(statement.expression);
      if (fields === undefined) {
        return undefined;
      }
      handed.returned.push(...fields);
    } else {
      return undefined;
    }
  }
  return handed;
}

function unique(items: readonly Item[]): Item[] {
  return [...new Set(items)];
}
