import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { sha256, type Evidence, type RawBlockSnapshot } from "@mobile-spec-brain/core";

export * from "./navigation.js";

export interface ApiParameter {
  name: string;
  location: "path" | "query" | "header";
  required: boolean;
  schema: unknown;
}

export interface ApiResponse {
  description?: string;
  schema: unknown;
}

export interface ApiOperation {
  method: string;
  path: string;
  normalizedPath: string;
  statusCodes: string[];
  parameters: ApiParameter[];
  requestBody: unknown;
  responses: Record<string, ApiResponse>;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  evidence: string;
}

export interface ImplementationBinding {
  name: string;
  location: "path" | "query" | "body";
}

export interface ImplementationEvidence {
  platform: "android" | "ios";
  method: string;
  path: string;
  normalizedPath: string;
  bindings: ImplementationBinding[];
  returnType: string;
  evidence: string;
}

export interface ApiFinding {
  id: string;
  type: "IMPLEMENTATION_DRIFT" | "UNKNOWN";
  operation: ApiOperation;
  android?: ImplementationEvidence;
  ios?: ImplementationEvidence;
  message: string;
}

type JsonRecord = Record<string, unknown>;
const methods = new Set(["get", "put", "post", "delete", "patch", "head", "options"]);

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function resolveReferences(value: unknown, root: JsonRecord, stack: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, root, stack));
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return value;
  if (typeof record.$ref === "string") {
    const reference = record.$ref;
    if (!reference.startsWith("#/")) return { status: "UNKNOWN", reason: "UNRESOLVABLE_REF", ref: reference };
    if (stack.includes(reference)) return { status: "UNKNOWN", reason: "CIRCULAR_REF", ref: reference };
    const target = reference.slice(2).split("/").reduce<unknown>((current, segment) => asRecord(current)[segment], root);
    if (target === undefined) return { status: "UNKNOWN", reason: "UNRESOLVABLE_REF", ref: reference };
    return resolveReferences(target, root, [...stack, reference]);
  }
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, resolveReferences(nested, root, stack)]));
}

function contentSchema(content: unknown, root: JsonRecord): unknown {
  const json = asRecord(asRecord(content)["application/json"]);
  return json.schema === undefined ? { status: "UNKNOWN", reason: "SCHEMA_NOT_DECLARED" } : resolveReferences(json.schema, root);
}

function operationParameters(pathParameters: unknown, operationParametersValue: unknown, root: JsonRecord): ApiParameter[] {
  return [...(Array.isArray(pathParameters) ? pathParameters : []), ...(Array.isArray(operationParametersValue) ? operationParametersValue : [])]
    .map((value) => asRecord(resolveReferences(value, root)))
    .filter((parameter) => parameter.in === "path" || parameter.in === "query" || parameter.in === "header")
    .map((parameter) => ({
      name: typeof parameter.name === "string" ? parameter.name : "UNKNOWN",
      location: parameter.in as ApiParameter["location"],
      required: parameter.required === true,
      schema: parameter.schema === undefined ? { status: "UNKNOWN", reason: "SCHEMA_NOT_DECLARED" } : resolveReferences(parameter.schema, root),
    }));
}

export function parseOpenApi(path: string): ApiOperation[] {
  const document = asRecord(JSON.parse(readFileSync(path, "utf8")));
  const paths = asRecord(document.paths);
  return Object.entries(paths).flatMap(([route, pathItem]) => {
    const item = asRecord(pathItem);
    return Object.entries(item)
      .filter(([method]) => methods.has(method.toLowerCase()))
      .map(([method, operationValue]) => {
        const operation = asRecord(operationValue);
        const responses = Object.fromEntries(Object.entries(asRecord(operation.responses)).map(([status, responseValue]) => {
          const response = asRecord(resolveReferences(responseValue, document));
          return [status, { description: typeof response.description === "string" ? response.description : undefined, schema: contentSchema(response.content, document) }];
        }));
        return {
          method: method.toUpperCase(),
          path: route,
          normalizedPath: normalizePath(route),
          statusCodes: Object.keys(responses).sort(),
          parameters: operationParameters(item.parameters, operation.parameters, document),
          requestBody: operation.requestBody === undefined ? { status: "UNKNOWN", reason: "REQUEST_BODY_NOT_DECLARED" } : contentSchema(asRecord(resolveReferences(operation.requestBody, document)).content, document),
          responses,
          operationId: typeof operation.operationId === "string" ? operation.operationId : undefined,
          summary: typeof operation.summary === "string" ? operation.summary : undefined,
          description: typeof operation.description === "string" ? operation.description : undefined,
          tags: Array.isArray(operation.tags) ? operation.tags.filter((tag): tag is string => typeof tag === "string") : [],
          deprecated: operation.deprecated === true,
          evidence: `openapi:${path}#${method.toUpperCase()} ${route}`,
        };
      });
  });
}

export function openApiSnapshots(sourceId: string, path: string): readonly RawBlockSnapshot[] {
  return parseOpenApi(path).map((operation) => {
    const contentHash = sha256(JSON.stringify(operation));
    const key = `${operation.method}:${operation.path}`;
    return { id: `block:${sourceId}:${key}` as never, sourceEntityId: `entity:${sourceId}:${key}` as never, revision: contentHash, contentHash, content: operation, metadata: { sourcePath: path, kind: "openapi-operation" } };
  });
}

export function extractOpenApiEvidence(sourceId: string, snapshots: readonly RawBlockSnapshot[]): readonly Evidence[] {
  return snapshots.map((snapshot) => {
    const value = snapshot.content as ApiOperation;
    return { id: `evidence:${sha256(`${snapshot.id}:contract`)}` as never, kind: "API_CONTRACT" as const, subject: `api.${value.method}.${value.normalizedPath}`, predicate: "defines", value, extractionConfidence: 1, authority: 1, provenance: { sourceEntityId: snapshot.sourceEntityId, rawBlockId: snapshot.id, revision: snapshot.revision, extractorId: "openapi-deterministic", extractorVersion: "2" } };
  });
}

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function kotlinConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const matcher = /(?:const\s+val|val)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([^"']+)["']/g;
  for (let match = matcher.exec(source); match; match = matcher.exec(source)) constants.set(match[1]!, match[2]!);
  return constants;
}

function balancedSegment(source: string, start: number): { value: string; end: number } | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; continue; }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return { value: source.slice(start + 1, index), end: index + 1 };
    }
  }
  return undefined;
}

function kotlinBindings(signature: string): ImplementationBinding[] {
  const bindings: ImplementationBinding[] = [];
  const matcher = /@(Path|Query|Body)\s*(?:\(\s*["']([^"']+)["']\s*\))?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  for (let match = matcher.exec(signature); match; match = matcher.exec(signature)) {
    const kind = match[1]!.toLowerCase() as ImplementationBinding["location"];
    bindings.push({ name: match[2] ?? match[3]!, location: kind });
  }
  return bindings;
}

function scanKotlin(root: string): ImplementationEvidence[] {
  return files(root).filter((file) => /\.kt$/i.test(file)).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const constants = kotlinConstants(source);
    const annotations = /@(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
    const result: ImplementationEvidence[] = [];
    for (let match = annotations.exec(source); match; match = annotations.exec(source)) {
      const segment = balancedSegment(source, annotations.lastIndex - 1);
      if (!segment) continue;
      const expression = segment.value.trim();
      const literal = /^["']([^"']+)["']/.exec(expression)?.[1];
      const path = literal ?? constants.get(expression.replace(/\s/g, ""));
      const declarationStart = segment.end + (source.slice(segment.end).match(/^\s*/)?.[0].length ?? 0);
      const declarationEnd = source.indexOf("\n", declarationStart);
      const declaration = source.slice(declarationStart, declarationEnd >= 0 ? declarationEnd : source.length);
      const returnType = /\)\s*:\s*([^=\n{]+)/.exec(declaration)?.[1]?.trim() ?? "UNKNOWN";
      if (!path) {
        result.push({ platform: "android", method: match[1]!, path: "UNKNOWN", normalizedPath: "UNKNOWN", bindings: kotlinBindings(declaration), returnType, evidence: `android:${relative(root, file)}:${lineAt(source, match.index)}` });
        continue;
      }
      result.push({ platform: "android", method: match[1]!, path: normalizePath(path), normalizedPath: normalizePath(path), bindings: kotlinBindings(declaration), returnType, evidence: `android:${relative(root, file)}:${lineAt(source, match.index)}` });
    }
    return result;
  });
}

function scanSwift(root: string): ImplementationEvidence[] {
  return files(root).filter((file) => /\.swift$/i.test(file)).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const matcher = /\.(get|post|put|patch|delete|request)\s*\(\s*(?:path:\s*)?["']([^"']+)["']/gi;
    const result: ImplementationEvidence[] = [];
    for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
      const invocation = source.slice(match.index, source.indexOf("\n", match.index) + 1 || source.length);
      const requestMethod = /method\s*:\s*\.?([A-Za-z]+)/.exec(invocation)?.[1]?.toUpperCase();
      const calledMethod = match[1]!.toUpperCase();
      const method = calledMethod === "REQUEST" ? requestMethod ?? "UNKNOWN" : calledMethod;
      result.push({ platform: "ios", method, path: normalizePath(match[2]!), normalizedPath: normalizePath(match[2]!), bindings: [], returnType: "UNKNOWN", evidence: `ios:${relative(root, file)}:${lineAt(source, match.index)}` });
    }
    return result;
  });
}

export function scanMobileRepository(root: string, platform: "android" | "ios"): ImplementationEvidence[] {
  return platform === "android" ? scanKotlin(root) : scanSwift(root);
}

export function mobileSnapshots(sourceId: string, root: string, platform: "android" | "ios"): readonly RawBlockSnapshot[] {
  return scanMobileRepository(root, platform).map((item) => {
    const contentHash = sha256(JSON.stringify(item));
    const key = `${item.method}:${item.normalizedPath}:${item.evidence}`;
    return { id: `block:${sourceId}:${key}` as never, sourceEntityId: `entity:${sourceId}:${key}` as never, revision: contentHash, contentHash, content: item, metadata: { platform, kind: "mobile-api-call" } };
  });
}

export function extractImplementationEvidence(snapshots: readonly RawBlockSnapshot[]): readonly Evidence[] {
  return snapshots.map((snapshot) => {
    const value = snapshot.content as ImplementationEvidence;
    return { id: `evidence:${sha256(`${snapshot.id}:implementation`)}` as never, kind: "IMPLEMENTATION" as const, subject: `api.${value.method}.${value.normalizedPath}`, predicate: "handles", value, extractionConfidence: value.method === "UNKNOWN" || value.normalizedPath === "UNKNOWN" ? 0.4 : 0.95, authority: 0.4, provenance: { sourceEntityId: snapshot.sourceEntityId, rawBlockId: snapshot.id, revision: snapshot.revision, extractorId: "mobile-api-static", extractorVersion: "2", range: value.evidence } };
  });
}

export function normalizePath(value: string): string {
  const normalized = `/${value}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  let index = 0;
  return normalized.replace(/\{[^}]+\}/g, () => `{${index++}}`);
}

function matching(operation: ApiOperation, evidence: ImplementationEvidence[]): ImplementationEvidence | undefined {
  return evidence.find((item) => item.normalizedPath === operation.normalizedPath && item.method === operation.method);
}

export function checkApiParity(operations: ApiOperation[], android: ImplementationEvidence[], ios: ImplementationEvidence[]): ApiFinding[] {
  return operations.flatMap((operation) => {
    const androidEvidence = matching(operation, android);
    const iosEvidence = matching(operation, ios);
    if (androidEvidence && iosEvidence) return [];
    const missing = [!androidEvidence && "Android", !iosEvidence && "iOS"].filter(Boolean).join(" and ");
    return [{ id: `API-${operation.method}-${operation.path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, type: "UNKNOWN", operation, android: androidEvidence, ios: iosEvidence, message: `${missing} implementation evidence was not found. This is UNKNOWN, not a missing-implementation claim.` }];
  });
}
