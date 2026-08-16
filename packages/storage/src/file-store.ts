import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  analysisBundleSchema,
  citationSchema,
  featureCoverageRecordSchema,
  fileClaimSchema,
  fileEvidenceSchema,
  profileSchema,
  sha256,
  sourceSchema,
  stableJson,
  stableStringify,
  type AnalysisBundle,
  type Citation,
  type FeatureCoverageRecord,
  type FileClaim,
  type FileEvidence,
  type ProjectProfile,
  type Source,
} from "@mobile-spec-brain/core";

export { stableJson } from "@mobile-spec-brain/core";

const DIRECTORY_NAME = ".spec-brain";

export function specBrainDirectory(projectRoot: string): string {
  return join(projectRoot, DIRECTORY_NAME);
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, stableJson(value));
  renameSync(temporary, path);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return jsonFiles(join(directory, entry.name));
    return entry.isFile() && entry.name.endsWith(".json") ? [join(directory, entry.name)] : [];
  });
}

function loadSources(root: string): Map<string, Source> {
  const raw = readJson(join(root, "sources.json")) as unknown[];
  return new Map(raw.map((item) => sourceSchema.parse(item)).map((source) => [source.id, source]));
}

function sourceDirectory(brainRoot: string, source: Source): string {
  return isAbsolute(source.root) ? source.root : resolve(brainRoot, source.root);
}

type PathResolution = { status: "OK"; path: string } | { status: "MISSING" } | { status: "ESCAPES" };

function contains(base: string, target: string): boolean {
  return target === base || target.startsWith(`${base}${sep}`);
}

/**
 * Resolves a source-relative path, rejecting anything that leaves the source
 * root either lexically (`..`) or through a symbolic link.
 */
function resolveWithinSource(sourceRoot: string, relativePath: string): PathResolution {
  if (!existsSync(sourceRoot)) return { status: "MISSING" };
  const base = realpathSync(sourceRoot);
  const target = resolve(base, relativePath);
  if (!contains(base, target)) return { status: "ESCAPES" };
  if (!existsSync(target)) return { status: "MISSING" };
  const real = realpathSync(target);
  return contains(base, real) ? { status: "OK", path: real } : { status: "ESCAPES" };
}

export function initializeFileStore(projectRoot: string): string {
  const root = specBrainDirectory(projectRoot);
  for (const path of ["evidence", "claims", "events", "analyses", "features", "spec"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  if (!existsSync(join(root, "sources.json"))) writeAtomic(join(root, "sources.json"), []);
  if (!existsSync(join(root, "concepts.json"))) writeAtomic(join(root, "concepts.json"), []);
  if (!existsSync(join(root, "profile.json"))) {
    writeAtomic(join(root, "profile.json"), {
      status: "PROPOSED",
      entries: [],
      updatedAt: new Date().toISOString(),
    });
  }
  return root;
}

export function appendFileEvent(root: string, actor: string, operation: string, payload: unknown): string {
  const occurredAt = new Date().toISOString();
  const id = `${occurredAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  writeAtomic(join(root, "events", `${id}.json`), { actor, id, occurredAt, operation, payload });
  return id;
}

export function readProfile(root: string): ProjectProfile {
  return profileSchema.parse(readJson(join(root, "profile.json")));
}

function requireApprovedProfile(root: string, action: string): void {
  if (readProfile(root).status !== "APPROVED") {
    throw new Error(`Profile must be APPROVED before ${action}. Review and approve .spec-brain/profile.json first.`);
  }
}

type CitedContent = { content: string } | { reason: "ORPHANED" };

/**
 * The single place a cited line range is turned into text. `cite` and
 * verification both go through here, so a citation this store produces can
 * never fail the hash check this store applies to it.
 */
function readCitedRange(
  sources: Map<string, Source>,
  root: string,
  sourceId: string,
  path: string,
  range: readonly [number, number],
): CitedContent {
  const source = sources.get(sourceId);
  if (!source) return { reason: "ORPHANED" };

  const resolved = resolveWithinSource(sourceDirectory(root, source), path);
  if (resolved.status === "ESCAPES") {
    throw new Error(`Citation path '${path}' escapes source root '${sourceId}'.`);
  }
  if (resolved.status === "MISSING") return { reason: "ORPHANED" };

  const lines = readFileSync(resolved.path, "utf8").split("\n");
  const [start, end] = range;
  if (end > lines.length) {
    throw new Error(`Citation range ${start}-${end} is outside ${path} (${lines.length} lines).`);
  }
  return { content: lines.slice(start - 1, end).join("\n") };
}

function citedContent(sources: Map<string, Source>, root: string, candidate: Citation): CitedContent {
  const citation = citationSchema.parse(candidate);
  return readCitedRange(sources, root, citation.sourceId, citation.path, citation.range);
}

export interface CitationRequest {
  path: string;
  range: [number, number];
  sourceId?: string;
  revision?: string;
}

/**
 * Counts real lines. Splitting on "\n" leaves a trailing empty element for the
 * usual file that ends with a newline; that element is not a line anyone can
 * point at in an editor, so `cite` must not hand out a citation for it.
 */
function countLines(sources: Map<string, Source>, root: string, sourceId: string, path: string): number | undefined {
  const source = sources.get(sourceId);
  if (!source) return undefined;
  const resolved = resolveWithinSource(sourceDirectory(root, source), path);
  if (resolved.status === "ESCAPES") throw new Error(`Citation path '${path}' escapes source root '${sourceId}'.`);
  if (resolved.status === "MISSING") return undefined;

  const lines = readFileSync(resolved.path, "utf8").split("\n");
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

/**
 * Reads the git revision of a source root. The revision is provenance
 * metadata; the content hash is what verification actually checks, so a
 * repository without git falls back to "local" rather than failing.
 */
export function detectRevision(root: string, sourceId = "project"): string {
  const source = loadSources(root).get(sourceId);
  if (!source) return "local";
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: sourceDirectory(root, source),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "local";
  }
}

/** Produces a verified citation for a line range. */
export function buildCitation(root: string, request: CitationRequest): Citation {
  const sourceId = request.sourceId ?? "project";
  const [start, end] = request.range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    throw new Error(`Citation range ${start}-${end} must be positive integer line numbers.`);
  }
  if (start > end) throw new Error(`Citation range ${start}-${end} must be ordered.`);

  const sources = loadSources(root);
  if (!sources.has(sourceId)) throw new Error(`Unknown source '${sourceId}'.`);

  const lineCount = countLines(sources, root, sourceId, request.path);
  if (lineCount === undefined) {
    throw new Error(`Cannot cite ${request.path}: the file does not exist under source '${sourceId}'.`);
  }
  if (end > lineCount) {
    throw new Error(`Citation range ${start}-${end} is outside ${request.path} (${lineCount} lines).`);
  }

  const cited = readCitedRange(sources, root, sourceId, request.path, [start, end]);
  if (!("content" in cited)) {
    throw new Error(`Cannot cite ${request.path}: the file does not exist under source '${sourceId}'.`);
  }

  return citationSchema.parse({
    sourceId,
    path: request.path,
    range: [start, end],
    contentHash: `sha256:${sha256(cited.content)}`,
    revision: request.revision ?? detectRevision(root, sourceId),
  });
}

function validateCitationWith(sources: Map<string, Source>, root: string, citation: Citation): void {
  const cited = citedContent(sources, root, citation);
  if (!("content" in cited)) {
    throw new Error(`Citation cannot be verified: ${cited.reason}.`);
  }
  const actual = `sha256:${sha256(cited.content)}`;
  if (actual !== citation.contentHash) {
    // The cited content is deliberately not echoed: it may hold secrets and
    // this message reaches stdout, CI logs, and agent transcripts.
    throw new Error(
      `Citation content hash mismatch for ${citation.path}:${citation.range.join("-")}. ` +
        `Expected ${citation.contentHash}, actual ${actual}.`,
    );
  }
}

export function validateCitation(root: string, citation: Citation): void {
  validateCitationWith(loadSources(root), root, citation);
}

export function proposeProfile(
  root: string,
  profile: Omit<ProjectProfile, "status" | "updatedAt">,
  actor: string,
): ProjectProfile {
  const sources = loadSources(root);
  for (const entry of profile.entries) {
    for (const citation of entry.citations) validateCitationWith(sources, root, citation);
  }
  const next = profileSchema.parse({ ...profile, status: "PROPOSED", updatedAt: new Date().toISOString() });
  writeAtomic(join(root, "profile.json"), next);
  appendFileEvent(root, actor, "profile.propose", { entries: next.entries.length });
  return next;
}

export interface EvidenceRecordInput {
  citation: Citation;
  kind: string;
  observation: Record<string, unknown>;
  extractor: { id: string; version: string; model?: string; promptVersion?: string; analysisId?: string };
  confidence: number;
  authority: number;
}

/**
 * Evidence is content-addressed over what was cited *and* what was observed
 * about it, so two different observations on the same lines are two records.
 * Re-recording an identical observation stays idempotent.
 */
export function evidenceId(input: Pick<EvidenceRecordInput, "citation" | "kind" | "observation">): string {
  return `ev_${sha256(stableStringify({ citation: input.citation, kind: input.kind, observation: input.observation }))}`;
}

function evidencePath(root: string, id: string): string {
  return join(root, "evidence", id.slice(3, 5), `${id}.json`);
}

function registerConcept(root: string, kind: string): void {
  const concepts = readJson(join(root, "concepts.json")) as unknown[];
  if (concepts.some((value) => (value as { name?: string }).name === kind)) return;
  writeAtomic(join(root, "concepts.json"), [...concepts, { kind: "DISCOVERED_CONCEPT", name: kind }]);
}

function recordEvidenceWith(
  sources: Map<string, Source>,
  root: string,
  input: EvidenceRecordInput,
  actor: string,
  recordEvent = true,
): FileEvidence {
  validateCitationWith(sources, root, input.citation);
  const id = evidenceId(input);
  const path = evidencePath(root, id);
  if (existsSync(path)) return fileEvidenceSchema.parse(readJson(path));

  const record = fileEvidenceSchema.parse({
    id,
    ...input,
    state: "ACTIVE",
    recordedAt: new Date().toISOString(),
  });
  writeAtomic(path, record);
  registerConcept(root, input.kind);
  if (recordEvent) appendFileEvent(root, actor, "evidence.record", { id });
  return record;
}

export function recordEvidence(root: string, input: EvidenceRecordInput, actor: string): FileEvidence {
  requireApprovedProfile(root, "recording evidence");
  return recordEvidenceWith(loadSources(root), root, input, actor);
}

function featureCoveragePath(root: string, feature: string): string {
  return join(root, "features", feature, "coverage.json");
}

export function readFeatureCoverage(root: string, feature: string): FeatureCoverageRecord | undefined {
  const path = featureCoveragePath(root, feature);
  return existsSync(path) ? featureCoverageRecordSchema.parse(readJson(path)) : undefined;
}

interface ResolvedFeature {
  key: string;
  displayName: string;
  evidence: Array<{ key: string; input: EvidenceRecordInput; id: string }>;
  claims: FileClaim[];
  coverage: FeatureCoverageRecord["sections"];
}

interface ResolvedAnalysis {
  analysisId: string;
  bundle: AnalysisBundle;
  features: ResolvedFeature[];
}

function resolveAnalysisBundle(root: string, input: unknown): ResolvedAnalysis {
  const bundle = analysisBundleSchema.parse(input);
  const analysisId = `analysis_${sha256(stableStringify(bundle))}`;
  const sources = loadSources(root);
  const filesRead = new Set(bundle.filesRead.map((file) => `${file.sourceId}:${file.path}`));
  const requireRead = (citation: Citation): void => {
    if (!filesRead.has(`${citation.sourceId}:${citation.path}`)) {
      throw new Error(`Citation '${citation.sourceId}:${citation.path}' is not declared in filesRead.`);
    }
  };

  for (const file of bundle.filesRead) {
    const source = sources.get(file.sourceId);
    if (!source) throw new Error(`filesRead references unknown source '${file.sourceId}'.`);
    const resolved = resolveWithinSource(sourceDirectory(root, source), file.path);
    if (resolved.status !== "OK") {
      throw new Error(
        `filesRead path '${file.path}' is ${resolved.status.toLowerCase()} for source '${file.sourceId}'.`,
      );
    }
  }
  for (const entry of bundle.profile?.entries ?? []) {
    for (const citation of entry.citations) {
      requireRead(citation);
      validateCitationWith(sources, root, citation);
    }
  }

  const claimIds = new Set<string>();
  const features = bundle.features.map((feature): ResolvedFeature => {
    const byKey = new Map<string, { key: string; input: EvidenceRecordInput; id: string }>();
    for (const proposed of feature.evidence) {
      const input: EvidenceRecordInput = {
        citation: proposed.citation,
        kind: proposed.kind,
        observation: proposed.observation,
        extractor: {
          id: bundle.extractor.id,
          version: bundle.extractor.version,
          ...(bundle.extractor.model ? { model: bundle.extractor.model } : {}),
          ...(bundle.extractor.promptVersion ? { promptVersion: bundle.extractor.promptVersion } : {}),
          analysisId,
        },
        confidence: proposed.confidence,
        authority: proposed.authority,
      };
      requireRead(input.citation);
      validateCitationWith(sources, root, input.citation);
      byKey.set(proposed.key, { key: proposed.key, input, id: evidenceId(input) });
    }

    const claims = feature.claims.map((claim) => {
      if (claimIds.has(claim.id)) throw new Error(`Claim id '${claim.id}' appears more than once in the bundle.`);
      claimIds.add(claim.id);
      return fileClaimSchema.parse({
        id: claim.id,
        feature: feature.key,
        predicate: claim.predicate,
        object: claim.object,
        evidenceIds: claim.evidenceKeys.map((key) => byKey.get(key)!.id),
        state: "ACTIVE",
        ...(claim.supersedes ? { supersedes: claim.supersedes } : {}),
        recordedAt: new Date().toISOString(),
      });
    });
    const coverage = feature.coverage.map((item) => ({
      section: item.section,
      status: item.status,
      ...(item.reason ? { reason: item.reason } : {}),
      evidenceIds: item.evidenceKeys.map((key) => byKey.get(key)!.id),
    }));
    return {
      key: feature.key,
      displayName: feature.displayName ?? feature.key,
      evidence: [...byKey.values()],
      claims,
      coverage,
    };
  });
  return { analysisId, bundle, features };
}

export interface AnalysisValidationResult {
  analysisId: string;
  repositoryRevision: string;
  filesRead: number;
  features: Array<{ key: string; evidence: number; claims: number; coverageSections: number }>;
}

function validationResult(resolved: ResolvedAnalysis): AnalysisValidationResult {
  return {
    analysisId: resolved.analysisId,
    repositoryRevision: resolved.bundle.repository.revision,
    filesRead: resolved.bundle.filesRead.length,
    features: resolved.features.map((feature) => ({
      key: feature.key,
      evidence: feature.evidence.length,
      claims: feature.claims.length,
      coverageSections: feature.coverage.length,
    })),
  };
}

/** Validates a complete AI proposal without mutating `.spec-brain/`. */
export function validateAnalysisBundle(root: string, input: unknown): AnalysisValidationResult {
  return validationResult(resolveAnalysisBundle(root, input));
}

export interface AnalysisIngestResult extends AnalysisValidationResult {
  status: "INGESTED" | "UNCHANGED";
  evidenceIds: string[];
  claimIds: string[];
}

function sameClaim(existing: FileClaim, proposed: FileClaim): boolean {
  return (
    stableStringify({ ...existing, recordedAt: undefined, state: "ACTIVE" }) ===
    stableStringify({ ...proposed, recordedAt: undefined, state: "ACTIVE" })
  );
}

/** Applies one project-wide, human-reviewed AI proposal. */
export function ingestAnalysisBundle(root: string, input: unknown, actor: string): AnalysisIngestResult {
  if (actor !== "human") throw new Error("Analysis ingestion requires a human actor.");
  const resolved = resolveAnalysisBundle(root, input);
  const recordPath = join(root, "analyses", `${resolved.analysisId}.json`);

  const existingClaims = claimRecords(root);
  const existingById = new Map(existingClaims.map((claim) => [claim.id, claim]));
  const proposedIds = new Set(resolved.features.flatMap((feature) => feature.claims.map((claim) => claim.id)));
  for (const claim of resolved.features.flatMap((feature) => feature.claims)) {
    const existing = existingById.get(claim.id);
    if (existing && !sameClaim(existing, claim)) {
      throw new Error(`Claim '${claim.id}' already exists with different content; use a new id and supersedes.`);
    }
    if (claim.supersedes && !existingById.has(claim.supersedes) && !proposedIds.has(claim.supersedes)) {
      throw new Error(`Claim '${claim.id}' supersedes missing claim '${claim.supersedes}'.`);
    }
  }
  const availableForOrder = new Set(existingById.keys());
  const pendingForOrder = [...resolved.features.flatMap((feature) => feature.claims)];
  const orderedClaims: FileClaim[] = [];
  while (pendingForOrder.length > 0) {
    const readyIndex = pendingForOrder.findIndex(
      (claim) => !claim.supersedes || availableForOrder.has(claim.supersedes),
    );
    if (readyIndex < 0) throw new Error("Claim supersession graph contains a cycle.");
    const claim = pendingForOrder.splice(readyIndex, 1)[0]!;
    availableForOrder.add(claim.id);
    orderedClaims.push(claim);
  }

  if (existsSync(recordPath)) {
    const record = readJson(recordPath) as { evidenceIds: string[]; claimIds: string[] };
    const missingEvidence = record.evidenceIds.filter((id) => !existsSync(evidencePath(root, id)));
    const existingClaimIds = new Set(claimRecords(root).map((claim) => claim.id));
    const missingClaims = record.claimIds.filter((id) => !existingClaimIds.has(id));
    if (missingEvidence.length > 0 || missingClaims.length > 0) {
      throw new Error(
        `Analysis record '${resolved.analysisId}' is incomplete: ` +
          `${missingEvidence.length} evidence and ${missingClaims.length} claims are missing.`,
      );
    }
    return {
      ...validationResult(resolved),
      status: "UNCHANGED",
      evidenceIds: record.evidenceIds,
      claimIds: record.claimIds,
    };
  }

  if (resolved.bundle.profile) {
    const next = profileSchema.parse({
      status: "APPROVED",
      entries: resolved.bundle.profile.entries,
      updatedAt: new Date().toISOString(),
    });
    writeAtomic(join(root, "profile.json"), next);
  } else {
    requireApprovedProfile(root, "analysis ingestion");
  }

  const sources = loadSources(root);
  const evidenceIds: string[] = [];
  const claimIds: string[] = [];
  for (const feature of resolved.features) {
    for (const proposed of feature.evidence) {
      const evidence = recordEvidenceWith(sources, root, proposed.input, actor, false);
      evidenceIds.push(evidence.id);
    }
  }

  for (const claim of orderedClaims) {
    if (!existingById.has(claim.id)) {
      writeClaim(root, claim, actor, claim.supersedes ? "claim.supersede" : "claim.propose", false);
    }
    claimIds.push(claim.id);
  }

  for (const feature of resolved.features) {
    writeAtomic(featureCoveragePath(root, feature.key), {
      feature: feature.key,
      displayName: feature.displayName,
      analysisId: resolved.analysisId,
      sections: feature.coverage,
      updatedAt: new Date().toISOString(),
    });
  }

  writeAtomic(recordPath, {
    id: resolved.analysisId,
    repository: resolved.bundle.repository,
    extractor: resolved.bundle.extractor,
    filesRead: resolved.bundle.filesRead,
    excluded: resolved.bundle.excluded,
    features: resolved.features.map((feature) => feature.key),
    evidenceIds: [...new Set(evidenceIds)].sort(),
    claimIds: [...new Set(claimIds)].sort(),
    recordedAt: new Date().toISOString(),
  });
  appendFileEvent(root, actor, "analysis.ingest", {
    analysisId: resolved.analysisId,
    features: resolved.features.map((feature) => feature.key),
    evidenceIds,
    claimIds,
  });
  return {
    ...validationResult(resolved),
    status: "INGESTED",
    evidenceIds: [...new Set(evidenceIds)].sort(),
    claimIds: [...new Set(claimIds)].sort(),
  };
}

export interface EvidenceQuery {
  kind?: string | undefined;
  path?: string | undefined;
  state?: string | undefined;
  feature?: string | undefined;
}

export function evidenceRecords(root: string, query: EvidenceQuery = {}): FileEvidence[] {
  const featureIds = query.feature
    ? new Set(
        claimRecords(root)
          .filter((claim) => claim.feature === query.feature)
          .flatMap((claim) => claim.evidenceIds),
      )
    : undefined;

  return jsonFiles(join(root, "evidence"))
    .map((path) => fileEvidenceSchema.parse(readJson(path)))
    .filter((item) => !query.kind || item.kind === query.kind)
    .filter((item) => !query.path || item.citation.path.includes(query.path))
    .filter((item) => !query.state || item.state === query.state)
    .filter((item) => !featureIds || featureIds.has(item.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function claimRecords(root: string): FileClaim[] {
  return jsonFiles(join(root, "claims"))
    .map((path) => fileClaimSchema.parse(readJson(path)))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function claimPath(root: string, claim: FileClaim): string {
  return join(root, "claims", claim.feature, `${claim.id}.json`);
}

export function writeClaim(
  root: string,
  claim: FileClaim,
  actor: string,
  operation: "claim.propose" | "claim.supersede" = "claim.propose",
  recordEvent = true,
): FileClaim {
  const parsed = fileClaimSchema.parse(claim);
  const missing = parsed.evidenceIds.filter((id) => !existsSync(evidencePath(root, id)));
  if (missing.length > 0) {
    throw new Error(`Claim references evidence that does not exist: ${missing.join(", ")}.`);
  }
  if (existsSync(claimPath(root, parsed))) {
    throw new Error("Claims are immutable; create a new claim and supersede the prior record.");
  }

  if (operation === "claim.supersede") {
    if (!parsed.supersedes) throw new Error("Superseding claim must declare supersedes.");
    const prior = claimRecords(root).find((item) => item.id === parsed.supersedes);
    if (!prior) throw new Error("Claim to supersede does not exist.");
    writeAtomic(claimPath(root, prior), { ...prior, state: "SUPERSEDED" });
  }

  writeAtomic(claimPath(root, parsed), parsed);
  if (recordEvent) appendFileEvent(root, actor, operation, { id: parsed.id, supersedes: parsed.supersedes });
  return parsed;
}

export interface InvalidationResult {
  evidence: FileEvidence;
  claimsNeedingReview: string[];
}

export function invalidateEvidence(root: string, id: string, actor: string): InvalidationResult {
  if (actor !== "human") throw new Error("Only a human actor may invalidate evidence.");
  const path = evidencePath(root, id);
  if (!existsSync(path)) throw new Error(`Evidence '${id}' does not exist.`);

  const evidence = fileEvidenceSchema.parse(readJson(path));
  const next: FileEvidence = { ...evidence, state: "INVALIDATED" };
  writeAtomic(path, next);
  const verified = applyVerification(root, actor, false);
  const claimsNeedingReview = verified.claimsNeedingReview;
  appendFileEvent(root, actor, "evidence.invalidate", { id, claimsNeedingReview });
  return { evidence: next, claimsNeedingReview };
}

export interface VerificationResult {
  stale: string[];
  orphaned: string[];
  historicalStale: string[];
  historicalOrphaned: string[];
  claimsNeedingReview: string[];
  changes: number;
  /** True when the store needs human attention: use this to gate CI. */
  drift: boolean;
}

export interface VerifiedSnapshot extends VerificationResult {
  evidence: FileEvidence[];
  claims: FileClaim[];
}

/** Computes current citation and claim states without writing files or events. */
export function verifiedSnapshot(root: string): VerifiedSnapshot {
  const sources = loadSources(root);
  const storedEvidence = evidenceRecords(root);
  const evidence = storedEvidence.map((item): FileEvidence => {
    if (item.state === "INVALIDATED") return item;
    const cited = citedContent(sources, root, item.citation);
    const state = !("content" in cited)
      ? "ORPHANED"
      : `sha256:${sha256(cited.content)}` === item.citation.contentHash
        ? "ACTIVE"
        : "STALE";
    return { ...item, state };
  });
  const evidenceState = new Map(evidence.map((item) => [item.id, item.state]));
  const storedClaims = claimRecords(root);
  const claims = storedClaims.map((claim): FileClaim => {
    if (claim.state === "SUPERSEDED") return claim;
    const needsReview = claim.evidenceIds.some((id) => evidenceState.get(id) !== "ACTIVE");
    return { ...claim, state: needsReview ? "NEEDS_REVIEW" : "ACTIVE" };
  });

  const currentEvidenceIds = new Set(
    claims.filter((claim) => claim.state !== "SUPERSEDED").flatMap((claim) => claim.evidenceIds),
  );
  for (const path of jsonFiles(join(root, "features"))) {
    for (const id of featureCoverageRecordSchema.parse(readJson(path)).sections.flatMap((item) => item.evidenceIds)) {
      currentEvidenceIds.add(id);
    }
  }

  const current = evidence.filter((item) => currentEvidenceIds.has(item.id));
  const historical = evidence.filter((item) => !currentEvidenceIds.has(item.id));
  const stale = current.filter((item) => item.state === "STALE").map((item) => item.id);
  const orphaned = current.filter((item) => item.state === "ORPHANED").map((item) => item.id);
  const historicalStale = historical.filter((item) => item.state === "STALE").map((item) => item.id);
  const historicalOrphaned = historical.filter((item) => item.state === "ORPHANED").map((item) => item.id);
  const claimsNeedingReview = claims.filter((claim) => claim.state === "NEEDS_REVIEW").map((claim) => claim.id);
  const changes =
    evidence.filter((item) => storedEvidence.find((stored) => stored.id === item.id)?.state !== item.state).length +
    claims.filter((item) => storedClaims.find((stored) => stored.id === item.id)?.state !== item.state).length;
  return {
    evidence,
    claims,
    stale,
    orphaned,
    historicalStale,
    historicalOrphaned,
    claimsNeedingReview,
    changes,
    drift: stale.length > 0 || orphaned.length > 0 || claimsNeedingReview.length > 0,
  };
}

function verificationResult(snapshot: VerifiedSnapshot): VerificationResult {
  return {
    stale: snapshot.stale,
    orphaned: snapshot.orphaned,
    historicalStale: snapshot.historicalStale,
    historicalOrphaned: snapshot.historicalOrphaned,
    claimsNeedingReview: snapshot.claimsNeedingReview,
    changes: snapshot.changes,
    drift: snapshot.drift,
  };
}

/** Compatibility name for read-only verification. */
export function verifyFileStore(root: string): VerificationResult {
  return verificationResult(verifiedSnapshot(root));
}

/** Persists computed state transitions. Clean runs write nothing and append no event. */
export function applyVerification(root: string, actor: string, recordEvent = true): VerificationResult {
  const snapshot = verifiedSnapshot(root);
  const storedEvidence = new Map(evidenceRecords(root).map((item) => [item.id, item]));
  const storedClaims = new Map(claimRecords(root).map((item) => [item.id, item]));
  for (const item of snapshot.evidence) {
    if (storedEvidence.get(item.id)?.state !== item.state) writeAtomic(evidencePath(root, item.id), item);
  }
  for (const claim of snapshot.claims) {
    if (storedClaims.get(claim.id)?.state !== claim.state) writeAtomic(claimPath(root, claim), claim);
  }
  const result = verificationResult(snapshot);
  if (recordEvent && result.changes > 0) appendFileEvent(root, actor, "verify.apply", result);
  return result;
}

export function graphQuery(
  root: string,
  query: { feature?: string | undefined; predicate?: string | undefined; state?: string | undefined },
): { claims: FileClaim[]; evidence: FileEvidence[] } {
  const snapshot = verifiedSnapshot(root);
  const claims = snapshot.claims
    .filter((item) => !query.feature || item.feature === query.feature)
    .filter((item) => !query.predicate || item.predicate === query.predicate)
    .filter((item) => !query.state || item.state === query.state);
  const ids = new Set(claims.flatMap((item) => item.evidenceIds));
  return { claims, evidence: snapshot.evidence.filter((item) => ids.has(item.id)) };
}

export interface CoverageReport {
  sources: number;
  evidence: { total: number; active: number; stale: number; orphaned: number; invalidated: number };
  claims: { total: number; active: number; needsReview: number; superseded: number };
}

export function coverage(root: string): CoverageReport {
  const { evidence, claims } = verifiedSnapshot(root);
  const countEvidence = (state: FileEvidence["state"]) => evidence.filter((item) => item.state === state).length;
  const countClaims = (state: FileClaim["state"]) => claims.filter((item) => item.state === state).length;
  return {
    sources: loadSources(root).size,
    evidence: {
      total: evidence.length,
      active: countEvidence("ACTIVE"),
      stale: countEvidence("STALE"),
      orphaned: countEvidence("ORPHANED"),
      invalidated: countEvidence("INVALIDATED"),
    },
    claims: {
      total: claims.length,
      active: countClaims("ACTIVE"),
      needsReview: countClaims("NEEDS_REVIEW"),
      superseded: countClaims("SUPERSEDED"),
    },
  };
}

export function projectSource(root: string, projectRoot: string): Source {
  return { id: "project", root: relative(root, projectRoot) || ".", type: "LOCAL" };
}
