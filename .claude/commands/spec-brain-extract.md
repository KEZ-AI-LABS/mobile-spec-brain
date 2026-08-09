---
description: Read a code scope and produce a cited Mobile Spec Brain extraction proposal
argument-hint: <scope-path> [what to look for]
allowed-tools: Bash(spec-brain:*), Bash(npx spec-brain:*), Read, Glob, Grep, Write
---

Produce a Mobile Spec Brain extraction proposal for scope `$1`.

## Rules

1. **Never write a `contentHash` yourself.** You cannot compute SHA-256. Get every citation by running:

   ```
   spec-brain cite <path> <start-line> <end-line>
   ```

   Copy the returned `citation` object verbatim into the proposal. If the command errors, fix the range — do not
   work around it.

2. **Cite the narrowest range that carries the observation.** An annotation and its function signature, not the
   whole file. Wide ranges go stale on unrelated edits and create review noise.

3. **Observe, do not conclude.** `observation` records what the cited lines say. Whether that is the team's intended
   contract is a claim, and claims are a separate human decision. Write `{"httpMethod": "POST", "path": "/api/v2/transfers"}`,
   not `{"isCorrect": true}`.

4. **Never guess.** If you cannot cite it, leave it out. An unstated fact becomes an explicit unknown downstream,
   which is the correct outcome. An invented one is rejected by the CLI and wastes a round trip.

5. **`kind` is open vocabulary.** Use a stable, descriptive slug (`retrofit-endpoint`, `navigation-route`,
   `compose-screen`). Reuse the kinds already present in `.spec-brain/concepts.json` before inventing a new one.

6. **Set `confidence` honestly.** It is your extraction confidence, not the importance of the finding. A clear
   annotation is 0.95; an inference from a naming convention is 0.5 and probably should not be recorded at all.

## Steps

1. Read `.spec-brain/concepts.json` and `.spec-brain/profile.json` for existing vocabulary and project conventions.
2. Explore `$1`. If the user gave a second argument, narrow to that.
3. For each finding, run `spec-brain cite` to get its citation.
4. Write `proposal.json`:

   ```json
   {
     "extractor": { "id": "claude-code", "version": "1", "model": "<model>", "promptVersion": "1" },
     "observations": [
       {
         "citation": { "...": "verbatim from spec-brain cite" },
         "kind": "<slug>",
         "observation": { "...": "open fields" },
         "extractor": { "id": "claude-code", "version": "1" },
         "confidence": 0.95,
         "authority": 0.6
       }
     ]
   }
   ```

5. Run `spec-brain extract --scope $1 --file proposal.json`.
6. Report what was recorded, what was reused, and anything you deliberately left out for lack of a citation.

Keep a proposal under a few hundred observations; the CLI caps a single extraction at 1000.
