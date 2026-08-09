import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileClaimSchema, fileEvidenceSchema, profileSchema, sha256, sourceSchema, type FileClaim, type FileEvidence, type ProjectProfile } from "@mobile-spec-brain/core";

const directoryName = ".spec-brain";
export function specBrainDirectory(projectRoot: string): string { return join(projectRoot, directoryName); }

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, normalize(nested)]));
  return value;
}
export function stableJson(value: unknown): string { return `${JSON.stringify(normalize(value), null, 2)}\n`; }
function writeAtomic(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`; writeFileSync(temporary, stableJson(value)); renameSync(temporary, path); }
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }
function jsonFiles(directory: string): string[] { return existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? jsonFiles(join(directory, entry.name)) : entry.name.endsWith(".json") ? [join(directory, entry.name)] : []) : []; }
function sourceMap(root: string): Map<string, { id: string; root: string; type: string }> { const sources = readJson(join(root, "sources.json")); return new Map((Array.isArray(sources) ? sources : []).map((source) => { const parsed = sourceSchema.parse(source); return [parsed.id, parsed]; })); }

export function initializeFileStore(projectRoot: string): string {
  const root = specBrainDirectory(projectRoot); mkdirSync(join(root, "evidence"), { recursive: true }); mkdirSync(join(root, "claims"), { recursive: true }); mkdirSync(join(root, "events"), { recursive: true }); mkdirSync(join(root, ".index"), { recursive: true });
  if (!existsSync(join(root, "sources.json"))) writeAtomic(join(root, "sources.json"), []);
  if (!existsSync(join(root, "concepts.json"))) writeAtomic(join(root, "concepts.json"), []);
  if (!existsSync(join(root, "profile.json"))) writeAtomic(join(root, "profile.json"), { status: "PROPOSED", entries: [], updatedAt: new Date().toISOString() });
  return root;
}

export function appendFileEvent(root: string, actor: string, operation: string, payload: unknown): string {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`; writeAtomic(join(root, "events", `${id}.json`), { id, actor, operation, payload, occurredAt: new Date().toISOString() }); return id;
}

export function readProfile(root: string): ProjectProfile { return profileSchema.parse(readJson(join(root, "profile.json"))); }
export function proposeProfile(root: string, profile: Omit<ProjectProfile, "status" | "updatedAt">, actor: string): ProjectProfile { const next = profileSchema.parse({ ...profile, status: "PROPOSED", updatedAt: new Date().toISOString() }); writeAtomic(join(root, "profile.json"), next); appendFileEvent(root, actor, "profile.propose", { profile: next }); return next; }

export interface EvidenceRecordInput { citation: { sourceId: string; path: string; range: [number, number]; contentHash: string; revision: string }; kind: string; observation: Record<string, unknown>; extractor: { id: string; version: string; model?: string; promptVersion?: string }; confidence: number; authority: number; }
function citedContent(root: string, citation: EvidenceRecordInput["citation"]): { content?: string; reason?: "ORPHANED" | "STALE" } {
  const source = sourceMap(root).get(citation.sourceId); if (!source) return { reason: "ORPHANED" };
  const target = resolve(source.root, citation.path); if (!target.startsWith(resolve(source.root))) throw new Error("Citation path escapes its source root.");
  if (!existsSync(target)) return { reason: "ORPHANED" };
  const lines = readFileSync(target, "utf8").split("\n"); if (citation.range[0] < 1 || citation.range[1] > lines.length) throw new Error(`Citation range ${citation.range.join("-")} is outside ${citation.path}.`);
  return { content: lines.slice(citation.range[0] - 1, citation.range[1]).join("\n") };
}
export function recordEvidence(root: string, input: EvidenceRecordInput, actor: string): FileEvidence {
  if (readProfile(root).status !== "APPROVED") throw new Error("Profile must be APPROVED before recording evidence.");
  const cited = citedContent(root, input.citation); if (!cited.content) throw new Error(`Citation cannot be verified: ${cited.reason}.`);
  const actualHash = `sha256:${sha256(cited.content)}`; if (actualHash !== input.citation.contentHash) throw new Error(`Citation content hash mismatch. Expected ${input.citation.contentHash}, actual ${actualHash}.`);
  const id = `ev_${sha256(stableJson(input.citation))}`; const record = fileEvidenceSchema.parse({ id, ...input, state: "ACTIVE", recordedAt: new Date().toISOString() });
  const path = join(root, "evidence", id.slice(3, 5), `${id}.json`); if (!existsSync(path)) { writeAtomic(path, record); const concepts = readJson(join(root, "concepts.json")) as unknown[]; if (!concepts.some((value) => (value as { name?: string }).name === input.kind)) writeAtomic(join(root, "concepts.json"), [...concepts, { kind: "DISCOVERED_CONCEPT", name: input.kind }]); appendFileEvent(root, actor, "evidence.record", { id }); }
  return record;
}

export function evidenceRecords(root: string): FileEvidence[] { return jsonFiles(join(root, "evidence")).map((path) => fileEvidenceSchema.parse(readJson(path))).sort((left, right) => left.id.localeCompare(right.id)); }
export function claimRecords(root: string): FileClaim[] { return jsonFiles(join(root, "claims")).map((path) => fileClaimSchema.parse(readJson(path))).sort((left, right) => left.id.localeCompare(right.id)); }
export function writeClaim(root: string, claim: FileClaim, actor: string): FileClaim { const evidence = new Set(evidenceRecords(root).map((item) => item.id)); if (!claim.evidenceIds.every((id) => evidence.has(id))) throw new Error("Claim references evidence that does not exist."); const parsed = fileClaimSchema.parse(claim); writeAtomic(join(root, "claims", parsed.feature, `${parsed.id}.json`), parsed); appendFileEvent(root, actor, "claim.propose", { id: parsed.id }); return parsed; }

export function verifyFileStore(root: string, actor: string): { stale: string[]; orphaned: string[]; claimsNeedingReview: string[] } {
  const stale: string[] = []; const orphaned: string[] = []; const invalid = new Set<string>();
  for (const evidence of evidenceRecords(root)) { const cited = citedContent(root, evidence.citation); const state = !cited.content ? "ORPHANED" : `sha256:${sha256(cited.content)}` === evidence.citation.contentHash ? "ACTIVE" : "STALE"; if (state === evidence.state) continue; const next = { ...evidence, state }; writeAtomic(join(root, "evidence", evidence.id.slice(3, 5), `${evidence.id}.json`), next); invalid.add(evidence.id); if (state === "STALE") stale.push(evidence.id); if (state === "ORPHANED") orphaned.push(evidence.id); }
  const claimsNeedingReview: string[] = []; for (const claim of claimRecords(root)) if (claim.state === "ACTIVE" && claim.evidenceIds.some((id) => invalid.has(id))) { writeAtomic(join(root, "claims", claim.feature, `${claim.id}.json`), { ...claim, state: "NEEDS_REVIEW" }); claimsNeedingReview.push(claim.id); }
  appendFileEvent(root, actor, "verify", { stale, orphaned, claimsNeedingReview }); return { stale, orphaned, claimsNeedingReview };
}

export function reindexFileStore(root: string): { evidence: number; claims: number } { const index = join(root, ".index"); rmSync(index, { recursive: true, force: true }); mkdirSync(index, { recursive: true }); const database = new Database(join(index, "workspace.sqlite")); database.exec("CREATE TABLE evidence (id TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE claims (id TEXT PRIMARY KEY, feature TEXT NOT NULL, state TEXT NOT NULL);"); for (const evidence of evidenceRecords(root)) database.prepare("INSERT INTO evidence VALUES (?, ?)").run(evidence.id, evidence.state); for (const claim of claimRecords(root)) database.prepare("INSERT INTO claims VALUES (?, ?, ?)").run(claim.id, claim.feature, claim.state); database.close(); return { evidence: evidenceRecords(root).length, claims: claimRecords(root).length }; }
export function coverage(root: string): unknown { const evidence = evidenceRecords(root); const claims = claimRecords(root); return { sources: sourceMap(root).size, evidence: { total: evidence.length, active: evidence.filter((item) => item.state === "ACTIVE").length, stale: evidence.filter((item) => item.state === "STALE").length }, claims: { total: claims.length, needsReview: claims.filter((item) => item.state === "NEEDS_REVIEW").length } }; }
export function sourceRootFor(projectRoot: string): string { return relative(projectRoot, projectRoot) || "."; }
