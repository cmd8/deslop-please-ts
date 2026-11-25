export function idFromIndex<Id extends number>(index: number): Id {
  return index as Id;
}
