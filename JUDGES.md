# Review Quits in five minutes

No sign-in, no wallet, no funds. Everything below runs on Sui mainnet and Walrus Memory mainnet.

1. **Open the demo** → [quits-eight.vercel.app/demo](https://quits-eight.vercel.app/demo) and pick Ana. You get your own small "Coffee tab" with the four flatmates; their wallets are real mainnet wallets holding a few tenths of a USDC.
2. **Log a bill in plain words**, e.g. `Pizza 12 USD, I paid, 4 of it was beer`. The proposal leaves Ana out of the beer and the "why" chip says so: *Ana doesn't drink*, learned Oct 14 in another group, with a link to the Walrus blob it was read from. That's her portable memory.
3. **Fix it.** Type `Dan wasn't there` → "Fixed for this bill · nothing learned". Then try a habit, e.g. `Ben always pays for pizza` → "Learned: …", and the split re-flows. Add another pizza: the rule applies by itself.
4. **Settle.** Click *Looks right*, switch to whoever owes (member switcher, top right) and press **Pay**. You see the x402 round trip: `402 Payment required · exact · sui:mainnet` → the member's wallet signs a gasless USDC transfer → `200` with the transaction on Suiscan.
5. **Let the agent pay.** As a member who owes, turn on **auto-settle**. That opens a real Sui Allowance plus a Quits mandate on mainnet (links shown). The next debt within your learned limit is recorded on-chain, a 60-second objection window runs, then the agent pays it through the same x402 endpoint. Over the limit, Quits asks you first: approve and the limit grows, object and it halves.
6. **Day one vs today.** Open *Flat 5B → Rules*: five habits learned over three weeks, each with its Walrus blob. Pick an old bill and compare what Quits proposed on day one with what it proposes now. *Rebuild from Walrus* re-creates the rule index from memory alone.
7. **Proof** → [/proof](https://quits-eight.vercel.app/proof): live Tatum calls by method, the Walrus `Blob` objects Quits wrote (read from chain), settlements with digests.
8. **Check it yourself** (no keys needed):
   ```bash
   pnpm install && pnpm verify:onchain
   ```
9. **From an agent**: on *Me*, create a connection token and add the MCP server (`/api/mcp`) to any MCP client. Ask it to log a bill or show who owes what; it uses the same group memory.
10. **From Telegram**: message [@quits_tab_bot](https://t.me/quits_tab_bot) `/demo ana`, then send a bill.

Where to look in the code: settlement contract `move/quits/sources/settle.move`, split engine `packages/core/src/split.ts`, memory at decision time `packages/service/src/learned.ts`, x402 verification `packages/pay/src/verify.ts`, Tatum clients `packages/chain/src/`.
