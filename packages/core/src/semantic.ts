import { z } from "zod";
import { sha256 } from "./hash.js";
import type { Evidence } from "./domain.js";

export const semanticEntitySchema = z.object({ id: z.string().min(1), type: z.string().min(1), attributes: z.record(z.unknown()).default({}), evidenceIds: z.array(z.string()).default([]) });
export const semanticClaimSchema = z.object({ id: z.string().min(1), subjectId: z.string().min(1), predicate: z.string().min(1), object: z.unknown(), qualifiers: z.record(z.unknown()).default({}), evidenceIds: z.array(z.string()).min(1), confidence: z.number().min(0).max(1), authority: z.number().min(0).max(1) });
export const semanticRelationSchema = z.object({ id: z.string().min(1), fromId: z.string().min(1), type: z.string().min(1), toId: z.string().min(1), evidenceIds: z.array(z.string()).min(1) });
export type SemanticEntity = z.infer<typeof semanticEntitySchema>;
export type SemanticClaim = z.infer<typeof semanticClaimSchema>;
export type SemanticRelation = z.infer<typeof semanticRelationSchema>;
export interface DiscoveredConcept { kind: "ENTITY_TYPE" | "PREDICATE" | "RELATION_TYPE"; name: string; }
export interface SemanticGraphDelta { entities: readonly SemanticEntity[]; claims: readonly SemanticClaim[]; relations: readonly SemanticRelation[]; discoveredConcepts: readonly DiscoveredConcept[]; }

/** Mobile/API is a projection. The underlying graph does not need an API-specific schema. */
export function materializeApiSemantics(evidence: readonly Evidence[]): SemanticGraphDelta {
  const entities: SemanticEntity[] = []; const claims: SemanticClaim[] = []; const relations: SemanticRelation[] = [];
  for (const item of evidence.filter((candidate) => candidate.kind === "API_CONTRACT")) {
    const value = item.value as { method: string; path: string; statusCodes: string[] };
    const featureKey = value.path.split("/").filter(Boolean)[0] ?? "root";
    const featureId = `entity:feature:${featureKey}`; const apiId = `entity:api:${value.method}:${value.path}`;
    entities.push({ id: featureId, type: "feature", attributes: { canonicalKey: featureKey, displayName: featureKey }, evidenceIds: [item.id] });
    entities.push({ id: apiId, type: "api_operation", attributes: value, evidenceIds: [item.id] });
    claims.push({ id: `claim:${sha256(`${featureId}:exposes:${apiId}:${item.id}`)}`, subjectId: featureId, predicate: "exposes_api", object: { entityId: apiId }, qualifiers: {}, evidenceIds: [item.id], confidence: item.extractionConfidence, authority: item.authority });
    relations.push({ id: `relation:${sha256(`${featureId}:exposes_api:${apiId}`)}`, fromId: featureId, type: "exposes_api", toId: apiId, evidenceIds: [item.id] });
  }
  return { entities, claims, relations, discoveredConcepts: [] };
}
