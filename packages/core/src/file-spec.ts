import { z } from "zod";
import { sha256 } from "./hash.js";
import { stableStringify } from "./stable-json.js";
import type { FileClaim, FileEvidence } from "./file-protocol.js";

const evidenceIds = z.array(z.string()).default([]);

const unknownSchema = z.object({ field: z.string(), reason: z.string(), evidenceIds });
const apiSchema = z.object({
  method: z.string(),
  path: z.string(),
  parameters: z.array(z.unknown()),
  requestBody: z.unknown(),
  responses: z.record(z.unknown()),
  evidenceIds,
  state: z.string(),
});
const figmaFrameSchema = z.object({ nodeId: z.string(), name: z.string(), evidenceIds, state: z.string() });
const implementationSchema = z.object({
  platform: z.string(),
  status: z.string(),
  location: z.string().optional(),
  evidenceIds,
  state: z.string(),
});
const routeSchema = z.object({
  route: z.string(),
  platform: z.string().optional(),
  evidenceIds,
  state: z.string(),
});

export const fileSpecSchema = z.object({
  version: z.literal(1),
  graphHash: z.string().length(64),
  feature: z.object({ key: z.string(), displayName: z.string(), evidenceIds }),
  completeness: z.object({
    knownFields: z.number(),
    unknownFields: z.number(),
    staleFields: z.number(),
    ratio: z.number(),
  }),
  figmaFrames: z.array(figmaFrameSchema),
  api: z.array(apiSchema),
  implementations: z.array(implementationSchema),
  navigation: z.object({ incoming: z.array(routeSchema), outgoing: z.array(routeSchema) }),
  claims: z.array(z.unknown()),
  evidence: z.array(z.unknown()),
  unknowns: z.array(unknownSchema),
});
export type FileSpec = z.infer<typeof fileSpecSchema>;

/** Projections a rendered spec can be narrowed to. */
export const specSections = ["api", "figma", "implementation", "navigation", "unknowns"] as const;
export type SpecSection = (typeof specSections)[number];

export function isSpecSection(value: string): value is SpecSection {
  return (specSections as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function buildFileSpec(feature: string, claims: FileClaim[], evidence: FileEvidence[]): FileSpec {
  const evidenceState = new Map(evidence.map((item) => [item.id, item.state]));
  const dependsOnInactiveEvidence = (claim: FileClaim): boolean =>
    claim.evidenceIds.some((id) => evidenceState.get(id) !== "ACTIVE");
  const stateOf = (claim: FileClaim): string =>
    claim.state !== "ACTIVE" || dependsOnInactiveEvidence(claim) ? "NEEDS_REVIEW" : "ACTIVE";

  const projected = claims.map((claim) => ({ claim, object: asRecord(claim.object) }));

  const api = projected
    .filter(({ object }) => text(object.method) !== undefined && text(object.path) !== undefined)
    .map(({ claim, object }) => ({
      method: text(object.method)!,
      path: text(object.path)!,
      parameters: Array.isArray(object.parameters) ? object.parameters : [],
      requestBody: object.requestBody ?? { status: "UNKNOWN", reason: "REQUEST_BODY_NOT_DECLARED" },
      responses: asRecord(object.responses),
      evidenceIds: claim.evidenceIds,
      state: stateOf(claim),
    }));

  const figmaFrames = projected
    .filter(({ object }) => text(object.nodeId) !== undefined && text(object.name) !== undefined)
    .map(({ claim, object }) => ({
      nodeId: text(object.nodeId)!,
      name: text(object.name)!,
      evidenceIds: claim.evidenceIds,
      state: stateOf(claim),
    }));

  const implementations = projected
    .filter(({ object }) => text(object.platform) !== undefined && text(object.status) !== undefined)
    .map(({ claim, object }) => ({
      platform: text(object.platform)!,
      status: text(object.status)!,
      location: text(object.location),
      evidenceIds: claim.evidenceIds,
      state: stateOf(claim),
    }));

  const routes = (direction: string) =>
    projected
      .filter(({ object }) => object.direction === direction && text(object.route) !== undefined)
      .map(({ claim, object }) => ({
        route: text(object.route)!,
        platform: text(object.platform),
        evidenceIds: claim.evidenceIds,
        state: stateOf(claim),
      }));

  const displayName = projected.map(({ object }) => text(object.displayName)).find((value) => value !== undefined);

  const unknowns =
    claims.length === 0
      ? [{ field: "claims", reason: "EVIDENCE_ABSENT", evidenceIds: [] }]
      : claims
          .filter((claim) => stateOf(claim) !== "ACTIVE")
          .map((claim) => ({ field: claim.id, reason: claim.state, evidenceIds: claim.evidenceIds }));

  // Completeness is measured over claims, so a single unresolved claim is
  // counted once rather than as both a claim and an unknown.
  const active = claims.filter((claim) => stateOf(claim) === "ACTIVE").length;
  const total = Math.max(claims.length, 1);

  return fileSpecSchema.parse({
    version: 1,
    graphHash: sha256(stableStringify({ claims, evidence })),
    feature: {
      key: feature,
      displayName: displayName ?? feature,
      evidenceIds: [...new Set(claims.flatMap((claim) => claim.evidenceIds))].sort(),
    },
    completeness: {
      knownFields: active,
      unknownFields: total - active,
      staleFields: claims.filter(dependsOnInactiveEvidence).length,
      ratio: active / total,
    },
    figmaFrames,
    api,
    implementations,
    navigation: { incoming: routes("incoming"), outgoing: routes("outgoing") },
    claims,
    evidence,
    unknowns,
  });
}

/**
 * Narrows a spec to one projection. Provenance (feature, completeness,
 * graphHash, claims, evidence) is always retained; the other projections are
 * emptied so a section render is genuinely narrower than the full render.
 */
export function selectSpecSection(spec: FileSpec, section: SpecSection): FileSpec {
  const empty = {
    api: [],
    figmaFrames: [],
    implementations: [],
    navigation: { incoming: [], outgoing: [] },
    unknowns: [],
  } satisfies Pick<FileSpec, "api" | "figmaFrames" | "implementations" | "navigation" | "unknowns">;

  switch (section) {
    case "api":
      return { ...spec, ...empty, api: spec.api };
    case "figma":
      return { ...spec, ...empty, figmaFrames: spec.figmaFrames };
    case "implementation":
      return { ...spec, ...empty, implementations: spec.implementations };
    case "navigation":
      return { ...spec, ...empty, navigation: spec.navigation };
    case "unknowns":
      return { ...spec, ...empty, unknowns: spec.unknowns };
  }
}
