import { z } from "zod";

export const sourceTypeSchema = z.enum(["LOCAL_GIT", "OPENAPI", "FIGMA", "SLACK", "CONFLUENCE", "NOTION"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;
export const sourceIdSchema = z.string().min(1).brand<"SourceId">();
export const entityIdSchema = z.string().min(1).brand<"EntityId">();
export const blockIdSchema = z.string().min(1).brand<"BlockId">();
export const evidenceIdSchema = z.string().min(1).brand<"EvidenceId">();
export const specIdSchema = z.string().min(1).brand<"SpecId">();

export const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ADDED"), entityId: entityIdSchema, revision: z.string().min(1) }),
  z.object({ kind: z.literal("MODIFIED"), entityId: entityIdSchema, revision: z.string().min(1) }),
  z.object({ kind: z.literal("DELETED"), entityId: entityIdSchema, revision: z.string().min(1) }),
]);
export type Change = z.infer<typeof changeSchema>;
export const changeSetSchema = z.object({
  sourceId: sourceIdSchema,
  sourceType: sourceTypeSchema,
  cursor: z.string(),
  changes: z.array(changeSchema),
  fetchedAt: z.coerce.date(),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;

export const rawBlockSnapshotSchema = z.object({
  id: blockIdSchema,
  sourceEntityId: entityIdSchema,
  revision: z.string().min(1),
  contentHash: z.string().length(64),
  content: z.unknown(),
  metadata: z.record(z.unknown()),
});
export type RawBlockSnapshot = z.infer<typeof rawBlockSnapshotSchema>;

export const evidenceKindSchema = z.enum(["OBSERVATION", "DISCUSSION", "QUESTION", "PROPOSAL", "DECISION", "REQUIREMENT", "DESIGN", "API_CONTRACT", "IMPLEMENTATION"]);
export const lifecycleSchema = z.enum(["PROPOSED", "APPROVED", "IMPLEMENTING", "RELEASED", "DEPRECATED", "REMOVED", "UNKNOWN"]);
export const findingTypeSchema = z.enum(["CONFLICT", "IMPLEMENTATION_DRIFT", "DOCUMENTATION_DRIFT", "PENDING_PROPAGATION", "MISSING_IMPLEMENTATION", "MISSING_API", "UNKNOWN"]);

export const provenanceSchema = z.object({
  sourceEntityId: entityIdSchema,
  rawBlockId: blockIdSchema,
  revision: z.string().min(1),
  extractorId: z.string().min(1),
  extractorVersion: z.string().min(1),
  range: z.string().optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const evidenceSchema = z.object({
  id: evidenceIdSchema,
  kind: evidenceKindSchema,
  subject: z.string().min(1),
  predicate: z.string().min(1),
  value: z.unknown(),
  extractionConfidence: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  provenance: provenanceSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const eventSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.coerce.date(),
  actor: z.string().min(1),
  operation: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  evidenceIds: z.array(evidenceIdSchema),
  reason: z.string().min(1),
  payload: z.record(z.unknown()),
});
export type DomainEvent = z.infer<typeof eventSchema>;
