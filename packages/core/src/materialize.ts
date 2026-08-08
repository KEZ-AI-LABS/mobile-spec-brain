import type { Evidence } from "./domain.js";

export interface MaterializedSpec { featureKey: string; displayName: string; key: string; value: unknown; confidence: number; evidenceIds: readonly string[]; }

export function materializeApiSpecs(evidence: readonly Evidence[]): MaterializedSpec[] {
  return evidence.filter((item) => item.kind === "API_CONTRACT").map((item) => {
    const value = item.value as { method: string; path: string };
    const segment = value.path.split("/").filter(Boolean)[0] ?? "root";
    return { featureKey: segment.toLowerCase(), displayName: segment, key: `api.${value.method.toLowerCase()}.${value.path}`, value, confidence: item.extractionConfidence, evidenceIds: [item.id] };
  });
}
