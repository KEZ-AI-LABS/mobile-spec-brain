import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { sha256, type Evidence, type RawBlockSnapshot } from "@specweave/core";
export * from "./navigation.js";

export interface ApiOperation { method: string; path: string; statusCodes: string[]; evidence: string; }
export interface ImplementationEvidence { platform: "android" | "ios"; method: string; path: string; evidence: string; }
export interface ApiFinding { id: string; type: "IMPLEMENTATION_DRIFT" | "UNKNOWN"; operation: ApiOperation; android?: ImplementationEvidence; ios?: ImplementationEvidence; message: string; }

const methods = new Set(["get", "put", "post", "delete", "patch", "head", "options"]);

export function parseOpenApi(path: string): ApiOperation[] {
  const document = JSON.parse(readFileSync(path, "utf8")) as { paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>> };
  return Object.entries(document.paths ?? {}).flatMap(([route, item]) => Object.entries(item)
    .filter(([method]) => methods.has(method.toLowerCase()))
    .map(([method, operation]) => ({ method: method.toUpperCase(), path: route, statusCodes: Object.keys(operation.responses ?? {}).sort(), evidence: `openapi:${path}#${method.toUpperCase()} ${route}` })));
}

export function openApiSnapshots(sourceId: string, path: string): readonly RawBlockSnapshot[] {
  return parseOpenApi(path).map((operation) => {
    const content = { method: operation.method, path: operation.path, statusCodes: operation.statusCodes };
    const contentHash = sha256(JSON.stringify(content));
    const key = `${operation.method}:${operation.path}`;
    return { id: `block:${sourceId}:${key}` as never, sourceEntityId: `entity:${sourceId}:${key}` as never, revision: contentHash, contentHash, content, metadata: { sourcePath: path, kind: "openapi-operation" } };
  });
}

export function extractOpenApiEvidence(sourceId: string, snapshots: readonly RawBlockSnapshot[]): readonly Evidence[] {
  return snapshots.flatMap((snapshot) => {
    const value = snapshot.content as { method: string; path: string; statusCodes: string[] };
    return [{ id: `evidence:${sha256(`${snapshot.id}:contract`)}` as never, kind: "API_CONTRACT" as const, subject: `api.${value.method}.${value.path}`, predicate: "defines", value, extractionConfidence: 1, authority: 1, provenance: { sourceEntityId: snapshot.sourceEntityId, rawBlockId: snapshot.id, revision: snapshot.revision, extractorId: "openapi-deterministic", extractorVersion: "1" } }];
  });
}

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
}

export function scanMobileRepository(root: string, platform: "android" | "ios"): ImplementationEvidence[] {
  const patterns = platform === "android"
    ? /@(GET|POST|PUT|PATCH|DELETE)\s*\(\s*["']([^"']+)["']/g
    : /(?:\.request|\.get|\.post|\.put|\.patch|\.delete)\s*\(\s*(?:path:\s*)?["']([^"']+)["']/g;
  return files(root).filter((file) => /\.(kt|java|swift)$/i.test(file)).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    patterns.lastIndex = 0;
    const found: ImplementationEvidence[] = [];
    for (let match = patterns.exec(source); match; match = patterns.exec(source)) {
      const method = platform === "android" ? match[1]! : "UNKNOWN";
      const path = platform === "android" ? match[2]! : match[1]!;
      found.push({ platform, method: method.toUpperCase(), path: normalizePath(path), evidence: `${platform}:${relative(root, file)}:${source.slice(0, match.index).split("\n").length}` });
    }
    return found;
  });
}

export function mobileSnapshots(sourceId: string, root: string, platform: "android" | "ios"): readonly RawBlockSnapshot[] {
  return scanMobileRepository(root, platform).map((item) => {
    const contentHash = sha256(JSON.stringify(item)); const key = `${item.method}:${item.path}:${item.evidence}`;
    return { id: `block:${sourceId}:${key}` as never, sourceEntityId: `entity:${sourceId}:${key}` as never, revision: contentHash, contentHash, content: item, metadata: { platform, kind: "mobile-api-call" } };
  });
}

export function extractImplementationEvidence(snapshots: readonly RawBlockSnapshot[]): readonly Evidence[] {
  return snapshots.map((snapshot) => {
    const value = snapshot.content as ImplementationEvidence;
    return { id: `evidence:${sha256(`${snapshot.id}:implementation`)}` as never, kind: "IMPLEMENTATION" as const, subject: `api.${value.method}.${value.path}`, predicate: "handles", value, extractionConfidence: 0.95, authority: 0.4, provenance: { sourceEntityId: snapshot.sourceEntityId, rawBlockId: snapshot.id, revision: snapshot.revision, extractorId: "mobile-api-static", extractorVersion: "1" } };
  });
}

export function normalizePath(value: string): string { return `/${value}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/"; }

function matching(operation: ApiOperation, evidence: ImplementationEvidence[]): ImplementationEvidence | undefined {
  return evidence.find((item) => item.path === normalizePath(operation.path) && (item.method === operation.method || item.method === "UNKNOWN"));
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
