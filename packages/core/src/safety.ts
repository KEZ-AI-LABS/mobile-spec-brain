export interface SyncSafetyPolicy { maxClaimInvalidation: number; maxSourceChangeRatio: number; }
export interface SyncSafetyInput { changedEntities: number; knownEntities: number; invalidatedClaims: number; }
export function enforceSyncSafety(input: SyncSafetyInput, policy: SyncSafetyPolicy): void {
  const ratio = input.knownEntities === 0 ? 0 : input.changedEntities / input.knownEntities;
  if (input.invalidatedClaims > policy.maxClaimInvalidation) throw new Error(`Circuit breaker: ${input.invalidatedClaims} claims would be invalidated.`);
  if (ratio > policy.maxSourceChangeRatio) throw new Error(`Circuit breaker: source change ratio ${ratio.toFixed(2)} exceeds policy.`);
}
