# Submission package — Sealgate (for the team lead)

Deadline: **2026-11-14 23:59 UTC = 2026-11-15 08:59 JST**. Planned submission: **Nov 13**.
Judging: Nov 16–18. Keep the verifier page and testnet contract live until ≥ Nov 25.

## Form fields (prepared)

| Field | Value |
|---|---|
| Project name | Sealgate |
| Team lead | _(TIK: your name)_ |
| Team lead email | _(TIK: your email — max 2 submissions per email)_ |
| Tracks | Agent Economy · AI Security & Defense · Privacy & Private AI |
| Repository | https://github.com/ghost-maru/sealgate (public) |
| Demo / verifier | https://ghost-maru.github.io/sealgate/ (GitHub Pages, from /docs) |
| Contract (testnet) | `app2.sealgate-ghost.testnet` |
| Payout NEAR mainnet address | _(TIK: create a mainnet account and fill this in — prizes are paid in NEAR to this address)_ |
| Demo post | _(the X post URL, after posting)_ |

One-shot submission, no edits. Corrections go through nearhackathon.com/request-changes.

## X post (draft — post personally; the account must be yours)

Post 1:
> We built Sealgate for the NEAR Hackathon: escrow for agent commerce where payment
> is released by a TEE-signed AI inspection — and the work product never touches the
> chain. Claims are optimistic, the signed response is encrypted for the two parties,
> and appeals re-judge privately under a clear-error standard.

Post 2 (reply):
> Live on testnet: app2.sealgate-ghost.testnet
> Verify an escrow yourself: ghost-maru.github.io/sealgate
> Code + full security model (including what it does *not* prove):
> github.com/ghost-maru/sealgate

If the 30-second animation is attached, attach it to Post 1.

## TIK checklist

- [ ] Create a NEAR **mainnet** account (any wallet; e.g. MyNearWallet) — the account
      id goes in the form as the payout address. No funds needed.
- [ ] Revive the X account signup (rtformaru@gmail.com; the earlier attempt was
      soft-blocked on the web — the phone app usually passes device checks).
      Username candidates: ghost_maru / ghostmaru / ghost_maru_jp.
- [ ] Nov 13: post the demo posts above (edit freely).
- [ ] Nov 13: submit the form with Ghost, using the fields above.
- [ ] Keep nothing else pending: repo, verifier page, contract, and README are
      already live and need no action.

## Ghost checklist (done before Nov 13)

- [x] Contract deployed + 4 live escrow flows (happy path, appeal upheld,
      encrypted flow, panel appeal)
- [x] 33 unit tests green (state machine / integrity vs real TEE fixtures /
      encryption / panel)
- [x] README with security model, limitations, AI-use disclosure
- [x] Verifier page (docs/index.html → GitHub Pages)
- [ ] Public GitHub repo pushed, Pages enabled
- [ ] Final README pass: confirm repo/Pages URLs resolve
