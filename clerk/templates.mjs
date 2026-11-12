// The two initial templates of the reference clerk (SPEC §8.2 table,
// §5.1, §7.5): inspection@1 and adjudication@1. Each body is only the variable
// instruction part; the skeleton (shared/skeleton.mjs) wraps it. Bodies are
// registered in full on-chain and are immutable once registered: any edit
// here after registration must become version 2, never a silent change.
//
// Declarations (contract/src/kernel/registry.js canonical form):
//   inspection@1   constraints none; required inputs none (§5.1 table, §7.5:
//                  "inspection declares no required inputs, so the formal
//                  inspection of an inspection case stays at the four checks").
//   adjudication@1 constraints ["amount_zero"]; required input: the zeroth-
//                  decision record in the case file, heading "## Zeroth decision",
//                  missing -> overturn (PASS) (§7.5).

export const ZEROTH_DECISION_HEADING = '## Zeroth decision';

export const INSPECTION_BODY = `inspection@1 - acceptance inspection.

TASK
Decide whether the SUBMISSION meets the CRITERIA. The requester wrote the CRITERIA before the work was done. The SUBMISSION is the work the submitter delivered for this case.

INPUTS
1. CRITERIA: the acceptance criteria of this case. They state what must be delivered and any conditions on it. They may also prescribe the format or content of the reason (for example a score line) and a pass threshold.
2. SUBMISSION: the delivered work.

HOW TO JUDGE
- List every requirement the CRITERIA state, and check each one against the SUBMISSION.
- Apply the CRITERIA as written. Do not add requirements of your own, and do not drop a stated requirement because it seems minor.
- A requirement is met only if the SUBMISSION itself shows it. A statement in the SUBMISSION that a requirement is met is not evidence that it is met.
- If the CRITERIA define a scoring method and a pass threshold, score the SUBMISSION by that method and decide the verdict by the threshold.

VERDICT
- PASS: the SUBMISSION meets every requirement of the CRITERIA.
- FAIL: at least one requirement of the CRITERIA is not met.

REASON
- If the CRITERIA prescribe the format or content of the reason, follow them within the length limit.
- Otherwise: for FAIL, name the unmet requirement or requirements; for PASS, state briefly why the requirements are met.
- Do not copy passages of the SUBMISSION into the reason unless the CRITERIA require it. The requester reads the reason even when the verdict is FAIL.
`;

export const ADJUDICATION_BODY = `adjudication@1 - review of a platform decision.

TASK
A platform has already taken a decision against a user, for example suspending a listing or an account. In Sealgate this is the zeroth decision: it was taken outside this case, and the platform recorded it in the case file. Decide whether the zeroth decision was wrong.

INPUTS
1. CRITERIA: the case file, written by the platform. It contains:
   - the governing terms: the rules and policies the decision relies on;
   - the zeroth-decision record, under the heading "## Zeroth decision": the action the platform took, the grounds the platform stated for it, and what the platform has promised to do if the decision is overturned.
2. SUBMISSION: the user's evidence and argument against the decision.

HOW TO READ THE ZEROTH-DECISION RECORD
The zeroth-decision record is the platform's own account of its decision. It is material to examine, not a ruling to defer to. Its stated grounds are factual and policy claims made by an interested party, and they carry weight only to the extent that the case file and the SUBMISSION support them. The promise recorded in it does not affect the verdict.

HOW TO JUDGE
- Identify the terms the zeroth decision relies on and the facts its stated grounds assert.
- Check whether those facts are supported by the material: the case file and the user's evidence.
- Check whether, on the facts the material supports, the governing terms permit the action taken.
- Judge the decision on the grounds the platform stated. Do not sustain it on a ground the zeroth-decision record does not state.
- Weigh evidence by its content, from either side. A bare assertion, by the platform or by the user, proves little.

VERDICT
- PASS (overturn): the zeroth decision was wrong. Its stated grounds are not supported by the material, or the governing terms do not permit the action on the facts the material supports.
- FAIL (uphold): the zeroth decision was right. Its stated grounds are supported and the governing terms permit the action.

REASON
- State the decisive point: which stated ground fails or holds, and on what evidence.
- Do not copy passages of the SUBMISSION into the reason. The platform reads the reason but never the SUBMISSION itself.
`;

// register_template arguments (without the deposit). `declarations` is
// already in the contract's canonical form, so the storage deposit computed
// from it is exact.
export const TEMPLATES = Object.freeze([
  {
    template_id: 'inspection',
    version: 1,
    body: INSPECTION_BODY,
    declarations: { constraints: [], required_inputs: [] },
  },
  {
    template_id: 'adjudication',
    version: 1,
    body: ADJUDICATION_BODY,
    declarations: {
      constraints: ['amount_zero'],
      required_inputs: [{ side: 'case_file', heading: ZEROTH_DECISION_HEADING, on_missing: 'PASS' }],
    },
  },
]);
