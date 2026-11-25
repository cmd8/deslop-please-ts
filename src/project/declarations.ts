import {
  isArrayBindingPattern,
  isClassDeclaration,
  isClassExpression,
  isConstructorDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isFunctionDeclaration,
  isGetAccessorDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isMethodSignatureDeclaration,
  isModuleBlock,
  isModuleDeclaration,
  isObjectBindingPattern,
  isOmittedExpression,
  isPropertyAccessExpression,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isSetAccessorDeclaration,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isVariableStatement,
  SyntaxKind,
  type BindingName,
  type ClassDeclaration,
  type Node,
  type SourceFile,
  type Statement,
} from "typescript/ast";
import type { ItemKind } from "../model/index.ts";
import { hasModifier, isFunctionValue, isNameNode, isStatic, propertyNameText, withoutParentheses } from "./syntax.ts";

export interface Declaration {
  readonly node: Node;
  readonly name: string;
  readonly memberName: string;
  readonly kind: ItemKind;
  readonly parent: Declaration | undefined;
  readonly takesThis: boolean;
  readonly symbolName: Node | undefined;
  readonly memberOf: ClassDeclaration | undefined;
}

interface Scope {
  readonly prefix: string;
  readonly parent: Declaration | undefined;
  readonly memberOf: ClassDeclaration | undefined;
}

const DEFAULT_EXPORT = "default";
const PARAMETER_PROPERTY_MODIFIERS = [
  SyntaxKind.PublicKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.ProtectedKeyword,
  SyntaxKind.ReadonlyKeyword,
  SyntaxKind.OverrideKeyword,
];

export function declarationsOf(sourceFile: SourceFile): Declaration[] {
  const found: Declaration[] = [];
  for (const statement of sourceFile.statements) {
    collectStatement(statement, "", found);
  }
  return found;
}

function collectStatement(statement: Statement, prefix: string, found: Declaration[]): void {
  const declare = (fields: Omit<Declaration, "parent" | "memberOf" | "takesThis" | "name">): Declaration => {
    const declaration: Declaration = {
      ...fields,
      name: `${prefix}${fields.memberName}`,
      parent: undefined,
      memberOf: undefined,
      takesThis: false,
    };
    found.push(declaration);
    return declaration;
  };
  if (isClassDeclaration(statement)) {
    const type = declare({
      node: statement,
      memberName: statement.name?.text ?? DEFAULT_EXPORT,
      kind: "type",
      symbolName: statement.name,
    });
    collectClassMembers(statement, type, found);
  } else if (isInterfaceDeclaration(statement)) {
    const type = declare({ node: statement, memberName: statement.name.text, kind: "type", symbolName: statement.name });
    collectTypeElements(statement.members, scopeOf(type), found);
  } else if (isTypeAliasDeclaration(statement)) {
    const type = declare({ node: statement, memberName: statement.name.text, kind: "type", symbolName: statement.name });
    if (isTypeLiteralNode(statement.type)) {
      collectTypeElements(statement.type.members, scopeOf(type), found);
    }
  } else if (isEnumDeclaration(statement)) {
    const type = declare({ node: statement, memberName: statement.name.text, kind: "type", symbolName: statement.name });
    for (const member of statement.members) {
      found.push(memberDeclaration(member, propertyNameText(member.name), "variant", scopeOf(type), false));
    }
  } else if (isFunctionDeclaration(statement)) {
    declare({
      node: statement,
      memberName: statement.name?.text ?? DEFAULT_EXPORT,
      kind: "function",
      symbolName: statement.name,
    });
  } else if (isVariableStatement(statement)) {
    for (const variable of statement.declarationList.declarations) {
      if (isIdentifier(variable.name)) {
        declare({
          node: variable,
          memberName: variable.name.text,
          kind: isFunctionValue(variable.initializer) ? "function" : "constant",
          symbolName: variable.name,
        });
      } else {
        for (const element of bindingElementsOf(variable.name)) {
          declare({ node: element.node, memberName: element.name.text, kind: "constant", symbolName: element.name });
        }
      }
    }
  } else if (isModuleDeclaration(statement)) {
    collectModule(statement, prefix, found);
  } else if (isExportAssignment(statement) && !statement.isExportEquals) {
    const value = withoutParentheses(statement.expression);
    if (!isIdentifier(value) && !isPropertyAccessExpression(value)) {
      declare({
        node: statement,
        memberName: DEFAULT_EXPORT,
        kind: isFunctionValue(value) ? "function" : isClassExpression(value) ? "type" : "constant",
        symbolName: undefined,
      });
    }
  }
}

function collectModule(statement: Node, prefix: string, found: Declaration[]): void {
  if (!isModuleDeclaration(statement)) {
    return;
  }
  const inner = isIdentifier(statement.name) && statement.name.text !== "global"
    ? `${prefix}${statement.name.text}.`
    : prefix;
  const body = statement.body;
  if (body === undefined) {
    return;
  }
  if (isModuleBlock(body)) {
    for (const nested of body.statements) {
      collectStatement(nested, inner, found);
    }
  } else {
    collectModule(body, inner, found);
  }
}

function collectClassMembers(type: ClassDeclaration, declaration: Declaration, found: Declaration[]): void {
  const scope: Scope = { prefix: `${declaration.name}.`, parent: declaration, memberOf: type };
  let constructorSeen = false;
  for (const member of type.members) {
    if (isPropertyDeclaration(member)) {
      const name = propertyNameText(member.name);
      const kind: ItemKind = isStatic(member) ? "constant" : isFunctionValue(member.initializer) ? "function" : "field";
      found.push(memberDeclaration(member, name, kind, scope, kind === "function", member.name));
    } else if (isMethodDeclaration(member) || isGetAccessorDeclaration(member) || isSetAccessorDeclaration(member)) {
      found.push(memberDeclaration(member, propertyNameText(member.name), "function", scope, !isStatic(member), member.name));
    } else if (isConstructorDeclaration(member) && !constructorSeen) {
      constructorSeen = true;
      found.push(memberDeclaration(member, "constructor", "function", scope, false, undefined));
      for (const parameter of member.parameters) {
        if (isIdentifier(parameter.name) && PARAMETER_PROPERTY_MODIFIERS.some((kind) => hasModifier(parameter, kind))) {
          found.push(memberDeclaration(parameter, parameter.name.text, "field", scope, false, parameter.name));
        }
      }
    }
  }
}

function collectTypeElements(members: readonly Node[], scope: Scope, found: Declaration[]): void {
  for (const member of members) {
    if (isPropertySignatureDeclaration(member)) {
      const field = memberDeclaration(member, propertyNameText(member.name), "field", scope, false, member.name);
      found.push(field);
      if (isTypeLiteralNode(member.type)) {
        collectTypeElements(member.type.members, scopeOf(field), found);
      }
    } else if (isMethodSignatureDeclaration(member)) {
      found.push(memberDeclaration(member, propertyNameText(member.name), "function", scope, true, member.name));
    }
  }
}

function memberDeclaration(
  node: Node,
  memberName: string,
  kind: ItemKind,
  scope: Scope,
  takesThis: boolean,
  name?: Node,
): Declaration {
  return {
    node,
    name: `${scope.prefix}${memberName}`,
    memberName,
    kind,
    parent: scope.parent,
    takesThis,
    symbolName: name !== undefined && isNameNode(name) ? name : undefined,
    memberOf: scope.memberOf,
  };
}

function scopeOf(declaration: Declaration): Scope {
  return { prefix: `${declaration.name}.`, parent: declaration, memberOf: undefined };
}

interface BoundName {
  readonly node: Node;
  readonly name: { readonly text: string } & Node;
}

function bindingElementsOf(pattern: BindingName): BoundName[] {
  if (!isObjectBindingPattern(pattern) && !isArrayBindingPattern(pattern)) {
    return [];
  }
  return pattern.elements.flatMap((element): BoundName[] => {
    if (isOmittedExpression(element) || element.name === undefined) {
      return [];
    }
    return isIdentifier(element.name) ? [{ node: element, name: element.name }] : bindingElementsOf(element.name);
  });
}
