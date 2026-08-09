import Database from "better-sqlite3";
import { validateMutation, type ChangeSet, type DomainEvent, type Evidence, type EventStore, type MutationPolicy, type MutationProposal, type RawBlockSnapshot, type SemanticGraphDelta, type SourceDescriptor } from "@mobile-spec-brain/core";
import { z } from "zod";
import { initialMigration } from "./migration.js";

export function openWorkspaceDatabase(path: string): Database.Database {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.exec(initialMigration);
  database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run("001_semantic_graph", new Date().toISOString());
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

export function materializeSemanticGraph(database: Database.Database, graph: SemanticGraphDelta, actor: string): void {
  const workspace = database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string } | undefined;
  if (!workspace) throw new Error("Workspace has not been initialized");
  const now = new Date().toISOString();
  database.transaction(() => {
    for (const concept of graph.discoveredConcepts) database.prepare("INSERT OR IGNORE INTO semantic_concepts (id, kind, canonical_name, state, metadata_json, created_at) VALUES (?, ?, ?, 'DISCOVERED_CONCEPT', '{}', ?)").run(`concept:${concept.kind}:${concept.name}`, concept.kind, concept.name, now);
    for (const entity of graph.entities) {
      database.prepare("INSERT OR IGNORE INTO semantic_entities (id, workspace_id, type, attributes_json, state, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)").run(entity.id, workspace.id, entity.type, JSON.stringify(entity.attributes), now);
      for (const evidenceId of entity.evidenceIds) database.prepare("INSERT OR IGNORE INTO entity_evidence (entity_id, evidence_id) VALUES (?, ?)").run(entity.id, evidenceId);
    }
    for (const claim of graph.claims) {
      database.prepare("INSERT OR IGNORE INTO claims (id, subject_id, predicate, object_json, qualifiers_json, confidence, authority, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)").run(claim.id, claim.subjectId, claim.predicate, JSON.stringify(claim.object), JSON.stringify(claim.qualifiers), claim.confidence, claim.authority, now);
      for (const evidenceId of claim.evidenceIds) database.prepare("INSERT OR IGNORE INTO claim_evidence (claim_id, evidence_id) VALUES (?, ?)").run(claim.id, evidenceId);
    }
    for (const relation of graph.relations) {
      database.prepare("INSERT OR IGNORE INTO semantic_relations (id, from_id, type, to_id, state, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)").run(relation.id, relation.fromId, relation.type, relation.toId, now);
      for (const evidenceId of relation.evidenceIds) database.prepare("INSERT OR IGNORE INTO relation_evidence (relation_id, evidence_id) VALUES (?, ?)").run(relation.id, evidenceId);
    }
    database.prepare("INSERT OR IGNORE INTO events (id, occurred_at, actor, operation, entity_type, entity_id, evidence_ids_json, reason, payload_json) VALUES (?, ?, ?, 'graph.materialize', 'semantic_graph', ?, ?, 'deterministic evidence materialization', ?)").run(`event:graph:${graph.claims.map((claim) => claim.id).join(",")}`, now, actor, "semantic:graph", JSON.stringify(graph.claims.flatMap((claim) => claim.evidenceIds)), JSON.stringify({ entities: graph.entities.length, claims: graph.claims.length, relations: graph.relations.length }));
  })();
}

export interface PersistedFinding { id: string; type: string; featureKey: string; explanation: unknown; }
export function persistFindings(database: Database.Database, findings: readonly PersistedFinding[]): void {
  for (const finding of findings) {
    const subject = database.prepare("SELECT id FROM semantic_entities WHERE id = ?").get(`entity:feature:${finding.featureKey}`) as { id: string } | undefined;
    database.prepare("INSERT OR REPLACE INTO semantic_findings (id, subject_id, type, severity, state, explanation_json, evidence_ids_json, created_at) VALUES (?, ?, ?, 'warning', 'OPEN', ?, '[]', ?)")
      .run(finding.id, subject?.id ?? null, finding.type, JSON.stringify(finding.explanation), new Date().toISOString());
  }
}

export function commitProposal(database: Database.Database, proposal: unknown, policy: MutationPolicy): MutationProposal {
  const accepted = validateMutation(proposal, policy);
  const count = database.prepare(`SELECT COUNT(*) AS count FROM evidence WHERE id IN (${accepted.evidenceIds.map(() => "?").join(",")})`).get(...accepted.evidenceIds) as { count: number };
  if (count.count !== accepted.evidenceIds.length) throw new Error("Proposal references evidence that does not exist.");
  const now = new Date().toISOString();
  database.transaction(() => {
    applySemanticMutation(database, accepted, now);
    database.prepare("INSERT INTO events (id, occurred_at, actor, operation, entity_type, entity_id, evidence_ids_json, reason, payload_json) VALUES (?, ?, ?, ?, 'proposal', ?, ?, ?, ?)")
      .run(`event:proposal:${accepted.id}`, now, accepted.actor, accepted.operation, accepted.entityId, JSON.stringify(accepted.evidenceIds), accepted.reason, JSON.stringify(accepted.payload));
  })();
  return accepted;
}

const entityPayloadSchema = z.object({ type: z.string().min(1), attributes: z.record(z.unknown()).default({}) });
const claimPayloadSchema = z.object({ subjectId: z.string().min(1), predicate: z.string().min(1), object: z.unknown(), qualifiers: z.record(z.unknown()).default({}), confidence: z.number().min(0).max(1).default(1), authority: z.number().min(0).max(1).default(1), supersedesId: z.string().min(1).optional() });
const relationPayloadSchema = z.object({ fromId: z.string().min(1), type: z.string().min(1), toId: z.string().min(1) });
const evidenceAttachPayloadSchema = z.object({ targetKind: z.enum(["entity", "claim", "relation"]), targetId: z.string().min(1) });

/** Apply only the narrow mutation vocabulary after policy and evidence checks succeed. */
function applySemanticMutation(database: Database.Database, proposal: MutationProposal, now: string): void {
  const workspace = database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string } | undefined;
  if (!workspace) throw new Error("Workspace has not been initialized");
  if (proposal.operation === "entity.propose") {
    const payload = entityPayloadSchema.parse(proposal.payload);
    database.prepare("INSERT INTO semantic_entities (id, workspace_id, type, attributes_json, state, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)").run(proposal.entityId, workspace.id, payload.type, JSON.stringify(payload.attributes), now);
    for (const evidenceId of proposal.evidenceIds) database.prepare("INSERT INTO entity_evidence (entity_id, evidence_id) VALUES (?, ?)").run(proposal.entityId, evidenceId);
    registerDiscoveredConcept(database, "ENTITY_TYPE", payload.type, now);
    return;
  }
  if (proposal.operation === "claim.propose" || proposal.operation === "claim.supersede") {
    const payload = claimPayloadSchema.parse(proposal.payload);
    if (proposal.operation === "claim.supersede" && !payload.supersedesId) throw new Error("claim.supersede requires payload.supersedesId");
    database.prepare("INSERT INTO claims (id, subject_id, predicate, object_json, qualifiers_json, confidence, authority, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)").run(proposal.entityId, payload.subjectId, payload.predicate, JSON.stringify(payload.object), JSON.stringify(payload.qualifiers), payload.confidence, payload.authority, now);
    for (const evidenceId of proposal.evidenceIds) database.prepare("INSERT INTO claim_evidence (claim_id, evidence_id) VALUES (?, ?)").run(proposal.entityId, evidenceId);
    if (payload.supersedesId) database.prepare("UPDATE claims SET state = 'SUPERSEDED' WHERE id = ? AND state = 'ACTIVE'").run(payload.supersedesId);
    registerDiscoveredConcept(database, "PREDICATE", payload.predicate, now);
    return;
  }
  if (proposal.operation === "relation.propose") {
    const payload = relationPayloadSchema.parse(proposal.payload);
    database.prepare("INSERT INTO semantic_relations (id, from_id, type, to_id, state, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)").run(proposal.entityId, payload.fromId, payload.type, payload.toId, now);
    for (const evidenceId of proposal.evidenceIds) database.prepare("INSERT INTO relation_evidence (relation_id, evidence_id) VALUES (?, ?)").run(proposal.entityId, evidenceId);
    registerDiscoveredConcept(database, "RELATION_TYPE", payload.type, now);
    return;
  }
  if (proposal.operation === "evidence.attach") {
    const payload = evidenceAttachPayloadSchema.parse(proposal.payload);
    const table = payload.targetKind === "entity" ? "entity_evidence" : payload.targetKind === "claim" ? "claim_evidence" : "relation_evidence";
    const column = payload.targetKind === "entity" ? "entity_id" : payload.targetKind === "claim" ? "claim_id" : "relation_id";
    for (const evidenceId of proposal.evidenceIds) database.prepare(`INSERT OR IGNORE INTO ${table} (${column}, evidence_id) VALUES (?, ?)`).run(payload.targetId, evidenceId);
    return;
  }
  if (proposal.operation === "evidence.invalidate") {
    for (const evidenceId of proposal.evidenceIds) database.prepare("UPDATE evidence SET state = 'INVALIDATED' WHERE id = ? AND state = 'ACTIVE'").run(evidenceId);
  }
}

function registerDiscoveredConcept(database: Database.Database, kind: "ENTITY_TYPE" | "PREDICATE" | "RELATION_TYPE", name: string, now: string): void {
  database.prepare("INSERT OR IGNORE INTO semantic_concepts (id, kind, canonical_name, state, metadata_json, created_at) VALUES (?, ?, ?, 'DISCOVERED_CONCEPT', '{}', ?)").run(`concept:${kind}:${name}`, kind, name, now);
}

export function getFeature(database: Database.Database, key: string): unknown {
  return database.prepare("SELECT e.id, e.type, e.attributes_json, c.id AS claim_id, c.predicate, c.object_json, c.qualifiers_json, c.confidence, c.authority FROM semantic_entities e LEFT JOIN claims c ON c.subject_id = e.id WHERE e.id = ? OR json_extract(e.attributes_json, '$.canonicalKey') = ? ORDER BY c.created_at DESC").all(`entity:feature:${key}`, key);
}
export function getClaim(database: Database.Database, idOrPredicate: string): unknown {
  return database.prepare("SELECT c.id, c.subject_id, c.predicate, c.object_json, c.qualifiers_json, c.confidence, c.authority, c.state, c.created_at FROM claims c WHERE c.id = ? OR c.predicate = ? ORDER BY c.created_at DESC").all(idOrPredicate, idOrPredicate);
}
export function getEvidence(database: Database.Database, id: string): unknown {
  return database.prepare("SELECT e.id, e.kind, e.subject, e.predicate, e.value_json, e.provenance_json, b.content_json AS raw_content FROM evidence e JOIN raw_blocks b ON b.id = e.raw_block_id WHERE e.id = ?").get(id);
}
export function listFeatureClaims(database: Database.Database): { feature: string; displayName: string; predicate: string; object: string; confidence: number }[] {
  return database.prepare("SELECT json_extract(e.attributes_json, '$.canonicalKey') AS feature, coalesce(json_extract(e.attributes_json, '$.displayName'), json_extract(e.attributes_json, '$.canonicalKey')) AS displayName, c.predicate, c.object_json AS object, c.confidence FROM semantic_entities e JOIN claims c ON c.subject_id = e.id WHERE e.type = 'feature' ORDER BY feature, c.created_at DESC").all() as { feature: string; displayName: string; predicate: string; object: string; confidence: number }[];
}
