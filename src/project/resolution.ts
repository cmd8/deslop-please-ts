import {
  isBindingElement,
  isExportAssignment,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isJsxAttribute,
  isJsxAttributes,
  isNamedImports,
  isNamespaceImport,
  isNewExpression,
  isObjectBindingPattern,
  isPrivateIdentifier,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  SyntaxKind,
  type BindingElement,
  type JsxAttributes,
  type Node,
  type ObjectBindingPattern,
  type SourceFile,
} from "typescript/ast";
import { SymbolFlags, type API, type Checker, type Symbol as CompilerSymbol, type Type } from "typescript/sync";
import type { ItemId } from "../model/index.ts";
import type { Catalog } from "./catalog.ts";
import { nodeIndex, propertyNameText, withoutParentheses } from "./syntax.ts";

export type NameRole = "named" | "destructured";

export interface ResolvedName {
  readonly node: Node;
  readonly item: ItemId;
  readonly role: NameRole;
}

type PropertyOwner =
  | { readonly kind: "destructured"; readonly pattern: ObjectBindingPattern }
  | { readonly kind: "jsxAttribute"; readonly attributes: JsxAttributes };

interface PropertyRead {
  readonly node: Node;
  readonly owner: PropertyOwner;
  readonly property: string;
}

interface NamesToResolve {
  readonly named: Node[];
  readonly shorthands: Node[];
  readonly propertyReads: PropertyRead[];
}

const DECLARATION_KINDS = new Set<SyntaxKind>([
  SyntaxKind.ClassDeclaration,
  SyntaxKind.ClassExpression,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.EnumMember,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.MethodSignature,
  SyntaxKind.PropertyDeclaration,
  SyntaxKind.PropertySignature,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.Parameter,
  SyntaxKind.VariableDeclaration,
  SyntaxKind.BindingElement,
  SyntaxKind.TypeParameter,
  SyntaxKind.ModuleDeclaration,
  SyntaxKind.PropertyAssignment,
  SyntaxKind.NamedTupleMember,
  SyntaxKind.ImportClause,
  SyntaxKind.NamespaceImport,
  SyntaxKind.ImportEqualsDeclaration,
  SyntaxKind.NamespaceExport,
]);

export class NameResolver {
  readonly #api: API;
  readonly #catalog: Catalog;
  readonly #aliasTargets = new WeakMap<Checker, Map<number, ItemId | undefined>>();

  constructor(api: API, catalog: Catalog) {
    this.#api = api;
    this.#catalog = catalog;
  }

  resolve(checker: Checker, tree: SourceFile): ResolvedName[] {
    const names = this.#namesToResolve(tree);
    const named = names.named.length === 0 ? [] : checker.getSymbolAtLocation(names.named);
    const shorthandValues = this.#api.batch(
      ...names.shorthands.map((node) => checker.getShorthandAssignmentValueSymbol.gen(node.parent)),
    );
    const ownerTypes = this.#ownerTypes(checker, names.propertyReads);
    const typed = names.propertyReads.filter((read) => ownerTypes.has(read.owner));
    const properties = this.#api.batch(
      ...typed.flatMap((read) => {
        const type = ownerTypes.get(read.owner);
        return type === undefined ? [] : [checker.getPropertyOfType.gen(type, read.property)];
      }),
    );
    this.#followAliases(checker, [...named, ...shorthandValues]);
    const resolved: ResolvedName[] = [];
    const add = (node: Node, symbol: CompilerSymbol | undefined, role: NameRole) => {
      const item = symbol === undefined ? undefined : this.#itemOf(checker, symbol);
      if (item === undefined) {
        return;
      }
      resolved.push({ node, item, role });
      const constructor = isConstructed(node) ? this.#catalog.constructorOf.get(item) : undefined;
      if (constructor !== undefined) {
        resolved.push({ node, item: constructor, role });
      }
    };
    names.named.forEach((node, index) => add(node, named[index], "named"));
    names.shorthands.forEach((node, index) => add(node, shorthandValues[index], "named"));
    typed.forEach((read, index) => add(read.node, properties[index], read.owner.kind === "destructured" ? "destructured" : "named"));
    return resolved.sort((a, b) => nodeIndex(a.node) - nodeIndex(b.node));
  }

  #ownerTypes(checker: Checker, reads: readonly PropertyRead[]): Map<PropertyOwner, Type> {
    const owners = [...new Set(reads.map((read) => read.owner))];
    const types = new Map<PropertyOwner, Type>();
    const destructured = owners.flatMap((owner) => (owner.kind === "destructured" ? [owner] : []));
    if (destructured.length > 0) {
      checker.getTypeAtLocation(destructured.map((owner) => owner.pattern)).forEach((type, index) => {
        const owner = destructured[index];
        if (owner !== undefined) {
          types.set(owner, type);
        }
      });
    }
    const attributes = owners.flatMap((owner) => (owner.kind === "jsxAttribute" ? [owner] : []));
    this.#api
      .batch(...attributes.map((owner) => checker.getContextualType.gen(owner.attributes)))
      .forEach((type, index) => {
        const owner = attributes[index];
        if (owner !== undefined && type !== undefined) {
          types.set(owner, type);
        }
      });
    return types;
  }

  #itemOf(checker: Checker, symbol: CompilerSymbol): ItemId | undefined {
    return (symbol.flags & SymbolFlags.Alias) !== 0 ? this.#aliasTargetsOf(checker).get(symbol.id) : this.#itemDeclaring(symbol);
  }

  #followAliases(checker: Checker, symbols: readonly (CompilerSymbol | undefined)[]): void {
    const known = this.#aliasTargetsOf(checker);
    const pending = new Map<number, CompilerSymbol>();
    for (const symbol of symbols) {
      if (symbol !== undefined && (symbol.flags & SymbolFlags.Alias) !== 0 && !known.has(symbol.id)) {
        pending.set(symbol.id, symbol);
      }
    }
    const aliases = [...pending.values()];
    const targets = this.#api.batch(...aliases.map((alias) => checker.getAliasedSymbol.gen(alias)));
    aliases.forEach((alias, index) => {
      const target = targets[index];
      known.set(alias.id, target === undefined ? undefined : this.#itemDeclaring(target));
    });
  }

  #itemDeclaring(symbol: CompilerSymbol): ItemId | undefined {
    const first = symbol.declarations[0];
    return first === undefined ? undefined : this.#catalog.itemAt(first.path, first.index);
  }

  #aliasTargetsOf(checker: Checker): Map<number, ItemId | undefined> {
    let known = this.#aliasTargets.get(checker);
    if (known === undefined) {
      known = new Map();
      this.#aliasTargets.set(checker, known);
    }
    return known;
  }

  #namesToResolve(sourceFile: SourceFile): NamesToResolve {
    const imported = importedNames(sourceFile);
    const memberNames = this.#catalog.memberNames;
    const wanted = (name: string) => memberNames.has(name) || imported.has(name);
    const names: NamesToResolve = { named: [], shorthands: [], propertyReads: [] };
    const jsxOwners = new Map<number, PropertyOwner>();
    const visit = (node: Node): void => {
      if (isOutsideCode(node)) {
        return;
      }
      if (isObjectBindingPattern(node)) {
        const owner: PropertyOwner = { kind: "destructured", pattern: node };
        for (const element of node.elements) {
          collectDestructuring(element, owner, wanted, names);
        }
      }
      if (isJsxAttribute(node) && isJsxAttributes(node.parent) && isIdentifier(node.name) && wanted(node.name.text)) {
        const attributes = node.parent;
        const owner = jsxOwners.get(nodeIndex(attributes)) ?? { kind: "jsxAttribute", attributes };
        jsxOwners.set(nodeIndex(attributes), owner);
        names.propertyReads.push({ node: node.name, owner, property: node.name.text });
      }
      if ((isIdentifier(node) || isPrivateIdentifier(node)) && wanted(node.text)) {
        collectName(node, names);
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
    return names;
  }
}

function isConstructed(node: Node): boolean {
  const parent = node.parent;
  const callee = isPropertyAccessExpression(parent) && sameNode(parent.name, node) ? parent : node;
  const call = callee.parent;
  return isNewExpression(call) && sameNode(call.expression, callee);
}

function collectName(node: Node, names: NamesToResolve): void {
  const parent = node.parent;
  if (isShorthandPropertyAssignment(parent) && sameNode(parent.name, node)) {
    names.shorthands.push(node);
  } else if (isJsxAttribute(parent) && sameNode(parent.name, node)) {
    return;
  } else if (isBindingElement(parent) && isObjectBindingPattern(parent.parent) && isBindingElementName(parent, node)) {
    return;
  } else if (!isDeclarationName(node)) {
    names.named.push(node);
  }
}

function isBindingElementName(element: BindingElement, node: Node): boolean {
  return (
    (element.name !== undefined && sameNode(element.name, node)) ||
    (element.propertyName !== undefined && sameNode(element.propertyName, node))
  );
}

function collectDestructuring(
  element: BindingElement,
  owner: PropertyOwner,
  wanted: (name: string) => boolean,
  names: NamesToResolve,
): void {
  const name = element.propertyName ?? element.name;
  if (element.dotDotDotToken !== undefined || name === undefined || !(isIdentifier(name) || isPrivateIdentifier(name))) {
    return;
  }
  const property = propertyNameText(name);
  if (wanted(property)) {
    names.propertyReads.push({ node: name, owner, property });
  }
}

function isOutsideCode(node: Node): boolean {
  if (isImportDeclaration(node) || isExportDeclaration(node) || isImportEqualsDeclaration(node)) {
    return true;
  }
  if (isExportAssignment(node)) {
    const value = withoutParentheses(node.expression);
    return isIdentifier(value) || isPropertyAccessExpression(value);
  }
  return false;
}

function isDeclarationName(node: Node): boolean {
  const parent = node.parent;
  if (!DECLARATION_KINDS.has(parent.kind)) {
    return false;
  }
  const name: unknown = Reflect.get(parent, "name");
  return typeof name === "object" && name !== null && sameNode(name, node);
}

function sameNode(a: object, b: Node): boolean {
  return a === b || (isNode(a) && nodeIndex(a) === nodeIndex(b) && a.kind === b.kind);
}

function isNode(value: object): value is Node {
  return "kind" in value && "parent" in value;
}

function importedNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (isImportEqualsDeclaration(statement)) {
      names.add(statement.name.text);
    }
    const clause = isImportDeclaration(statement) ? statement.importClause : undefined;
    if (clause === undefined) {
      continue;
    }
    if (clause.name !== undefined) {
      names.add(clause.name.text);
    }
    const bindings = clause.namedBindings;
    if (bindings !== undefined && isNamespaceImport(bindings)) {
      names.add(bindings.name.text);
    } else if (bindings !== undefined && isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        names.add(propertyNameText(specifier.name));
      }
    }
  }
  return names;
}
