import { z } from "zod";
import { sha256 } from "./hash.js";

const evidenceIds = z.array(z.string().min(1)).min(1);
const unknown = z.object({ field: z.string(), reason: z.enum(["EVIDENCE_ABSENT", "EVIDENCE_CONFLICT", "EXTRACTION_FAILED"]), evidenceIds: z.array(z.string()).default([]) });
const implementation = z.object({ platform: z.enum(["android", "ios"]), status: z.enum(["IMPLEMENTED", "UNKNOWN"]), location: z.string().optional(), returnType: z.string().optional(), evidenceIds: z.array(z.string()).default([]), reason: z.string().optional() });
const api = z.object({ method: z.string(), path: z.string(), normalizedPath: z.string(), operationId: z.string().optional(), summary: z.string().optional(), description: z.string().optional(), deprecated: z.boolean(), parameters: z.array(z.object({ name: z.string(), location: z.string(), required: z.boolean(), schema: z.unknown() })), requestBody: z.unknown(), responses: z.record(z.object({ description: z.string().optional(), schema: z.unknown() })), evidenceIds, implementations: z.array(implementation) });

export const sourceSpecSchema = z.object({
  version: z.literal(1), graphHash: z.string().length(64),
  feature: z.object({ key: z.string(), displayName: z.string(), evidenceIds }),
  completeness: z.object({ knownFields: z.number().int(), unknownFields: z.number().int(), ratio: z.number().min(0).max(1) }),
  figmaFrames: z.array(z.object({ nodeId: z.string(), name: z.string(), evidenceIds })),
  api: z.array(api),
  navigation: z.object({ incoming: z.array(z.object({ route: z.string(), platform: z.string(), evidenceIds })), outgoing: z.array(z.object({ route: z.string(), platform: z.string(), evidenceIds })) }),
  unknowns: z.array(unknown),
});
export type SourceSpec = z.infer<typeof sourceSpecSchema>;
export interface SourceSpecInput { feature: { key: string; displayName: string; evidenceIds: string[] }; figmaFrames: { nodeId: string; name: string; evidenceIds: string[] }[]; api: z.input<typeof api>[]; navigation: { incoming: { route: string; platform: string; evidenceIds: string[] }[]; outgoing: { route: string; platform: string; evidenceIds: string[] }[] }; unknowns: z.input<typeof unknown>[]; graphState: unknown; }

/** A deterministic, read-only development-start view over selected graph claims. */
export function buildSourceSpec(input: SourceSpecInput): SourceSpec {
  const sortedApi = [...input.api].sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
  const sortedUnknowns = [...input.unknowns].sort((left, right) => left.field.localeCompare(right.field));
  const knownFields = 1 + sortedApi.reduce((total, item) => total + 1 + item.parameters.length + Object.keys(item.responses).length + item.implementations.filter((value) => value.status === "IMPLEMENTED").length, 0) + input.figmaFrames.length + input.navigation.incoming.length + input.navigation.outgoing.length;
  const unknownFields = sortedUnknowns.length + sortedApi.reduce((total, item) => total + item.implementations.filter((value) => value.status === "UNKNOWN").length, 0);
  const total = knownFields + unknownFields;
  return sourceSpecSchema.parse({ version: 1, graphHash: sha256(JSON.stringify(input.graphState)), feature: input.feature, completeness: { knownFields, unknownFields, ratio: total === 0 ? 0 : knownFields / total }, figmaFrames: input.figmaFrames, api: sortedApi, navigation: input.navigation, unknowns: sortedUnknowns });
}

export function renderSourceSpecMarkdown(spec: SourceSpec): string {
  return [
    `# ${spec.feature.displayName}`, "", "> Generated source spec. Do not edit directly.", "",
    `- Feature: \`${spec.feature.key}\``, `- Graph state: \`${spec.graphHash}\``, `- Completeness: ${(spec.completeness.ratio * 100).toFixed(1)}% (${spec.completeness.knownFields} known / ${spec.completeness.unknownFields} unknown)`, `- Evidence: ${spec.feature.evidenceIds.map((id) => `\`${id}\``).join(", ")}`, "",
    "## Unresolved before implementation", "", ...(spec.unknowns.length ? spec.unknowns.map((item) => `- \`${item.field}\` — ${item.reason}${item.evidenceIds.length ? ` (${item.evidenceIds.map((id) => `\`${id}\``).join(", ")})` : ""}`) : ["- None."]), "",
    "## API contracts", "", ...spec.api.flatMap((item) => [`### ${item.method} ${item.path}`, "", `- Normalized path: \`${item.normalizedPath}\``, `- Evidence: ${item.evidenceIds.map((id) => `\`${id}\``).join(", ")}`, `- Parameters: \`${JSON.stringify(item.parameters)}\``, `- Request: \`${JSON.stringify(item.requestBody)}\``, `- Responses: \`${JSON.stringify(item.responses)}\``, `- Implementations: ${item.implementations.map((value) => `${value.platform}: ${value.status}${value.location ? ` (${value.location})` : ""}${value.reason ? ` — ${value.reason}` : ""}`).join("; ")}`, ""]),
    "## Navigation", "", ...(spec.navigation.incoming.length || spec.navigation.outgoing.length ? [...spec.navigation.incoming.map((item) => `- Incoming \`${item.route}\` on ${item.platform} (${item.evidenceIds.map((id) => `\`${id}\``).join(", ")})`), ...spec.navigation.outgoing.map((item) => `- Outgoing \`${item.route}\` on ${item.platform} (${item.evidenceIds.map((id) => `\`${id}\``).join(", ")})`)] : ["- UNKNOWN — EVIDENCE_ABSENT"]), "",
  ].join("\n");
}
