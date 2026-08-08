export interface SyncSafetyPolicy { maxSpecInvalidation: number; maxSourceChangeRatio: number; }
export interface SyncSafetyInput { changedEntities: number; knownEntities: number; invalidatedSpecs: number; }
export function enforceSyncSafety(input: SyncSafetyInput, policy: SyncSafetyPolicy): void {
  const ratio = input.knownEntities === 0 ? 0 : input.changedEntities / input.knownEntities;
  if (input.invalidatedSpecs > policy.maxSpecInvalidation) throw new Error(`Circuit breaker: ${input.invalidatedSpecs} specs would be invalidated.`);
  if (ratio > policy.maxSourceChangeRatio) throw new Error(`Circuit breaker: source change ratio ${ratio.toFixed(2)} exceeds policy.`);
}
