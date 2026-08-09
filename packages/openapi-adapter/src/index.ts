import { readFileSync } from "node:fs";

export interface OpenApiOperation { method: string; path: string; normalizedPath: string; operationId?: string; tags: string[]; deprecated: boolean; parameters: unknown[]; requestBody: unknown; responses: Record<string, unknown>; }
type RecordValue = Record<string, unknown>;
const methods = new Set(["get", "put", "post", "delete", "patch", "head", "options"]);
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function normalizeOpenApiPath(path: string): string { return path.replace(/\{[^}]+\}/g, "{0}"); }
/** Deterministic OpenAPI parser. It deliberately never scans mobile application code. */
export function parseOpenApi(path: string): OpenApiOperation[] {
  const document = record(JSON.parse(readFileSync(path, "utf8"))); const paths = record(document.paths);
  return Object.entries(paths).flatMap(([route, pathItem]) => Object.entries(record(pathItem)).filter(([method]) => methods.has(method.toLowerCase())).map(([method, raw]) => {
    const operation = record(raw); const responses = Object.fromEntries(Object.entries(record(operation.responses)).sort(([a], [b]) => a.localeCompare(b)));
    return { method: method.toUpperCase(), path: route, normalizedPath: normalizeOpenApiPath(route), operationId: typeof operation.operationId === "string" ? operation.operationId : undefined, tags: list(operation.tags).filter((tag): tag is string => typeof tag === "string").sort(), deprecated: operation.deprecated === true, parameters: [...list(record(pathItem).parameters), ...list(operation.parameters)], requestBody: operation.requestBody ?? { status: "UNKNOWN", reason: "REQUEST_BODY_NOT_DECLARED" }, responses };
  })).sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}
