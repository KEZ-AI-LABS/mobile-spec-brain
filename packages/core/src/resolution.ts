import type { Evidence } from "./domain.js";

export interface ResolvedSpec {
  state: "RESOLVED" | "UNKNOWN";
  value?: unknown;
  confidence: number;
  supportingEvidence: readonly Evidence[];
  conflictingEvidence: readonly Evidence[];
  reason: string;
}

/** Resolves only a clear authority winner; ties and contradictory high-authority evidence remain UNKNOWN. */
export function resolveEvidence(evidence: readonly Evidence[]): ResolvedSpec {
  if (evidence.length === 0) return { state: "UNKNOWN", confidence: 0, supportingEvidence: [], conflictingEvidence: [], reason: "No evidence is available." };
  const ranked = [...evidence].sort((a, b) => b.authority - a.authority || b.extractionConfidence - a.extractionConfidence);
  const winner = ranked[0]!;
  const sameAuthority = ranked.filter((item) => item.authority === winner.authority);
  const conflicts = sameAuthority.filter((item) => JSON.stringify(item.value) !== JSON.stringify(winner.value));
  if (conflicts.length > 0) return { state: "UNKNOWN", confidence: winner.extractionConfidence, supportingEvidence: [winner], conflictingEvidence: conflicts, reason: "Highest-authority evidence conflicts." };
  return { state: "RESOLVED", value: winner.value, confidence: winner.extractionConfidence, supportingEvidence: ranked.filter((item) => JSON.stringify(item.value) === JSON.stringify(winner.value)), conflictingEvidence: ranked.filter((item) => JSON.stringify(item.value) !== JSON.stringify(winner.value)), reason: "Highest-authority evidence has a unique value." };
}
