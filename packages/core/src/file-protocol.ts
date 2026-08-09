import { z } from "zod";

export const citationSchema = z.object({ sourceId: z.string().min(1), path: z.string().min(1), range: z.tuple([z.number().int().positive(), z.number().int().positive()]), contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), revision: z.string().min(1) }).refine((value) => value.range[0] <= value.range[1], "Citation range must be ordered.");
export const fileEvidenceSchema = z.object({ id: z.string().regex(/^ev_[a-f0-9]{64}$/), citation: citationSchema, kind: z.string().min(1), observation: z.record(z.unknown()), extractor: z.object({ id: z.string().min(1), version: z.string().min(1), model: z.string().optional(), promptVersion: z.string().optional() }), confidence: z.number().min(0).max(1), authority: z.number().min(0).max(1), state: z.enum(["ACTIVE", "STALE", "ORPHANED", "INVALIDATED"]), recordedAt: z.string().datetime() });
export type FileEvidence = z.infer<typeof fileEvidenceSchema>;

export const fileClaimSchema = z.object({ id: z.string().min(1), feature: z.string().min(1), predicate: z.string().min(1), object: z.unknown(), evidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{64}$/)).min(1), state: z.enum(["ACTIVE", "NEEDS_REVIEW", "SUPERSEDED"]), supersedes: z.string().optional(), recordedAt: z.string().datetime() });
export type FileClaim = z.infer<typeof fileClaimSchema>;

export const sourceSchema = z.object({ id: z.string().min(1), root: z.string().min(1), type: z.string().min(1) });
export const profileSchema = z.object({ status: z.enum(["PROPOSED", "APPROVED"]), entries: z.array(z.object({ key: z.string().min(1), value: z.unknown(), evidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{64}$/)).min(1) })).default([]), updatedAt: z.string().datetime() });
export type ProjectProfile = z.infer<typeof profileSchema>;
