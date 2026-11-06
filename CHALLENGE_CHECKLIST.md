# Total Recall checklist → evidence

## Submission requirements
| Requirement | Where |
| --- | --- |
| Walrus Memory integrated and writing on Mainnet | `packages/memory` (relayer `relayer.memory.walrus.xyz`), worker memory writer; `/proof`; `pnpm verify:onchain` |
| Tatum RPC used for onchain data | `packages/chain/src/tatum-grpc.ts`, `tatum-graphql.ts`, `tatum-data.ts`; live call log on `/proof` |
| At least 10 memories stored on Mainnet | `pnpm verify:onchain` (counts Blob objects tagged with our delegate key) |
| Published blog post | linked from the README |
| Working demo and public repo | [quits-eight.vercel.app/demo](https://quits-eight.vercel.app/demo), this repo |

## Judging criteria
| Criterion | What to look at |
| --- | --- |
| Walrus and Tatum integration (30%) | Rules are read back from Walrus at every decision and cited by blob (`packages/service/src/learned.ts`); rebuild-from-Walrus; member-owned memory; on-chain memory receipts. Tatum: gRPC for every read, simulate and execute; filtered checkpoint stream; GraphQL; exchange-rate API for every non-USD bill; the contract was published through Tatum |
| Technical quality, Tatum Sui RPC (30%) | Native gRPC transport (the default gRPC-web transport fails against the gateway), rate-limit budget with safe 429 retry, typed errors; 23 Move tests, 172 TypeScript tests (156 offline + 16 against localnet or live services), plus `scripts/smoke-wallet.ts` (20 checks on mainnet with fresh wallets); `pnpm verify:onchain` |
| Creativity (20%) | Memory as the group's unwritten rules; one-off facts vs habits; a member's memory follows them to the next group; an agent that pays only what the chain lets it |
| Presentation (20%) | README, [JUDGES.md](JUDGES.md), live demo without sign-in, `/proof`, video |

## Awards
| Award | Evidence |
| --- | --- |
| Best Walrus Memory: "memories that visibly change the product" | Every proposal shows the memories that changed it; day-one vs today replay on the Rules page; memory-off ablation in the benchmark's first run (16.7% vs 90.0% right the first time); on fresh bills, members' own rules carried into a new group lift its first week from 50% to 70% right |
| Best Use of Agent Payments: x402 or MPP settled on Sui | Every debt is an x402 `exact` resource on `sui:mainnet` with an MPP `sui` challenge (`packages/pay`); agent payments through `quits::settle` + `0x2::allowance`; mainnet digests in [PROOF.md](PROOF.md) |
