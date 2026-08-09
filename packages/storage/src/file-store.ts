import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  citationSchema,
  extractionCacheKey,
  fileClaimSchema,
  fileEvidenceSchema,
  profileSchema,
  sha256,
  sourceSchema,
  stableJson,
  stableStringify,
  type Citation,
  type FileClaim,
  type FileEvidence,
  type ProjectProfile,
  type Source,
} from "@mobile-spec-brain/core";

export { stableJson } from "@mobile-spec-brain/core";

const DIRECTORY_NAME = ".spec-brain";

/** Identifies the record layout an extraction cache key was produced under. */
export const SCHEMA_VERSION = "file-protocol-v2";

/**
 * Upper bound on observations accepted in a single extraction. This is an
 * absolute cap rather than a ratio, so a first extraction against an empty
 * store is not rejected for having no baseline to compare against.
 */
export const MAX_OBSERVATIONS_PER_EXTRACTION = 1000;

/** Directories never walked when hashing an extraction scope. */
const IGNORED_DIRECTORIES = new Set([".git", ".spec-brain", "node_modules", "dist"]);

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
  for (const path of ["evidence", "claims", "events", "extractions", "spec"]) {
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
  extractor: { id: string; version: string; model?: string; promptVersion?: string; cacheKey?: string };
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
  appendFileEvent(root, actor, "evidence.record", { id });
  return record;
}

export function recordEvidence(root: string, input: EvidenceRecordInput, actor: string): FileEvidence {
  requireApprovedProfile(root, "recording evidence");
  return recordEvidenceWith(loadSources(root), root, input, actor);
}

function filesUnder(path: string): string[] {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isSymbolicLink()) return [];
  if (!stat.isDirectory()) return stat.isFile() ? [path] : [];
  return readdirSync(path)
    .filter((name) => !IGNORED_DIRECTORIES.has(name))
    .sort()
    .flatMap((name) => filesUnder(join(path, name)));
}

/**
 * Hashes the contents of an extraction scope. Files are read as bytes so
 * binary content contributes faithfully to the key.
 */
export function scopeContentHash(root: string, scope: string): string {
  const source = loadSources(root).get("project");
  if (!source) return sha256(scope);

  const sourceRoot = sourceDirectory(root, source);
  const resolved = resolveWithinSource(sourceRoot, scope);
  if (resolved.status === "ESCAPES") throw new Error(`Extraction scope '${scope}' escapes its source root.`);
  if (resolved.status === "MISSING") return sha256(scope);

  const base = realpathSync(sourceRoot);
  const files = filesUnder(resolved.path);
  if (files.length === 0) return sha256(scope);
  return sha256(
    stableStringify(
      files.map((file) => ({ path: relative(base, file), hash: sha256(readFileSync(file).toString("base64")) })),
    ),
  );
}

export interface ExtractionProposal {
  extractor: { id: string; version: string; model?: string; promptVersion?: string };
  observations: EvidenceRecordInput[];
}

export interface ExtractionResult {
  cacheKey: string;
  reused: boolean;
  evidence: FileEvidence[];
}

export function extractionKeyFor(root: string, scope: string, extractor: ExtractionProposal["extractor"]): string {
  return extractionCacheKey({
    contentHash: scopeContentHash(root, scope),
    extractorId: extractor.id,
    extractorVersion: extractor.version,
    promptVersion: extractor.promptVersion ?? "unspecified",
    modelVersion: extractor.model ?? "unspecified",
    schemaVersion: SCHEMA_VERSION,
  });
}

export function extractEvidence(
  root: string,
  scope: string,
  proposal: ExtractionProposal,
  actor: string,
): ExtractionResult {
  requireApprovedProfile(root, "extraction");
  if (proposal.observations.length > MAX_OBSERVATIONS_PER_EXTRACTION) {
    throw new Error(
      `Extraction proposes ${proposal.observations.length} observations, above the limit of ` +
        `${MAX_OBSERVATIONS_PER_EXTRACTION}. Split the scope into smaller extractions.`,
    );
  }

  const cacheKey = extractionKeyFor(root, scope, proposal.extractor);
  const cachePath = join(root, "extractions", `${cacheKey}.json`);
  if (existsSync(cachePath)) {
    const cached = readJson(cachePath) as { evidenceIds: string[] };
    const evidence = cached.evidenceIds
      .map((id) => evidencePath(root, id))
      .filter((path) => existsSync(path))
      .map((path) => fileEvidenceSchema.parse(readJson(path)));
    return { cacheKey, reused: true, evidence };
  }

  const sources = loadSources(root);
  const evidence = proposal.observations.map((input) =>
    recordEvidenceWith(
      sources,
      root,
      { ...input, extractor: { ...input.extractor, ...proposal.extractor, cacheKey } },
      actor,
    ),
  );
  writeAtomic(cachePath, {
    cacheKey,
    evidenceIds: evidence.map((item) => item.id).sort(),
    extractor: proposal.extractor,
    scope,
  });
  appendFileEvent(root, actor, "extract", { cacheKey, scope, evidenceIds: evidence.map((item) => item.id) });
  return { cacheKey, reused: false, evidence };
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
  appendFileEvent(root, actor, operation, { id: parsed.id, supersedes: parsed.supersedes });
  return parsed;
}

/**
 * Downgrades active claims that depend on evidence which is no longer active,
 * and returns every claim currently in NEEDS_REVIEW — not only the ones this
 * call transitioned. Reporting the transition alone would make a second CI run
 * look clean simply because the first run had already recorded the downgrade.
 */
function reviewDependentClaims(root: string): string[] {
  const inactive = new Set(
    evidenceRecords(root)
      .filter((item) => item.state !== "ACTIVE")
      .map((item) => item.id),
  );
  for (const claim of claimRecords(root)) {
    if (claim.state !== "ACTIVE") continue;
    if (!claim.evidenceIds.some((id) => inactive.has(id))) continue;
    writeAtomic(claimPath(root, claim), { ...claim, state: "NEEDS_REVIEW" });
  }
  return claimRecords(root)
    .filter((claim) => claim.state === "NEEDS_REVIEW")
    .map((claim) => claim.id);
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
  const claimsNeedingReview = reviewDependentClaims(root);
  appendFileEvent(root, actor, "evidence.invalidate", { id, claimsNeedingReview });
  return { evidence: next, claimsNeedingReview };
}

export interface VerificationResult {
  stale: string[];
  orphaned: string[];
  claimsNeedingReview: string[];
  /** True when the store needs human attention: use this to gate CI. */
  drift: boolean;
}

export function verifyFileStore(root: string, actor: string): VerificationResult {
  const sources = loadSources(root);
  const stale: string[] = [];
  const orphaned: string[] = [];

  for (const evidence of evidenceRecords(root)) {
    if (evidence.state === "INVALIDATED") continue;
    const cited = citedContent(sources, root, evidence.citation);
    const state = !("content" in cited)
      ? "ORPHANED"
      : `sha256:${sha256(cited.content)}` === evidence.citation.contentHash
        ? "ACTIVE"
        : "STALE";
    if (state !== evidence.state) {
      writeAtomic(evidencePath(root, evidence.id), { ...evidence, state });
    }
    if (state === "STALE") stale.push(evidence.id);
    if (state === "ORPHANED") orphaned.push(evidence.id);
  }

  const claimsNeedingReview = reviewDependentClaims(root);
  const drift = stale.length > 0 || orphaned.length > 0 || claimsNeedingReview.length > 0;
  appendFileEvent(root, actor, "verify", { claimsNeedingReview, drift, orphaned, stale });
  return { stale, orphaned, claimsNeedingReview, drift };
}

export function graphQuery(
  root: string,
  query: { feature?: string | undefined; predicate?: string | undefined; state?: string | undefined },
): { claims: FileClaim[]; evidence: FileEvidence[] } {
  const claims = claimRecords(root)
    .filter((item) => !query.feature || item.feature === query.feature)
    .filter((item) => !query.predicate || item.predicate === query.predicate)
    .filter((item) => !query.state || item.state === query.state);
  const ids = new Set(claims.flatMap((item) => item.evidenceIds));
  return { claims, evidence: evidenceRecords(root).filter((item) => ids.has(item.id)) };
}

export interface CoverageReport {
  sources: number;
  evidence: { total: number; active: number; stale: number; orphaned: number; invalidated: number };
  claims: { total: number; active: number; needsReview: number; superseded: number };
}

export function coverage(root: string): CoverageReport {
  const evidence = evidenceRecords(root);
  const claims = claimRecords(root);
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
