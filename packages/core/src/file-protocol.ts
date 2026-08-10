import { z } from "zod";

const recordKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Must be a safe record key.");

/** Closed citation contract; all domain vocabulary outside this object is open. */
export const citationSchema = z.object({
  sourceId: z.string().min(1),
  path: z.string().min(1),
  range: z
    .tuple([z.number().int().positive(), z.number().int().positive()])
    .refine(([start, end]) => start <= end, "Citation range must be ordered."),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  revision: z.string().min(1),
});
export type Citation = z.infer<typeof citationSchema>;

export const fileEvidenceSchema = z.object({
  id: z.string().regex(/^ev_[a-f0-9]{64}$/),
  citation: citationSchema,
  kind: z.string().min(1),
  observation: z.record(z.unknown()),
  extractor: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    model: z.string().optional(),
    promptVersion: z.string().optional(),
    analysisId: z.string().optional(),
  }),
  confidence: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  state: z.enum(["ACTIVE", "STALE", "ORPHANED", "INVALIDATED"]),
  recordedAt: z.string().datetime(),
});
export type FileEvidence = z.infer<typeof fileEvidenceSchema>;

export const fileClaimSchema = z.object({
  id: recordKeySchema,
  feature: recordKeySchema,
  predicate: z.string().min(1),
  object: z.unknown(),
  evidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{64}$/)).min(1),
  state: z.enum(["ACTIVE", "NEEDS_REVIEW", "SUPERSEDED"]),
  supersedes: recordKeySchema.optional(),
  recordedAt: z.string().datetime(),
});
export type FileClaim = z.infer<typeof fileClaimSchema>;

export const sourceSchema = z.object({ id: z.string().min(1), root: z.string().min(1), type: z.string().min(1) });
export type Source = z.infer<typeof sourceSchema>;

export const profileEntrySchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  citations: z.array(citationSchema).min(1),
});
export const profileSchema = z.object({
  status: z.enum(["PROPOSED", "APPROVED"]),
  entries: z.array(profileEntrySchema).default([]),
  updatedAt: z.string().datetime(),
});
export type ProjectProfile = z.infer<typeof profileSchema>;

export const coverageSections = ["product", "design", "api", "implementation", "navigation"] as const;
export const coverageSectionSchema = z.enum(coverageSections);
export type CoverageSection = z.infer<typeof coverageSectionSchema>;

export const coverageStatuses = ["ANALYZED", "UNKNOWN", "NOT_APPLICABLE", "SOURCE_UNAVAILABLE"] as const;
export const coverageStatusSchema = z.enum(coverageStatuses);
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;

const analysisCoverageSchema = z
  .object({
    section: coverageSectionSchema,
    status: coverageStatusSchema,
    reason: z.string().min(1).optional(),
    evidenceKeys: z.array(z.string().min(1)).default([]),
  })
  .superRefine((coverage, context) => {
    if (
      (coverage.status === "ANALYZED" || coverage.status === "NOT_APPLICABLE") &&
      coverage.evidenceKeys.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Coverage status '${coverage.status}' requires supporting evidence.`,
      });
    }
    if (coverage.status !== "ANALYZED" && !coverage.reason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Coverage status '${coverage.status}' requires a reason.`,
      });
    }
  });

const analysisEvidenceSchema = z.object({
  key: recordKeySchema,
  citation: citationSchema,
  kind: z.string().min(1),
  observation: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
});

const analysisClaimSchema = z.object({
  id: recordKeySchema,
  predicate: z.string().min(1),
  object: z.unknown(),
  evidenceKeys: z.array(z.string().min(1)).min(1),
  supersedes: recordKeySchema.optional(),
});

const analysisFeatureSchema = z
  .object({
    key: recordKeySchema,
    displayName: z.string().min(1).optional(),
    coverage: z.array(analysisCoverageSchema),
    evidence: z.array(analysisEvidenceSchema),
    claims: z.array(analysisClaimSchema),
  })
  .superRefine((feature, context) => {
    const sections = feature.coverage.map((item) => item.section);
    for (const section of coverageSections) {
      if (!sections.includes(section)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Coverage section '${section}' is required.` });
      }
    }
    if (new Set(sections).size !== sections.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Coverage sections must be unique." });
    }

    const evidenceKeys = feature.evidence.map((item) => item.key);
    if (new Set(evidenceKeys).size !== evidenceKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Evidence keys must be unique within a feature." });
    }
    const knownEvidence = new Set(evidenceKeys);
    for (const item of feature.coverage) {
      for (const key of item.evidenceKeys) {
        if (!knownEvidence.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Coverage references unknown evidence '${key}'.`,
          });
        }
      }
    }
    for (const claim of feature.claims) {
      for (const key of claim.evidenceKeys) {
        if (!knownEvidence.has(key)) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: `Claim references unknown evidence '${key}'.` });
        }
      }
    }
  });

/** One project-wide AI proposal. The CLI validates citations and applies it only with human confirmation. */
export const analysisBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    repository: z.object({
      revision: z.string().min(1),
      dirtyFingerprint: z.string().min(1).optional(),
    }),
    extractor: z.object({
      id: z.string().min(1),
      version: z.string().min(1),
      model: z.string().optional(),
      promptVersion: z.string().optional(),
    }),
    filesRead: z.array(z.object({ sourceId: z.string().min(1), path: z.string().min(1) })).default([]),
    excluded: z.array(z.string().min(1)).default([]),
    profile: z.object({ entries: z.array(profileEntrySchema) }).optional(),
    features: z.array(analysisFeatureSchema),
  })
  .superRefine((bundle, context) => {
    const featureKeys = bundle.features.map((feature) => feature.key);
    if (new Set(featureKeys).size !== featureKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Feature keys must be unique within a bundle." });
    }
  });
export type AnalysisBundle = z.infer<typeof analysisBundleSchema>;

export const featureCoverageRecordSchema = z.object({
  feature: z.string().min(1),
  displayName: z.string().min(1),
  analysisId: z.string().min(1),
  sections: z.array(
    z.object({
      section: coverageSectionSchema,
      status: coverageStatusSchema,
      reason: z.string().min(1).optional(),
      evidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{64}$/)),
    }),
  ),
  updatedAt: z.string().datetime(),
});
export type FeatureCoverageRecord = z.infer<typeof featureCoverageRecordSchema>;
