import Database from "better-sqlite3";
import { validateMutation, type ChangeSet, type DomainEvent, type Evidence, type EventStore, type MaterializedSpec, type MutationPolicy, type MutationProposal, type RawBlockSnapshot, type SourceDescriptor } from "@mobile-spec-brain/core";
import { initialMigration } from "./migration.js";

export function openWorkspaceDatabase(path: string): Database.Database {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.exec(initialMigration);
  database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run("001_initial", new Date().toISOString());
  return database;
}

export class SqliteEventStore implements EventStore {
  constructor(private readonly database: Database.Database) {}
  async append(event: DomainEvent): Promise<void> {
    this.database.prepare("INSERT INTO events (id, occurred_at, actor, operation, entity_type, entity_id, evidence_ids_json, reason, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.id, event.occurredAt.toISOString(), event.actor, event.operation, event.entityType, event.entityId, JSON.stringify(event.evidenceIds), event.reason, JSON.stringify(event.payload));
  }
  async list(entityId: string): Promise<readonly DomainEvent[]> {
    return this.database.prepare("SELECT * FROM events WHERE entity_id = ? ORDER BY occurred_at").all(entityId).map((row) => {
      const event = row as Record<string, string>;
      return { id: event.id!, occurredAt: new Date(event.occurred_at!), actor: event.actor!, operation: event.operation!, entityType: event.entity_type!, entityId: event.entity_id!, evidenceIds: JSON.parse(event.evidence_ids_json!), reason: event.reason!, payload: JSON.parse(event.payload_json!) } as DomainEvent;
    });
  }
}

export interface AppliedSourceSync { source: SourceDescriptor; changeSet: ChangeSet; blocks: readonly RawBlockSnapshot[]; actor: string; }

export function readSyncState(database: Database.Database, sourceId: string): { cursor?: string; blocks: Map<string, string> } {
  const cursor = (database.prepare("SELECT cursor FROM sync_cursors WHERE source_id = ?").get(sourceId) as { cursor?: string } | undefined)?.cursor;
  const rows = database.prepare("SELECT b.external_id, b.content_hash FROM raw_blocks b JOIN raw_revisions r ON r.id = b.raw_revision_id JOIN source_entities e ON e.id = r.source_entity_id WHERE e.source_id = ? ORDER BY rowid").all(sourceId) as { external_id: string; content_hash: string }[];
  return { cursor, blocks: new Map(rows.map((row) => [row.external_id, row.content_hash])) };
}

/** The only raw-write path: append revisions and advance a cursor atomically. */
export function applySourceSync(database: Database.Database, input: AppliedSourceSync): void {
  const workspace = database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string } | undefined;
  if (!workspace) throw new Error("Workspace has not been initialized");
  const apply = database.transaction(() => {
    database.prepare("INSERT OR IGNORE INTO sources (id, workspace_id, type, status, configuration_json, created_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?)")
      .run(input.source.id, workspace.id, input.source.type, JSON.stringify(input.source.configuration), input.changeSet.fetchedAt.toISOString());
    for (const block of input.blocks) {
      database.prepare("INSERT OR IGNORE INTO source_entities (id, source_id, external_id, kind, state) VALUES (?, ?, ?, 'BLOCK', 'ACTIVE')")
        .run(block.sourceEntityId, input.source.id, block.id);
      const revisionId = `revision:${block.sourceEntityId}:${block.revision}`;
      database.prepare("INSERT OR IGNORE INTO raw_revisions (id, source_entity_id, revision, content_hash, content_json, fetched_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(revisionId, block.sourceEntityId, block.revision, block.contentHash, JSON.stringify(block.content), input.changeSet.fetchedAt.toISOString(), JSON.stringify(block.metadata));
      database.prepare("INSERT OR IGNORE INTO raw_blocks (id, raw_revision_id, external_id, content_hash, content_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?)")
        .run(`block-revision:${block.id}:${block.revision}`, revisionId, block.id, block.contentHash, JSON.stringify(block.content), JSON.stringify(block.metadata));
    }
    database.prepare("INSERT INTO sync_cursors (source_id, cursor, updated_at) VALUES (?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at")
      .run(input.source.id, input.changeSet.cursor, input.changeSet.fetchedAt.toISOString());
    database.prepare("INSERT INTO events (id, occurred_at, actor, operation, entity_type, entity_id, evidence_ids_json, reason, payload_json) VALUES (?, ?, ?, 'sync.apply', 'source', ?, '[]', 'source snapshot applied', ?)")
      .run(`event:sync:${input.source.id}:${input.changeSet.cursor}`, input.changeSet.fetchedAt.toISOString(), input.actor, input.source.id, JSON.stringify({ changed: input.changeSet.changes.length, blocks: input.blocks.length }));
  });
  apply();
}

/** Extraction results are immutable evidence records; a later extractor version creates a new row. */
export function persistEvidence(database: Database.Database, evidence: readonly Evidence[]): void {
  const persist = database.transaction(() => {
    for (const item of evidence) {
      const rawBlock = database.prepare("SELECT id FROM raw_blocks WHERE external_id = ? ORDER BY rowid DESC LIMIT 1").get(item.provenance.rawBlockId) as { id: string } | undefined;
      if (!rawBlock) throw new Error(`Missing raw block for evidence ${item.id}`);
      database.prepare("INSERT OR IGNORE INTO evidence (id, raw_block_id, kind, subject, predicate, value_json, extraction_confidence, authority, provenance_json, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')")
        .run(item.id, rawBlock.id, item.kind, item.subject, item.predicate, JSON.stringify(item.value), item.extractionConfidence, item.authority, JSON.stringify(item.provenance));
    }
  });
  persist();
}

export function materializeSpecs(database: Database.Database, specs: readonly MaterializedSpec[], actor: string): void {
  const workspace = database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string } | undefined;
  if (!workspace) throw new Error("Workspace has not been initialized");
  const now = new Date().toISOString();
  database.transaction(() => {
    for (const item of specs) {
      const featureId = `feature:${item.featureKey}`;
      const specId = `spec:${item.key}`;
      database.prepare("INSERT OR IGNORE INTO features (id, workspace_id, canonical_key, display_name, state) VALUES (?, ?, ?, ?, 'ACTIVE')").run(featureId, workspace.id, item.featureKey, item.displayName);
      database.prepare("INSERT OR IGNORE INTO specs (id, feature_id, key, state) VALUES (?, ?, ?, 'ACTIVE')").run(specId, featureId, item.key);
      const revisionId = `spec-revision:${specId}:${JSON.stringify(item.value)}`;
      database.prepare("INSERT OR IGNORE INTO spec_revisions (id, spec_id, value_json, validity_json, lifecycle, confidence, created_at) VALUES (?, ?, ?, '{}', 'APPROVED', ?, ?)").run(revisionId, specId, JSON.stringify(item.value), item.confidence, now);
      database.prepare("INSERT OR IGNORE INTO events (id, occurred_at, actor, operation, entity_type, entity_id, evidence_ids_json, reason, payload_json) VALUES (?, ?, ?, 'spec.materialize', 'spec', ?, ?, 'deterministic evidence materialization', ?)").run(`event:materialize:${specId}:${item.evidenceIds.join(",")}`, now, actor, specId, JSON.stringify(item.evidenceIds), JSON.stringify({ featureId }));
    }
  })();
}

export interface PersistedFinding { id: string; type: string; featureKey: string; explanation: unknown; }
export function persistFindings(database: Database.Database, findings: readonly PersistedFinding[]): void {
  for (const finding of findings) {
    const feature = database.prepare("SELECT id FROM features WHERE canonical_key = ? LIMIT 1").get(finding.featureKey) as { id: string } | undefined;
    database.prepare("INSERT OR REPLACE INTO findings (id, feature_id, type, severity, state, explanation_json, created_at) VALUES (?, ?, ?, 'warning', 'OPEN', ?, ?)")
      .run(finding.id, feature?.id ?? null, finding.type, JSON.stringify(finding.explanation), new Date().toISOString());
  }
}

export function commitProposal(database: Database.Database, proposal: unknown, policy: MutationPolicy): MutationProposal {
  const accepted = validateMutation(proposal, policy);
  const count = database.prepare(`SELECT COUNT(*) AS count FROM evidence WHERE id IN (${accepted.evidenceIds.map(() => "?").join(",")})`).get(...accepted.evidenceIds) as { count: number };
  if (count.count !== accepted.evidenceIds.length) throw new Error("Proposal references evidence that does not exist.");
  database.prepare("INSERT INTO events (id, occurred_at, actor, operation, entity_type, entity_id, evidence_ids_json, reason, payload_json) VALUES (?, ?, ?, ?, 'proposal', ?, ?, ?, ?)")
    .run(`event:proposal:${accepted.id}`, new Date().toISOString(), accepted.actor, accepted.operation, accepted.entityId, JSON.stringify(accepted.evidenceIds), accepted.reason, JSON.stringify(accepted.payload));
  return accepted;
}

export function getFeature(database: Database.Database, key: string): unknown {
  return database.prepare("SELECT f.canonical_key, f.display_name, s.id AS spec_id, s.key AS spec_key, sr.value_json, sr.lifecycle, sr.confidence FROM features f LEFT JOIN specs s ON s.feature_id = f.id LEFT JOIN spec_revisions sr ON sr.spec_id = s.id WHERE f.canonical_key = ? ORDER BY sr.created_at DESC").all(key);
}
export function getSpec(database: Database.Database, idOrKey: string): unknown {
  return database.prepare("SELECT s.id, s.key, f.canonical_key AS feature, sr.value_json, sr.lifecycle, sr.confidence, sr.created_at FROM specs s LEFT JOIN features f ON f.id = s.feature_id LEFT JOIN spec_revisions sr ON sr.spec_id = s.id WHERE s.id = ? OR s.key = ? ORDER BY sr.created_at DESC").all(idOrKey, idOrKey);
}
export function getEvidence(database: Database.Database, id: string): unknown {
  return database.prepare("SELECT e.id, e.kind, e.subject, e.predicate, e.value_json, e.provenance_json, b.content_json AS raw_content FROM evidence e JOIN raw_blocks b ON b.id = e.raw_block_id WHERE e.id = ?").get(id);
}
export function listFeatureSpecs(database: Database.Database): { feature: string; displayName: string; key: string; value: string; confidence: number }[] {
  return database.prepare("SELECT f.canonical_key AS feature, f.display_name AS displayName, s.key, sr.value_json AS value, sr.confidence FROM features f JOIN specs s ON s.feature_id = f.id JOIN spec_revisions sr ON sr.spec_id = s.id ORDER BY f.canonical_key, sr.created_at DESC").all() as { feature: string; displayName: string; key: string; value: string; confidence: number }[];
}
