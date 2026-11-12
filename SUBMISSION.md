# Submission package — Sealgate (for the team lead)

Deadline: **2026-11-14 23:59 UTC = 2026-11-15 08:59 JST**. Planned submission: **Nov 13**.
Judging: Nov 16–18. Keep the verifier page and testnet contract live until ≥ Nov 25.

## Form fields (prepared)

| Field | Value |
|---|---|
| Project name | Sealgate |
| Team lead | _(TIK: your name)_ |
| Team lead email | _(TIK: your email — max 2 submissions per email)_ |
| Team size | _(TIK: pick `1` — human headcount; Ghost is the AI builder)_ |
| Tracks (API ids) | `agents` · `security` · `privacy` |
| Repository | https://github.com/ghost-maru/sealgate (public) |
| Demo / verifier | https://ghost-maru.github.io/sealgate/ (GitHub Pages, from /docs) |
| Contract (testnet) | `app2.sealgate-ghost.testnet` |
| Payout NEAR mainnet address | `bestvinegar7527.near` (created by TIK 2026-11-08 via Meteor Wallet; existence verified on mainnet) |
| Demo post | _(the X post URL, after posting)_ |
| Idea text (20–2000 chars) | _(drafted in the submission payload Ghost prints for your confirmation — platform framing: judge-AI infrastructure, sealed records, one appeal, open jobs, adjudication case type, 1% fee)_ |

Submission channel: the official API (`POST https://nearhackathon.com/api/applications`)
or the web form at nearhackathon.com/#apply — same fields. Per the official
HACKATHON.md, Ghost prints the full JSON payload, TIK confirms it verbatim
(including the consent sentence), and only then is it sent. One-shot, no edits;
corrections go through nearhackathon.com/request-changes. Never add a `website`
field (spam trap — a non-empty value rejects the submission).

## X demo post (TIK posts personally — the rules require the human to write and publish it)

Official requirements (HACKATHON.md §2): the post must (1) say the project was
built at NEAR HACKATHON, (2) tag **@NEARProtocol** and **#NEARHackathon**
(@NearLegion / @NearBuilders optional), (3) have the **demo video or screenshots
attached**. Ghost may draft the text; TIK publishes it and provides the link.

Post 1 (264 chars as counted by X, attach the demo video or screenshots here):
> We built a court for the agent economy at #NEARHackathon. Sealgate is a
> judge-AI platform on @NEARProtocol: a TEE-signed AI judge decides over a
> sealed record, one appeal under a clear-error standard, money settles for a
> 1% fee. The record never touches the chain.

Post 2 (reply, 258 chars — the use cases):
> What it's for: escrow that releases on inspection · a bounty market where
> anyone can claim a public job · appeals of platform decisions (a
> marketplace's payout withholding was judged on a sealed record) · grant
> milestone evaluation. 25 live cases on testnet.

Post 3 (reply, 225 chars — verify + reproduce):
> Verify it yourself: https://ghost-maru.github.io/sealgate/ rebuilds a
> signed judgment from the record and checks the TEE signature in your
> browser. One command reproduces everything: node scripts/reproduce.mjs.
> Code: https://github.com/ghost-maru/sealgate

Attachment for Post 1: `video/sealgate-demo-v3.mp4` (103s, captioned, quiet
audio bed; the platform story — judge platform → use cases → the live
demonstrations #18/#19/#20 plus the classic forgery/appeal flows). Fallback:
screenshots of the verifier page running escrow #2 to a green result (Ghost
captures these on submission day, after re-publication), or the 30-second
concept animation.

## TIK checklist

- [ ] **FIRST, before anything else on submission day: make the repo public again.**
      The repo was set to private on Nov 7 (anti-copy measure). GitHub: repo Settings →
      Danger Zone → Change visibility → Public. Then Ghost verifies:
      (1) https://github.com/ghost-maru/sealgate returns 200 unauthenticated,
      (2) https://ghost-maru.github.io/sealgate/ serves the verifier again
      (Pages may need its setting re-saved after re-publication).
      **Do not submit the form before this check passes — a private repo = ineligible.**
- [x] NEAR **mainnet** account created (2026-11-08): **bestvinegar7527.near**
      (Meteor Wallet; existence verified on mainnet; entered in the form values
      above as the payout address; no funds needed. MyNearWallet was avoided —
      it was deprecated on 2026-10-31 and is migration/recovery-only. The
      12-word recovery phrase stays with TIK offline.)
- [x] X account created (2026-11-08, front-loaded): **@Stacked_Ghost**
      (rtformaru@gmail.com). Only the demo posts remain for submission day.
- [ ] Nov 13: post the demo posts above from @Stacked_Ghost, with the video or
      screenshots attached (the post is yours to publish — Ghost cannot post it).
- [ ] Nov 13: submission with Ghost — Ghost prints the full payload, you confirm
      it (including the consent sentence read verbatim), then it is sent once.
- [ ] Keep nothing else pending: repo, verifier page, contract, and README are
      already live and need no action.

## Ghost checklist (done before Nov 13)

- [x] Contract deployed + 25 live escrow flows (#0 happy path · #1 appeal upheld ·
      #2 encrypted · #3 panel appeal · #4 forgery detected/voided · #5 MCP-driven ·
      #6 salted judgment task · #7 appeal on realistic input, upheld ·
      #8 post-redesign forgery: race-post rejected, executor VOID ·
      #9 two independent agent processes, sealed handoffs ·
      #10 post-round-2-fix forgery: tampered bundle refused, executor VOID ·
      #11 salt-shift refused + VOID · #12 undecryptable claim VOID (claimant-side) ·
      #13 forgery VOID with on-chain ack ·
      #14 withheld deliverable VOID/FAIL (worker-side record failure) ·
      #15 forgery VOID, record recovered from the on-chain ciphertext ·
      #16 two-agents demo re-run after the round-4 changes ·
      #17 worker's appeal of its own broken ciphertext refused pre-ack, unacked lapse ·
      #18 v3 open job: posted unclaimed, claimed, PASS, 1% fee ·
      #19 v3 adjudication: payout-withholding appeal, seller wins, appeal upheld ·
      #20 v3 adjudication: grant milestone FAIL, grantee appeal upheld ·
      #21 v4 non-default terms (bond 20%, W 2h, W1 45min): FAIL upheld on
      appeal, appeal fee 0.01 to the executor ·
      #22 v4 open job under a 250 bps fee schedule: PASS settled at 2.5%)
- [x] v3 generalization (2026-11-10): platform fee sink live on-chain
      (sealgate-ghost.testnet; exactly 0.044 NEAR accrued over #18–#24),
      open jobs + claim flow, adjudication case type fixed on-chain,
      Opus design review's must-fixes M1–M6 applied before building
- [x] v4 parameterization (2026-11-10): per-escrow terms (bond rate/floor,
      windows) inside hardcoded constitutional bounds; fee as a registered
      (sink, bps) schedule snapshotted per escrow with creator slippage
      protection; executor-declared W1 range, creation refuses undeclared;
      appeal fee to the executor on posted L1s; terms hash required on
      claim/register (consent); Opus design + mechanism + 2 diff reviews,
      converged (fatal 0, high 0)
- [x] Appellate executor live: appeal.sealgate-ghost.testnet registered on-chain;
      L1 claims accepted from the executor only (contract-enforced)
- [x] 71 unit tests green (state machine incl. open jobs + fee + terms /
      integrity vs real TEE fixtures / encryption / panel / receipts /
      fixed-vector terms hashes from live escrows #21/#22);
      exhaustive state-space check 5,710 states over 5 parameter regimes,
      all invariants held; reproduce.mjs ALL CHECKS PASSED (25 escrows,
      deployed code hash H8rAdtiL…TG2q22 after the v5 storage-economics redeploy)
- [x] Fable 5.2 full independent review (2026-11-10): fatal 0 / high 0;
      blockers B1 (fresh-clone test failure — fixtures vendored) and the
      medium batch (contract argument-shape validation vs storage bloat,
      verifier-site XSS escaping + Buffer removal, receipt live-registry
      check, inspect registry/phase guards, records/16 repair) fixed and
      re-verified; contract storage cover topped up on app2
- [x] README with security model, limitations, AI-use disclosure
- [x] Verifier page (docs/index.html → GitHub Pages)
- [x] LICENSE file added (all-rights-reserved wording, per the anti-copy call;
      Q-014 requires a LICENSE file, any license — swap to MIT in one step if
      TIK prefers)
- [x] Initial push done (commit 8435bce); repo set back to private on Nov 7
- [ ] Submission day: re-publish repo (+ push the local commits since Nov 7),
      verify Pages, capture verifier screenshots for the demo post
