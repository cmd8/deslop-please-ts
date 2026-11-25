import {
  isBindingElement,
  isExportAssignment,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isNamedImports,
  isNamespaceImport,
  isObjectBindingPattern,
  isPrivateIdentifier,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  SyntaxKind,
  type BindingElement,
  type Node,
  type ObjectBindingPattern,
  type SourceFile,
} from "typescript/ast";
import { SymbolFlags, type API, type Checker, type Symbol as CompilerSymbol, type Type } from "typescript/sync";
import type { ItemId } from "../model/index.ts";
import type { Catalog } from "./catalog.ts";
import type { AnalyzedSource } from "./programs.ts";
import { declarationKey, nodeIndex, propertyNameText, withoutParentheses } from "./syntax.ts";

export type NameRole = "named" | "destructured";

export interface ResolvedName {
  readonly node: Node;
  readonly item: ItemId;
  readonly role: NameRole;
}

interface Destructuring {
  readonly node: Node;
  readonly pattern: ObjectBindingPattern;
  readonly property: string;
}

interface NamesToResolve {
  readonly named: Node[];
  readonly shorthands: Node[];
  readonly destructurings: Destructuring[];
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
  readonly #aliasTargets = new Map<Checker, Map<number, CompilerSymbol>>();

  constructor(api: API, catalog: Catalog) {
    this.#api = api;
    this.#catalog = catalog;
  }

  resolve(source: AnalyzedSource): ResolvedName[] {
    const names = this.#namesToResolve(source.sourceFile);
    const checker = source.checker;
    const named = names.named.length === 0 ? [] : checker.getSymbolAtLocation(names.named);
    const shorthandValues = this.#api.batch(
      ...names.shorthands.map((node) => checker.getShorthandAssignmentValueSymbol.gen(node.parent)),
    );
    const patterns = [...new Set(names.destructurings.map((each) => each.pattern))];
    const patternTypes = new Map<ObjectBindingPattern, Type>();
    if (patterns.length > 0) {
      checker.getTypeAtLocation(patterns).forEach((type, index) => {
        const pattern = patterns[index];
        if (pattern !== undefined) {
          patternTypes.set(pattern, type);
        }
      });
    }
    const destructured = this.#api.batch(
      ...names.destructurings.flatMap((each) => {
        const type = patternTypes.get(each.pattern);
        return type === undefined ? [] : [checker.getPropertyOfType.gen(type, each.property)];
      }),
    );
    const typed = names.destructurings.filter((each) => patternTypes.has(each.pattern));
    const resolved: ResolvedName[] = [];
    const add = (node: Node, symbol: CompilerSymbol | undefined, role: NameRole) => {
      const item = symbol === undefined ? undefined : this.#itemOf(checker, symbol);
      if (item !== undefined) {
        resolved.push({ node, item, role });
      }
    };
    this.#followAliases(checker, [...named, ...shorthandValues]);
    names.named.forEach((node, index) => add(node, named[index], "named"));
    names.shorthands.forEach((node, index) => add(node, shorthandValues[index], "named"));
    typed.forEach((each, index) => add(each.node, destructured[index], "destructured"));
    return resolved.sort((a, b) => nodeIndex(a.node) - nodeIndex(b.node));
  }

  #itemOf(checker: Checker, symbol: CompilerSymbol): ItemId | undefined {
    const target = (symbol.flags & SymbolFlags.Alias) !== 0 ? this.#aliasTargetsOf(checker).get(symbol.id) : symbol;
    const first = target?.declarations[0];
    return first === undefined ? undefined : this.#catalog.itemAt.get(declarationKey(first.path, first.index));
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
      if (target !== undefined) {
        known.set(alias.id, target);
      }
    });
  }

  #aliasTargetsOf(checker: Checker): Map<number, CompilerSymbol> {
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
    const names: NamesToResolve = { named: [], shorthands: [], destructurings: [] };
    const visit = (node: Node): void => {
      if (isOutsideCode(node)) {
        return;
      }
      if (isObjectBindingPattern(node)) {
        for (const element of node.elements) {
          collectDestructuring(element, node, wanted, names);
        }
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

function collectName(node: Node, names: NamesToResolve): void {
  const parent = node.parent;
  if (isShorthandPropertyAssignment(parent) && sameNode(parent.name, node)) {
    names.shorthands.push(node);
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
  pattern: ObjectBindingPattern,
  wanted: (name: string) => boolean,
  names: NamesToResolve,
): void {
  const name = element.propertyName ?? element.name;
  if (element.dotDotDotToken !== undefined || name === undefined || !(isIdentifier(name) || isPrivateIdentifier(name))) {
    return;
  }
  const property = propertyNameText(name);
  if (wanted(property)) {
    names.destructurings.push({ node: name, pattern, property });
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
