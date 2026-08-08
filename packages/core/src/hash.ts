import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ExtractionCacheInput {
  contentHash: string;
  extractorId: string;
  extractorVersion: string;
  schemaVersion: string;
  promptVersion: string;
  modelVersion: string;
}

export function extractionCacheKey(input: ExtractionCacheInput): string {
  return sha256(Object.values(input).join("\u0000"));
}
