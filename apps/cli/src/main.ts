#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildFileSpec,
  isSpecSection,
  selectSpecSection,
  specSections,
  type FileEvidence,
  type FileSpec,
} from "@mobile-spec-brain/core";
import {
  buildCitation,
  claimRecords,
  coverage,
  evidenceRecords,
  extractEvidence,
  extractionKeyFor,
  graphQuery,
  initializeFileStore,
  invalidateEvidence,
  projectSource,
  proposeProfile,
  readProfile,
  recordEvidence,
  specBrainDirectory,
  stableJson,
  verifyFileStore,
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
  extract --scope <path> [--file <proposal.json>]
  verify [--fail-on-drift]
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
const BOOLEAN_FLAGS = new Set(["--json", "--confirm-human", "--fail-on-drift"]);

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
    return output({
      status: "complete",
      evidence: evidenceRecords(root, {
        kind: option("--kind"),
        path: option("--path"),
        state: option("--state"),
        feature: option("--feature"),
      }),
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

function extract(): void {
  requireStore();
  const scope = requiredOption("--scope");
  const proposalPath = option("--file");

  if (!proposalPath) {
    const extractor = { id: "external-ai", version: "1", promptVersion: "citation-only", model: "external" };
    return output({
      status: "ready",
      scope,
      extractionCacheKey: extractionKeyFor(root, scope, extractor),
      contract:
        "Return only open observations with closed citations as { extractor, observations }, then pass them " +
        "through `spec-brain extract --scope <scope> --file proposal.json`. Every cited range is re-read and " +
        "re-hashed; an identical extraction key reuses the previous result.",
      profile: readProfile(root).status,
    });
  }

  const proposal = JSON.parse(readFileSync(resolve(projectRoot, proposalPath), "utf8"));
  const result = extractEvidence(root, scope, proposal, "agent");
  output({ status: result.reused ? "reused" : "extracted", ...result });
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
      `(${view.completeness.knownFields} known / ${view.completeness.unknownFields} unknown, ` +
      `${view.completeness.staleFields} stale)`,
    `- Section: ${quote(section)}`,
  ];

  const push = (heading: string, body: string[]) => lines.push("", `## ${heading}`, "", ...body);

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

  const claims = claimRecords(root)
    .filter((item) => item.feature === feature)
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set(claims.flatMap((item) => item.evidenceIds));
  const evidence = evidenceRecords(root).filter((item) => ids.has(item.id));

  const full = buildFileSpec(feature, claims, evidence);
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
  extract,
  spec: renderSpec,
  verify: () => {
    requireStore();
    const result = verifyFileStore(root, "verifier");
    output({ status: "complete", ...result });
    if (result.drift && args.flags.has("--fail-on-drift")) process.exitCode = 1;
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
