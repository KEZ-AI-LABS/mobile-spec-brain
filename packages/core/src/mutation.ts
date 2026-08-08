import { z } from "zod";

export const allowedMutationSchema = z.enum(["spec.propose", "spec.supersede", "spec.deprecate", "spec.setValidity", "evidence.link", "evidence.invalidate", "decision.mark", "conflict.resolve"]);
export const mutationProposalSchema = z.object({
  id: z.string().min(1),
  operation: allowedMutationSchema,
  actor: z.string().min(1),
  entityId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
  payload: z.record(z.unknown()),
});
export type MutationProposal = z.infer<typeof mutationProposalSchema>;

export interface MutationPolicy { allowedActors: readonly string[]; minimumEvidence: number; }
export function validateMutation(proposal: unknown, policy: MutationPolicy): MutationProposal {
  const parsed = mutationProposalSchema.parse(proposal);
  if (!policy.allowedActors.includes(parsed.actor)) throw new Error(`Actor '${parsed.actor}' is not allowed to mutate.`);
  if (parsed.evidenceIds.length < policy.minimumEvidence) throw new Error("No evidence, no mutation.");
  return parsed;
}
