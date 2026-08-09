export type DirtyKind = "RAW" | "EVIDENCE" | "CLAIM" | "RULE";
export interface DependencyEdge { from: string; to: string; }
export interface DirtyNode { id: string; kind: DirtyKind; }

export function propagateDirty(startIds: readonly string[], edges: readonly DependencyEdge[], kindFor: (id: string) => DirtyKind): DirtyNode[] {
  const queue = [...new Set(startIds)];
  const seen = new Set(queue);
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of outgoing.get(queue[cursor]!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return queue.map((id) => ({ id, kind: kindFor(id) }));
}
