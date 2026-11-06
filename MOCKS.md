# What is real and what is simulated

**Real, on mainnet:** the Move contract, every allowance, mandate, debt and payment, Walrus Memory writes and reads, Tatum gRPC/GraphQL/exchange-rate calls, the settlement agent, the checkpoint watcher, the Telegram bot.

**Demo-only conveniences:**
- The four demo flatmates (Ana, Ben, Clara, Dan) are real mainnet wallets whose keys the server holds, so visitors can pay without a wallet. Payments are capped at 1 USDC and an allowance at 2 USDC a week. Their USDC moves between them; when one runs low, a gasless transfer from the richest tops it up first, and the app shows that leg.
- The demo groups' history (Flat 5B, Lisbon trip) was entered by a seed script as if the group had used Quits for three weeks; the rules it learned are real Walrus memories.
- Demo corrections stay inside the visitor's sandbox tab instead of writing to the flatmates' portable memory.

**Benchmark only (`eval/`):** members, their habits and their corrections are simulated; the memory store is the in-process stand-in with the same API as Walrus Memory. Nothing in the benchmark touches mainnet.

**Not built:** Google sign-in, memory renewal before blob expiry.
