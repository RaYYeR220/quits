# Claims and how to check them

**VERIFIED-LIVE**: you can see it on mainnet or in the running app right now. **REPRODUCIBLE**: a command in this repo produces it. **MODELED**: measured on simulated data. **NOT-CLAIMED**: we are not saying it.

| Claim | Tier | Check |
| --- | --- | --- |
| The settlement contract is live on Sui mainnet and names our agent and registrar | VERIFIED-LIVE | `pnpm verify:onchain`, [PROOF.md](PROOF.md) |
| A member paid a debt over x402 with a gasless USDC transfer on mainnet | VERIFIED-LIVE | PROOF.md → Payments |
| An agent paid a debt from a member's Sui Allowance, only through `quits::settle` | VERIFIED-LIVE | PROOF.md; Move tests `move/quits/tests` |
| The contract refuses a wrong amount, a non-agent spender, a second payment, a debt to an unlisted person, a pull inside the objection window, an over-cap pull | REPRODUCIBLE | `pnpm move:test` (23 tests) |
| Every split decision reads its rules back from Walrus Memory and cites the blob | VERIFIED-LIVE | any proposal's "why" chips; `packages/service/src/learned.ts` |
| Over 10 Walrus Memory memories exist on mainnet, each a Blob object tagged with our delegate key | VERIFIED-LIVE | `pnpm verify:onchain` |
| The rule index can be rebuilt from Walrus alone | REPRODUCIBLE | Rules page → Rebuild; `packages/service/test/learning.test.ts` |
| All Sui reads and writes go through Tatum (gRPC, GraphQL) and bills are priced with Tatum's exchange-rate API | VERIFIED-LIVE | `/proof` call log; `packages/chain/src` |
| Direct USDC transfers between members are matched to open debts from Tatum's checkpoint stream | REPRODUCIBLE | `apps/worker/test/watcher.test.ts`; worker log |
| Quits is right the first time on 90.0% of bills vs 89.2% for an LLM given the whole history, with 32× fewer tokens and 38× faster | MODELED | `pnpm eval`, [eval/README.md](eval/README.md) (not held out; see its changelog) |
| Even splits misallocate $3,110 over a month in the benchmark | MODELED | same |
| A memory can live in the member's own Walrus Memory account | REPRODUCIBLE | `/me` → Own your memory; `setOwnMemoryAccount` |
| Quits is clearly more accurate than an LLM given the full history | NOT-CLAIMED | first-try accuracy ties on the flat and the trip (87.5% each); Quits is ahead on the couple (95% vs 92.5%) and on corrections everywhere |
| Memories are private from the memory relayer | NOT-CLAIMED | the hosted relayer sees plaintext before it encrypts |
| Memories last forever | NOT-CLAIMED | Walrus blobs expire after a few epochs; no renewal yet |
| Sign-in with Google (zkLogin) | NOT-CLAIMED | wallet sign-in only |
