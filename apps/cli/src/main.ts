#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildFileSpec,
  coverageSections,
  coverageStatuses,
  isSpecSection,
  selectSpecSection,
  specSections,
  type FileEvidence,
  type FileSpec,
} from "@mobile-spec-brain/core";
import {
  applyVerification,
  buildCitation,
  coverage,
  graphQuery,
  ingestAnalysisBundle,
  initializeFileStore,
  invalidateEvidence,
  projectSource,
  proposeProfile,
  readProfile,
  readFeatureCoverage,
  recordEvidence,
  specBrainDirectory,
  stableJson,
  validateAnalysisBundle,
  verifyFileStore,
  verifiedSnapshot,
  writeClaim,
  type CitationRequest,
} from "@mobile-spec-brain/storage";

const USAGE = `Usage: spec-brain <command>

  init                                          Create .spec-brain/ in the current directory
  cite <path> <start> <end> [--source id] [--revision r]
                                                Build a verified citation for a line range
  profile read
  profile propose --file <profile.json>
  evidence record --file <evidence.json>
  evidence query [--kind k] [--path p] [--state s] [--feature f]
  evidence invalidate --id <ev_...> --confirm-human
  claim propose --file <claim.json>
  claim supersede --file <claim.json>
  graph query [--feature f] [--predicate p] [--state s]
  analysis contract
  analysis validate --file <analysis.json>
  analysis ingest --file <analysis.json> --confirm-human
  verify [--check|--write]
  coverage
  spec render <feature> [--section ${specSections.join("|")}]`;

interface ParsedArguments {
  command: string | undefined;
  subcommand: string | undefined;
  positional: string[];
  options: Map<string, string>;
  flags: Set<string>;
}

/** Flags that stand alone rather than taking the next token as a value. */
const BOOLEAN_FLAGS = new Set(["--json", "--confirm-human", "--check", "--write"]);

function parseArguments(argv: string[]): ParsedArguments {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      flags.add(token);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Option ${token} requires a value.`);
    options.set(token, value);
    index += 1;
  }

  const [command, subcommand, ...rest] = positional;
  return { command, subcommand, positional: rest, options, flags };
}

const projectRoot = process.cwd();
const root = specBrainDirectory(projectRoot);
const args = parseArguments(process.argv.slice(2));

function output(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message: string, code = "INVALID_USAGE"): never {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  throw error;
}

function requireStore(): void {
  if (!existsSync(root)) fail("Run `spec-brain init` first.", "SPEC_BRAIN_NOT_INITIALIZED");
}

function option(name: string): string | undefined {
  return args.options.get(name);
}

function requiredOption(name: string): string {
  return option(name) ?? fail(`${name} is required.`);
}

function fileInput(): unknown {
  return JSON.parse(readFileSync(resolve(projectRoot, requiredOption("--file")), "utf8"));
}

function init(): void {
  initializeFileStore(projectRoot);
  const sourcesPath = join(root, "sources.json");
  const sources = JSON.parse(readFileSync(sourcesPath, "utf8")) as unknown[];
  if (sources.length === 0) writeFileSync(sourcesPath, stableJson([projectSource(root, projectRoot)]));
  output({ status: "initialized", root });
}

function cite(): void {
  requireStore();
  // `cite` reads a range that already exists on disk, so its arguments are
  // positional from the command word onward rather than sub-commanded.
  const positional = [args.subcommand, ...args.positional].filter((value): value is string => value !== undefined);
  const [path, start, end] = positional;
  if (!path || !start || !end) fail("Use `spec-brain cite <path> <start-line> <end-line>`.");

  const range: [number, number] = [Number(start), Number(end)];
  if (!Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
    fail(`Line numbers must be integers, got '${start}' and '${end}'.`);
  }

  const request: CitationRequest = { path, range };
  const source = option("--source");
  if (source !== undefined) request.sourceId = source;
  const revision = option("--revision");
  if (revision !== undefined) request.revision = revision;

  output({ status: "complete", citation: buildCitation(root, request) });
}

function profile(): void {
  requireStore();
  if (args.subcommand === "read") return output({ status: "complete", profile: readProfile(root) });
  if (args.subcommand === "propose") {
    return output({ status: "proposed", profile: proposeProfile(root, fileInput() as never, "agent") });
  }
  fail("Use `spec-brain profile read|propose`. Approval is a reviewed edit to .spec-brain/profile.json.");
}

function evidence(): void {
  requireStore();
  if (args.subcommand === "query") {
    const snapshot = verifiedSnapshot(root);
    const featureIds = option("--feature")
      ? new Set(
          snapshot.claims
            .filter((claim) => claim.feature === option("--feature") && claim.state !== "SUPERSEDED")
            .flatMap((claim) => claim.evidenceIds),
        )
      : undefined;
    return output({
      status: "complete",
      evidence: snapshot.evidence
        .filter((item) => !option("--kind") || item.kind === option("--kind"))
        .filter((item) => !option("--path") || item.citation.path.includes(option("--path")!))
        .filter((item) => !option("--state") || item.state === option("--state"))
        .filter((item) => !featureIds || featureIds.has(item.id)),
    });
  }
  if (args.subcommand === "record") {
    return output({ status: "recorded", evidence: recordEvidence(root, fileInput() as never, "agent") });
  }
  if (args.subcommand === "invalidate") {
    if (!args.flags.has("--confirm-human")) {
      fail("`evidence invalidate` requires --confirm-human: only a human may invalidate recorded evidence.");
    }
    return output({ status: "invalidated", ...invalidateEvidence(root, requiredOption("--id"), "human") });
  }
  fail("Use `spec-brain evidence record|query|invalidate`.");
}

function claim(): void {
  requireStore();
  if (args.subcommand !== "propose" && args.subcommand !== "supersede") {
    fail("Use `spec-brain claim propose|supersede --file claim.json`.");
  }
  const operation = args.subcommand === "supersede" ? "claim.supersede" : "claim.propose";
  output({ status: "recorded", claim: writeClaim(root, fileInput() as never, "agent", operation) });
}

function graph(): void {
  requireStore();
  if (args.subcommand !== "query") {
    fail("Use `spec-brain graph query [--feature f] [--predicate p] [--state s]`.");
  }
  output({
    status: "complete",
    ...graphQuery(root, {
      feature: option("--feature"),
      predicate: option("--predicate"),
      state: option("--state"),
    }),
  });
}

function analysis(): void {
  requireStore();
  if (args.subcommand === "contract") {
    return output({
      status: "complete",
      contract: {
        schemaVersion: 1,
        repository: { revision: "git revision", dirtyFingerprint: "optional working-tree fingerprint" },
        extractor: { id: "agent", version: "1", model: "optional", promptVersion: "optional" },
        filesRead: [{ sourceId: "project", path: "path actually inspected by the AI" }],
        excluded: ["explicitly skipped paths or unavailable sources"],
        profile: { entries: "optional cited project-profile entries" },
        features: {
          coverageSections,
          coverageStatuses,
          evidence: "keyed observations with closed citations",
          claims: "claim proposals referencing local evidence keys",
        },
      },
      note: "The AI explores the configured project sources. filesRead is audit metadata, not a correctness or cache scope.",
    });
  }
  if (args.subcommand === "validate") {
    return output({ status: "valid", ...validateAnalysisBundle(root, fileInput()) });
  }
  if (args.subcommand === "ingest") {
    if (!args.flags.has("--confirm-human")) {
      fail("`analysis ingest` requires --confirm-human after reviewing the project analysis bundle.");
    }
    return output({ status: "complete", analysis: ingestAnalysisBundle(root, fileInput(), "human") });
  }
  fail("Use `spec-brain analysis contract|validate|ingest`.");
}

function renderMarkdown(view: FileSpec, section: string, evidence: FileEvidence[]): string {
  const quote = (value: string) => `\`${value}\``;
  const ids = (values: string[]) => (values.length ? values.map(quote).join(", ") : "none");
  const lines: string[] = [
    `# ${view.feature.displayName}`,
    "",
    "> Derived view. Do not edit directly.",
    "",
    `- Feature: ${quote(view.feature.key)}`,
    `- Graph state: ${quote(view.graphHash)}`,
    `- Completeness: ${(view.completeness.ratio * 100).toFixed(1)}% ` +
      `(${view.completeness.completeSections}/${view.completeness.totalSections} protocol sections complete, ` +
      `${view.completeness.staleSections} stale)`,
    `- Section: ${quote(section)}`,
  ];

  const push = (heading: string, body: string[]) => lines.push("", `## ${heading}`, "", ...body);

  push(
    "Protocol coverage",
    view.coverage.map(
      (item) =>
        `- ${quote(item.section)} — **${item.status}** / ${item.state}` +
        `${item.reason ? ` — ${item.reason}` : ""} · evidence: ${ids(item.evidenceIds)}`,
    ),
  );

  if (view.unknowns.length || section === "all" || section === "unknowns") {
    push(
      "Unresolved before implementation",
      view.unknowns.length
        ? view.unknowns.map((item) => `- ${quote(item.field)} — ${item.reason} (${ids(item.evidenceIds)})`)
        : ["- None."],
    );
  }
  if (section === "all" || section === "api") {
    push(
      "API contracts",
      view.api.length
        ? view.api.flatMap((item) => [
            `- ${item.method} ${item.path} · **${item.state}** · evidence: ${ids(item.evidenceIds)}`,
            `  - parameters: ${JSON.stringify(item.parameters)}`,
            `  - request: ${JSON.stringify(item.requestBody)}`,
            `  - responses: ${JSON.stringify(item.responses)}`,
          ])
        : ["- UNKNOWN — EVIDENCE_ABSENT"],
    );
  }
  if (section === "all" || section === "figma") {
    push(
      "Figma frames",
      view.figmaFrames.length
        ? view.figmaFrames.map(
            (item) => `- ${quote(item.nodeId)} ${item.name} · **${item.state}** · ${ids(item.evidenceIds)}`,
          )
        : ["- UNKNOWN — EVIDENCE_ABSENT"],
    );
  }
  if (section === "all" || section === "implementation") {
    push(
      "Implementation",
      view.implementations.length
        ? view.implementations.map(
            (item) =>
              `- ${item.platform}: ${item.status}${item.location ? ` (${item.location})` : ""} · ` +
              `**${item.state}** · ${ids(item.evidenceIds)}`,
          )
        : ["- UNKNOWN — EVIDENCE_ABSENT"],
    );
  }
  if (section === "all" || section === "navigation") {
    const routes = (["incoming", "outgoing"] as const).flatMap((direction) =>
      view.navigation[direction].map(
        (item) =>
          `- ${direction}: ${item.route}${item.platform ? ` (${item.platform})` : ""} · ` +
          `**${item.state}** · ${ids(item.evidenceIds)}`,
      ),
    );
    push("Navigation", routes.length ? routes : ["- UNKNOWN — EVIDENCE_ABSENT"]);
  }

  push(
    "Evidence",
    evidence.length
      ? evidence.map(
          (item) =>
            `- ${quote(item.id)} · ${item.kind} · **${item.state}** · ` +
            `${item.citation.sourceId}:${item.citation.path}:${item.citation.range.join("-")} · ` +
            `${item.citation.contentHash}`,
        )
      : ["- None."],
  );

  return `${lines.join("\n")}\n`;
}

function renderSpec(): void {
  requireStore();
  if (args.subcommand !== "render") {
    fail(`Use \`spec-brain spec render <feature> [--section ${specSections.join("|")}]\`.`);
  }

  const feature = args.positional[0] ?? fail("Feature is required.");
  const section = option("--section");
  if (section !== undefined && !isSpecSection(section)) {
    fail(`Unknown section '${section}'. Valid sections: ${specSections.join(", ")}.`);
  }

  const snapshot = verifiedSnapshot(root);
  const claims = snapshot.claims
    .filter((item) => item.feature === feature && item.state !== "SUPERSEDED")
    .sort((left, right) => left.id.localeCompare(right.id));
  const featureCoverage = readFeatureCoverage(root, feature);
  const ids = new Set([
    ...claims.flatMap((item) => item.evidenceIds),
    ...(featureCoverage?.sections.flatMap((item) => item.evidenceIds) ?? []),
  ]);
  const evidence = snapshot.evidence.filter((item) => ids.has(item.id));

  const full = buildFileSpec(feature, claims, evidence, featureCoverage);
  const view = section ? selectSpecSection(full, section) : full;

  const directory = join(root, "spec");
  mkdirSync(directory, { recursive: true });
  const jsonPath = join(directory, `${feature}.spec.json`);
  writeFileSync(jsonPath, stableJson(view));
  writeFileSync(join(directory, `${feature}.md`), renderMarkdown(view, section ?? "all", evidence));
  output({ status: "rendered", feature, section: section ?? "all", output: jsonPath });
}

const commands: Record<string, () => void> = {
  init,
  cite,
  profile,
  evidence,
  claim,
  graph,
  analysis,
  spec: renderSpec,
  verify: () => {
    requireStore();
    if (args.flags.has("--check") && args.flags.has("--write")) {
      fail("Use either --check or --write, not both.");
    }
    const result = args.flags.has("--write") ? applyVerification(root, "verifier") : verifyFileStore(root);
    output({ status: "complete", ...result });
    if (result.drift && args.flags.has("--check")) process.exitCode = 1;
  },
  coverage: () => {
    requireStore();
    output({ status: "complete", coverage: coverage(root) });
  },
};

try {
  const handler = args.command ? commands[args.command] : undefined;
  if (!handler) {
    console.log(USAGE);
    process.exitCode = 2;
  } else {
    handler();
  }
} catch (error) {
  const code = (error as { code?: string }).code;
  output({
    status: "error",
    ...(code ? { code } : {}),
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 2;
}
