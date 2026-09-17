# Spike note: LI.FI quote check on Robinhood Chain (4663)

Script: `scripts/spike/lifi-quote-test.ts`
Run: `npm run spike:lifi-quote`

## Result of the run attempted inside the assistant's sandbox

FAIL — not informative about Robinhood Chain or LI.FI. The sandbox's own
network egress proxy blocks the `li.quest` and RPC hosts outright
(`x-deny-reason: host_not_allowed`), so both the RPC chain-id check and the
LI.FI registry fetch were rejected before ever reaching the real services.
Full raw evidence: `reports/lifi-quote-result.json`.

This confirms the script surfaces raw failures instead of swallowing them —
it does not confirm anything about whether LI.FI actually supports chain 4663.

## What's needed next

Run `npm run spike:lifi-quote` from a machine with normal outbound internet
access (not this assistant's sandbox), with `ROBINHOOD_RPC_URL` set, and
paste back:
- full stdout
- contents of `reports/lifi-quote-result.json`
