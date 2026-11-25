import type { ClassDeclaration, Node } from "typescript/ast";
import type { API, Checker } from "typescript/sync";

export function inheritedMemberNames(
  api: API,
  checker: Checker,
  classes: readonly ClassDeclaration[],
): Map<ClassDeclaration, Set<string>> {
  const heritage: { readonly owner: ClassDeclaration; readonly node: Node }[] = [];
  for (const owner of classes) {
    for (const clause of owner.heritageClauses ?? []) {
      for (const node of clause.types) {
        heritage.push({ owner, node });
      }
    }
  }
  const names = new Map<ClassDeclaration, Set<string>>();
  if (heritage.length === 0) {
    return names;
  }
  const types = checker.getTypeAtLocation(heritage.map((entry) => entry.node));
  const properties = api.batch(...types.map((type) => checker.getPropertiesOfType.gen(type)));
  heritage.forEach((entry, index) => {
    const inherited = names.get(entry.owner) ?? new Set<string>();
    for (const property of properties[index] ?? []) {
      inherited.add(property.name);
    }
    names.set(entry.owner, inherited);
  });
  return names;
}
