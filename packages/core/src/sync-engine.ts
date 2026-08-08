import type { Change, ChangeSet, RawBlockSnapshot } from "./domain.js";

export interface SyncState { cursor?: string; blocks: ReadonlyMap<string, string>; }
export interface SyncPlan { changeSet: ChangeSet; dirtyBlockIds: readonly string[]; }

export function planBlockSync(sourceId: ChangeSet["sourceId"], sourceType: ChangeSet["sourceType"], cursor: string, previous: SyncState, next: readonly RawBlockSnapshot[], fetchedAt = new Date()): SyncPlan {
  const hashes = new Map<string, string>(next.map((block) => [block.id, block.contentHash]));
  const changes: Change[] = [];
  for (const block of next) {
    const old = previous.blocks.get(block.id);
    if (!old) changes.push({ kind: "ADDED", entityId: block.sourceEntityId, revision: block.revision });
    else if (old !== block.contentHash) changes.push({ kind: "MODIFIED", entityId: block.sourceEntityId, revision: block.revision });
  }
  for (const id of previous.blocks.keys()) if (!hashes.has(id)) changes.push({ kind: "DELETED", entityId: id as Change["entityId"], revision: cursor });
  return { changeSet: { sourceId, sourceType, cursor, changes, fetchedAt }, dirtyBlockIds: [...hashes.keys()].filter((id) => previous.blocks.get(id) !== hashes.get(id)) };
}
