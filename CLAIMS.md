# Claims and how to check them

**VERIFIED-LIVE**: you can see it on mainnet or in the running app right now. **REPRODUCIBLE**: a command in this repo produces it. **MODELED**: measured on simulated data. **NOT-CLAIMED**: we are not saying it.

| Claim | Tier | Check |
| --- | --- | --- |
| The settlement contract is live on Sui mainnet and names our agent and registrar | VERIFIED-LIVE | `pnpm verify:onchain`, [PROOF.md](PROOF.md) |
| A member paid a debt over x402 with a gasless USDC transfer on mainnet | VERIFIED-LIVE | PROOF.md → Payments |
| A member signed in with their own wallet, paid a debt over x402 and signed an auto-settle mandate, all on mainnet | VERIFIED-LIVE | PROOF.md → Payments; rerun `scripts/smoke-wallet.ts` (fresh wallets, 18 checks) |
| An agent paid a debt from a member's Sui Allowance, only through `quits::settle` | VERIFIED-LIVE | PROOF.md; Move tests `move/quits/tests` |
| The contract refuses a wrong amount, a non-agent spender, a second payment, a debt to an unlisted person, a pull inside the objection window, an over-cap pull | REPRODUCIBLE | `pnpm move:test` (23 tests) |
| Every split decision reads its rules back from Walrus Memory and cites the blob | VERIFIED-LIVE | any proposal's "why" chips; `packages/service/src/learned.ts` |
| Over 10 Walrus Memory memories exist on mainnet, each a Blob object tagged with our delegate key | VERIFIED-LIVE | `pnpm verify:onchain` |
| The rule index can be rebuilt from Walrus alone | REPRODUCIBLE | Rules page → Rebuild; `packages/service/test/learning.test.ts` |
| All Sui reads and writes go through Tatum (gRPC, GraphQL) and bills are priced with Tatum's exchange-rate API | VERIFIED-LIVE | `/proof` call log; `packages/chain/src`. If the gateway refuses for credits, calls fall back to the public fullnode and `/proof` lists them separately (`packages/chain/test/fallback.test.ts`) |
| Direct USDC transfers between members are matched to open debts from Tatum's checkpoint stream | REPRODUCIBLE | `apps/worker/test/watcher.test.ts`; off in the hosted demo to save gateway credits (`QUITS_CHECKPOINT_STREAM=on`) |
| On bills nothing in Quits was tuned on, Quits is right the first time as often as an LLM given the whole history (90.0% each, same number of corrections), misallocates slightly less money, and uses about 40× fewer model tokens and answers about 50× faster | MODELED | README → Does it actually learn? (rendered from `eval/results/*-fresh-cents.json`); `pnpm eval --seed=20261108` |
| After its first week in a group, Quits got every benchmark bill right the first time | MODELED | same run, by-week table |
| A member's own rules follow them into a new group: the trip's first week goes from 50% to 70% right | MODELED | same run, "Memory that follows people"; `--scenarios=trip-after-flat` |
| Even splits misallocate about $3,000 over a month across the three benchmark groups | MODELED | same run |
| A memory can live in the member's own Walrus Memory account | REPRODUCIBLE | `/me` → Own your memory; `setOwnMemoryAccount` |
| Quits is more accurate than an LLM given the full history | NOT-CLAIMED | on fresh bills they tie on first-try accuracy and corrections; Quits is ahead on money misallocated, cost and speed. Every run, including the ones it lost, is listed in the README |
| Memories are private from the memory relayer | NOT-CLAIMED | the hosted relayer sees plaintext before it encrypts |
| Memories last forever | NOT-CLAIMED | Walrus blobs expire after a few epochs; no renewal yet |
| Sign-in with Google (zkLogin) | NOT-CLAIMED | sign-in is by wallet signature (Slush or any Sui wallet) |
