# Quits

**The group tab that learns your unwritten rules, and settles itself.**

<!-- headline:start -->
In a month of simulated group bills, even splits put **$3,008.16** in the wrong pocket. After its first week, Quits split 90 of 90 bills right the first time, using 39× fewer model tokens than an LLM re-reading the group's history. [How we measured](#does-it-actually-learn)
<!-- headline:end -->

Every group has rules nobody wrote down. Ana doesn't drink. Ben always gets the taxi. Rent goes by room size, and Dan isn't on the Netflix account. Split apps make you re-enter that every single time, or they split evenly and quietly overcharge someone.

Quits remembers. You log a bill in plain words; Quits proposes who owes what and shows you why ("remembered Oct 14: Ana doesn't drink"). Correct it once and it's a memory the member owns, stored on Walrus, applied to every bill after, in every group they're in. Debts settle in USDC on Sui: in one tap, or by your agent, inside limits the chain enforces.

**Live:** [quits-eight.vercel.app](https://quits-eight.vercel.app) · [Try the demo, no sign-in](https://quits-eight.vercel.app/demo) · [Proof page](https://quits-eight.vercel.app/proof) · Telegram [@quits_tab_bot](https://t.me/quits_tab_bot) · [Reviewer guide](JUDGES.md)

## What it does

1. **Log it in plain words.** "412 zł dinner at Pod Baranami, Clara paid, 140 of it was wine." Quits reads the payer, the currency (priced to USDC through Tatum's exchange-rate API), and the line items.
2. **Correct it once.** "Ana doesn't drink." The correction becomes a typed rule and a Walrus Memory memory. A one-off fact ("Dan wasn't there tonight") fixes that bill and teaches nothing.
3. **Settle in one tap, or let your agent do it.** Every debt is an [x402](https://x402.org) resource (and an MPP challenge) settled in USDC on Sui mainnet. Turn on auto-settle and your agent pays from a Sui Allowance: only the exact debt, only to people in the group, never more than the weekly limit you signed, with a window to object first. The Move contract enforces each of those, not our server.

<p>
  <img src="docs/img/proposal.jpg" width="49%" alt="A bill split in the app: the beer is taken off Ana's share, and the card names the memory that did it, learned Oct 14, stored on Walrus, with its blob id">
  <img src="docs/img/settle.jpg" width="49%" alt="Settle up: the debt answers 402 Payment required with the exact USDC amount on sui:mainnet, then 200 Paid with the transaction digest">
</p>

Left: the split names the memory that changed it, with its Walrus blob. Right: a debt is an x402 resource; paying it is a gasless USDC transfer on Sui mainnet, with the digest.

## Does it actually learn?

<!-- results:start -->
Three simulated groups (a flat of four, a trip of five, a couple), four weeks, 40 bills each, mercury-3. A simulated member corrects a wrong split in plain words, up to twice per bill. "Right" means every share within $0.01. These bills come from seed 20261108, which nothing in Quits was tuned on. Method and caveats: [eval/README.md](eval/README.md).

| | Right the first time | Corrections per 10 bills | Misallocated if nobody corrected | Still wrong after 2 corrections | Model tokens per bill | Time per bill |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Even split (what split apps do) | 10.8% | 17.83 | $3,008.16 | 107 | 0 | 0 ms |
| LLM with the whole group history in the prompt | 90.0% | 1.00 | $422.00 | 0 | 10,592 | 20.4 s |
| **Quits** | 90.0% | 1.00 | $417.53 | 0 | 269 | 390 ms |

| Right the first time · corrections per 10, by week | Week 1 | Week 2 | Week 3 | Week 4 |
| --- | ---: | ---: | ---: | ---: |
| LLM with the whole group history in the prompt | 63% · 3.7 corr. | 100% · 0.0 corr. | 97% · 0.3 corr. | 100% · 0.0 corr. |
| **Quits** | 60% · 4.0 corr. | 100% · 0.0 corr. | 100% · 0.0 corr. | 100% · 0.0 corr. |

Even splits put **$3,008.16** in the wrong pocket over the month. Quits gets 90.0% of bills right the first time; an LLM that re-reads the whole group history gets 90.0% (the same number of bills). Quits needs 1.00 corrections per 10 bills to the prompt's 1.00, and leaves $417.53 misallocated to its $422.00. The difference is cost: **39× fewer model tokens** and **52× faster**, because the model only runs when someone corrects a split, and every answer names the rule and the memory behind it.

**Memory that follows people.** When Ana, Ben, Clara and Dan start the trip after a month in the flat, the habits they taught about themselves come with them: the trip's first week is right 70.0% of the time, against 50.0% for the same trip started from nothing, and the trip needs 0.75 corrections per 10 bills instead of 1.25. A prompt holding one group's history starts every new group empty (50.0% in the trip's first week).

<details><summary>Every run so far</summary>

| Run | Seed | What changed | Whole-history LLM: right first time · corrections/10 | Quits |
| --- | ---: | --- | ---: | ---: |
| [20261106-083206-mercury-3-s20261106](eval/results/20261106-083206-mercury-3-s20261106.json) | 20261106 | first run | 89.2% · 1.33 | 82.5% · 2.58 |
| [20261106-090527-mercury-3-s20261106-v2](eval/results/20261106-090527-mercury-3-s20261106-v2.json) | 20261106 | Quits rerun after adding the "whoever bought it pays" rule kind | – | 90.0% · 1.08 |
| [20261106-091520-mercury-3-s20261107-heldout](eval/results/20261106-091520-mercury-3-s20261107-heldout.json) | 20261107 | new seed, code frozen | 87.5% · 1.25 | 87.5% · 1.33 |
| [20261106-095146-mercury-3-s20261107-heldout-v3](eval/results/20261106-095146-mercury-3-s20261107-heldout-v3.json) | 20261107 | Quits rerun after two correction fixes found in the first seed | – | 89.2% · 1.17 |
| [20261106-095651-mercury-3-s20261108-fresh](eval/results/20261106-095651-mercury-3-s20261108-fresh.json) | 20261108 | third seed, all systems | 90.8% · 0.92 | 90.0% · 1.00 |
| [20261106-122631-mercury-3-s20261108-fresh-cents](eval/results/20261106-122631-mercury-3-s20261108-fresh-cents.json) | 20261108 | same seed, after shares moved to whole cents | 90.0% · 1.00 | 90.0% · 1.00 |

The first seed (20261106) is where the rule language was shaped, so it is not a fair test; it also holds the two controls (the same LLM with no history, and Quits with memory switched off):

| | Right the first time | Corrections per 10 bills | Misallocated if nobody corrected | Still wrong after 2 corrections | Model tokens per bill | Time per bill |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Even split (what split apps do) | 16.7% | 16.67 | $3,110.36 | 100 | 0 | 0 ms |
| LLM, no memory | 16.7% | 9.75 | $2,935.86 | 2 | 9,284 | 21.5 s |
| LLM with the whole group history in the prompt | 89.2% | 1.33 | $539.00 | 2 | 11,698 | 23.0 s |
| **Quits** | 90.0% | 1.08 | $523.23 | 0 | 367 | 606 ms |
| Quits with memory switched off | 16.7% | 16.25 | $3,110.36 | 94 | 6,077 | 9.0 s |

</details>
<!-- results:end -->

## How it's built

```mermaid
flowchart LR
  subgraph People["Where people log bills"]
    Web["Web app"]
    TG["Telegram bot"]
    MCP["MCP server (any agent)"]
  end
  subgraph Quits["Quits service"]
    Parse["Parse a note (LLM)"]
    Engine["Split engine (deterministic)"]
    Compile["Correction → rule (LLM)"]
    Debts["Debts + settle-up"]
  end
  subgraph Walrus["Walrus Memory (mainnet)"]
    GRules["group rules"]
    MPrefs["member's portable memory"]
    Log["group history"]
  end
  subgraph Sui["Sui mainnet via Tatum"]
    Move["quits::settle (Move)"]
    Allow["0x2::allowance"]
    USDC["gasless USDC"]
  end
  People --> Parse --> Engine
  Engine -- "recall at decision time" --> Walrus
  Compile -- "remember" --> Walrus
  Debts -- "x402 / MPP" --> USDC
  Debts -- "agent pulls exact debt" --> Move --> Allow
  Worker["Worker: Tatum checkpoint stream, memory writer, settlement agent"] --> Sui
  Worker --> Walrus
```

Everything in the diagram runs in production today.

<img src="docs/img/rules.jpg" alt="What Quits has learned in Flat 5B: five rules, each from one correction, each stored on Walrus with its blob id; two live in members' own memory and follow them to every group">

**Walrus Memory is where the product's knowledge lives.** At every decision Quits reads the group's rules and each participant's portable memory back from Walrus (`recall`), applies the rules it finds, and cites the memory blob behind each one. The local database only indexes them: wipe it and "Rebuild from Walrus" restores the same behaviour (and refuses to touch the index if Walrus returns fewer rules than it holds). Each memory is a Walrus `Blob` object owned by the memory account's wallet and tagged with the delegate key that wrote it; `/proof` and `pnpm verify:onchain` list them from chain. A member can point their portable memory at their own Walrus Memory account, so it lands in their wallet and they can revoke Quits. Namespaces: `quits:g:<group>:rules`, `quits:g:<group>:log`, `quits:m:<member>`.

**Tatum is the chain gateway.** All Sui reads and writes go through Tatum: gRPC (native transport) for balances, objects, simulate-and-execute of every x402 payment, the settlement agent's transactions and a filtered `SubscribeCheckpoints` stream that matches direct USDC transfers to open debts; GraphQL for memory receipts; the exchange-rate API for every non-USD bill. `/proof` shows the live per-method call log.

<img src="docs/img/proof.jpg" alt="The public proof page: network sui:mainnet, memories stored on Walrus, Tatum calls per method with latency, and every settlement on Sui with its digest">

**Sui does the money.** The Move package `quits::settle` binds a member's `Allowance` to Quits with an app witness and only mints a `SpendPermit` for a recorded debt, the exact amount, to a creditor the member listed, once, after the objection window. Wallet payments are gasless USDC transfers (`balance::send_funds`, `ValidDuring` expiry), so paying a debt needs no SUI; opening a mandate is an ordinary transaction. 23 Move tests cover each refusal.

| Package | What it does |
| --- | --- |
| `move/quits` | Mandates, debts and allowance-bound settlement |
| `packages/core` | Money (integer micro-USDC), rule language, split engine, settle-up, memory format |
| `packages/llm` | Note parsing and correction compiling, schema-checked, fail closed |
| `packages/memory` | Walrus Memory store with the relayer's rate budget |
| `packages/chain` | Tatum gRPC/GraphQL/Data API clients, transaction builders, memory receipts |
| `packages/pay` | x402 `exact` on Sui (verify via simulate, settle once) and MPP |
| `packages/service` | Proposals, corrections, rules, debts, learned auto-pay limits, demo |
| `apps/web` | Next.js app, x402 endpoints, MCP server |
| `apps/worker` | Memory writer, settlement agent, checkpoint watcher, Telegram bot |
| `eval` | The benchmark above |

## Proof on mainnet

- Package [`0x39cf…9cd2`](https://suiscan.xyz/mainnet/object/0x39cfcfe852fd8e80a88c3b47ce2269777dc9c69bd60d5364da0952ac7ae39cd2) · full list in [PROOF.md](PROOF.md) and [deployments/](deployments)
- `pnpm verify:onchain` checks every claim from a public fullnode (or through Tatum with `TATUM_API_KEY`) in a few seconds.

## Run it

```bash
pnpm install
pnpm test                       # unit tests (Move: pnpm move:test)
cp .env.example apps/web/.env.local   # fill in keys
pnpm -F @quits/web dev          # http://localhost:3100
pnpm -F @quits/worker start     # memory writer, agent, watcher, bot
pnpm eval                       # the benchmark (needs a model key)
```

Without a database URL the app runs on in-process Postgres; without Walrus Memory keys it uses an in-process stand-in and says so on `/proof`.

## Honest limits

- The benchmark's members are simulated and their habits are written in the rule language Quits learns; see [eval/README.md](eval/README.md).
- The demo flatmates pay from server-held wallets with small balances and a 1 USDC per-debt cap. Real members sign in with Slush or any Sui wallet, pay from it and sign their own mandate; `scripts/smoke-wallet.ts` runs that whole path on mainnet with two fresh wallets.
- Walrus Memory blobs expire after a few epochs; Quits does not renew them yet.
- The hosted memory relayer sees memory text in plain form before it encrypts it.

Everything we claim, and how to check it: [CLAIMS.md](CLAIMS.md). What is simulated: [MOCKS.md](MOCKS.md).

MIT licensed.
