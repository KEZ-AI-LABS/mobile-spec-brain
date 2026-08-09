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
export interface FeatureKeyOptions { ignoredPathPrefixes?: readonly string[]; }

export function deriveFeatureKey(value: { path: string; tags?: readonly string[] }, options: FeatureKeyOptions = {}): string {
  const tag = value.tags?.find((candidate) => candidate.trim().length > 0);
  if (tag) return tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
  const ignored = new Set((options.ignoredPathPrefixes ?? ["api", "v1", "v2", "v3"]).map((prefix) => prefix.toLowerCase()));
  return value.path.split("/").filter(Boolean).find((segment) => !ignored.has(segment.toLowerCase())) ?? "root";
}

/** Mobile/API is a projection. The underlying graph does not need an API-specific schema. */
export function materializeApiSemantics(evidence: readonly Evidence[], options: FeatureKeyOptions = {}): SemanticGraphDelta {
  const entities: SemanticEntity[] = []; const claims: SemanticClaim[] = []; const relations: SemanticRelation[] = [];
  for (const item of evidence.filter((candidate) => candidate.kind === "API_CONTRACT")) {
    const value = item.value as { method: string; path: string; normalizedPath?: string; statusCodes: string[]; tags?: string[] };
    const featureKey = deriveFeatureKey(value, options);
    const featureId = `entity:feature:${featureKey}`; const apiId = `entity:api:${value.method}:${value.normalizedPath ?? value.path}`;
    entities.push({ id: featureId, type: "feature", attributes: { canonicalKey: featureKey, displayName: featureKey }, evidenceIds: [item.id] });
    entities.push({ id: apiId, type: "api_operation", attributes: value, evidenceIds: [item.id] });
    claims.push({ id: `claim:${sha256(`${featureId}:exposes:${apiId}:${item.id}`)}`, subjectId: featureId, predicate: "exposes_api", object: { entityId: apiId }, qualifiers: {}, evidenceIds: [item.id], confidence: item.extractionConfidence, authority: item.authority });
    relations.push({ id: `relation:${sha256(`${featureId}:exposes_api:${apiId}`)}`, fromId: featureId, type: "exposes_api", toId: apiId, evidenceIds: [item.id] });
  }
  return { entities, claims, relations, discoveredConcepts: [] };
}

/** Platform extraction is another graph projection, never a separate specification table. */
export function materializeImplementationSemantics(evidence: readonly Evidence[], options: FeatureKeyOptions = {}): SemanticGraphDelta {
  const entities: SemanticEntity[] = []; const claims: SemanticClaim[] = []; const relations: SemanticRelation[] = [];
  for (const item of evidence.filter((candidate) => candidate.kind === "IMPLEMENTATION")) {
    const value = item.value as { platform: string; method: string; path: string; normalizedPath?: string; evidence: string };
    if (value.method === "UNKNOWN" || !value.normalizedPath) continue;
    const featureKey = deriveFeatureKey({ path: value.path }, options); const featureId = `entity:feature:${featureKey}`;
    const apiId = `entity:api:${value.method}:${value.normalizedPath}`;
    const implementationId = `entity:implementation:${value.platform}:${sha256(`${value.method}:${value.normalizedPath}:${value.evidence}`)}`;
    entities.push({ id: featureId, type: "feature", attributes: { canonicalKey: featureKey, displayName: featureKey }, evidenceIds: [item.id] });
    entities.push({ id: implementationId, type: "platform_implementation", attributes: value, evidenceIds: [item.id] });
    claims.push({ id: `claim:${sha256(`${featureId}:platform_implementation:${implementationId}:${item.id}`)}`, subjectId: featureId, predicate: "platform_implementation", object: { entityId: implementationId, apiEntityId: apiId, platform: value.platform }, qualifiers: {}, evidenceIds: [item.id], confidence: item.extractionConfidence, authority: item.authority });
    relations.push({ id: `relation:${sha256(`${implementationId}:implements:${apiId}`)}`, fromId: implementationId, type: "implements_api", toId: apiId, evidenceIds: [item.id] });
  }
  return { entities, claims, relations, discoveredConcepts: [{ kind: "ENTITY_TYPE", name: "platform_implementation" }, { kind: "PREDICATE", name: "platform_implementation" }, { kind: "RELATION_TYPE", name: "implements_api" }] };
}

export function materializeFigmaSemantics(evidence: readonly Evidence[]): SemanticGraphDelta {
  const entities: SemanticEntity[] = []; const claims: SemanticClaim[] = []; const relations: SemanticRelation[] = [];
  for (const item of evidence.filter((candidate) => candidate.kind === "DESIGN")) {
    const value = item.value as { nodeId: string; name: string };
    const featureKey = value.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
    const featureId = `entity:feature:${featureKey}`; const frameId = `entity:figma_frame:${value.nodeId}`;
    entities.push({ id: featureId, type: "feature", attributes: { canonicalKey: featureKey, displayName: value.name }, evidenceIds: [item.id] });
    entities.push({ id: frameId, type: "figma_frame", attributes: value, evidenceIds: [item.id] });
    claims.push({ id: `claim:${sha256(`${featureId}:has_figma_frame:${frameId}:${item.id}`)}`, subjectId: featureId, predicate: "has_figma_frame", object: { entityId: frameId }, qualifiers: {}, evidenceIds: [item.id], confidence: item.extractionConfidence, authority: item.authority });
    relations.push({ id: `relation:${sha256(`${featureId}:has_figma_frame:${frameId}`)}`, fromId: featureId, type: "has_figma_frame", toId: frameId, evidenceIds: [item.id] });
  }
  return { entities, claims, relations, discoveredConcepts: [{ kind: "ENTITY_TYPE", name: "figma_frame" }, { kind: "PREDICATE", name: "has_figma_frame" }, { kind: "RELATION_TYPE", name: "has_figma_frame" }] };
}

export function materializeNavigationSemantics(evidence: readonly Evidence[]): SemanticGraphDelta {
  const entities: SemanticEntity[] = []; const claims: SemanticClaim[] = []; const relations: SemanticRelation[] = [];
  for (const item of evidence.filter((candidate) => candidate.predicate === "declares_route")) {
    const value = item.value as { route: string; platform: string; evidence: string };
    const featureKey = value.route.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
    const featureId = `entity:feature:${featureKey}`; const routeId = `entity:navigation_route:${value.platform}:${value.route}`;
    entities.push({ id: featureId, type: "feature", attributes: { canonicalKey: featureKey, displayName: featureKey }, evidenceIds: [item.id] });
    entities.push({ id: routeId, type: "navigation_route", attributes: value, evidenceIds: [item.id] });
    claims.push({ id: `claim:${sha256(`${featureId}:has_navigation:${routeId}:${item.id}`)}`, subjectId: featureId, predicate: "has_navigation", object: { entityId: routeId }, qualifiers: {}, evidenceIds: [item.id], confidence: item.extractionConfidence, authority: item.authority });
    relations.push({ id: `relation:${sha256(`${featureId}:has_navigation:${routeId}`)}`, fromId: featureId, type: "has_navigation", toId: routeId, evidenceIds: [item.id] });
  }
  return { entities, claims, relations, discoveredConcepts: [{ kind: "ENTITY_TYPE", name: "navigation_route" }, { kind: "PREDICATE", name: "has_navigation" }, { kind: "RELATION_TYPE", name: "has_navigation" }] };
}
