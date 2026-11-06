# On-chain proof (Sui mainnet)

Run `pnpm verify:onchain` to check all of this in a few seconds. Source of truth: [deployments/mainnet.json](deployments/mainnet.json) and [deployments/proof.json](deployments/proof.json).

## Settlement contract

| What | Id |
| --- | --- |
| Package `quits::settle` | [`0x39cfcfe852fd8e80a88c3b47ce2269777dc9c69bd60d5364da0952ac7ae39cd2`](https://suiscan.xyz/mainnet/object/0x39cfcfe852fd8e80a88c3b47ce2269777dc9c69bd60d5364da0952ac7ae39cd2) |
| Config (registrar, agent) | [`0x60833b70…abcde`](https://suiscan.xyz/mainnet/object/0x60833b70cd3550288e58207102187efdfcb283dff28ac6e6fd6fc32f4b9abcde) |
| Publish | [`98xJbLpA…75k3`](https://suiscan.xyz/mainnet/tx/98xJbLpAZxxrSrC8YyemNcKHk5jpazPfJ4trwhxu75k3) (through Tatum's gRPC gateway) |
| Roles set | [`CUEsggdM…SP4v`](https://suiscan.xyz/mainnet/tx/CUEsggdMNHbHVpoX9o32Zc2tfYaWPFQjsdbFeksCSP4v) |
| Settlement agent | `0x575b2fe654ca54044b866abb17a78d7f3102b13a6d55f3eefc31c42eb01b5d20` |

## Payments

| What | Transaction |
| --- | --- |
| x402 payment from a member's wallet (gasless USDC, 0.50) | [`5eWczSwa…hJ2`](https://suiscan.xyz/mainnet/tx/5eWczSwa9vxiLsfvWy1p4fcm2girFRQ3EdWKGEHN6hJ2) |
| Agent pays through the mandate (0.50 from the member's allowance) | [`4ax2Bq9C…yw8j`](https://suiscan.xyz/mainnet/tx/4ax2Bq9CFiu9Wyu4CS3sMdGZUMdhJoxjWvZq2ntryw8j) |
| …the debt it paid, recorded on-chain first | [`AgCSHqvW…mjW4`](https://suiscan.xyz/mainnet/tx/AgCSHqvWUGJ1CKNsLBdyC6V6CuQg1SxLVGvebM5nmjW4) · Debt [`0xd868f5fa…`](https://suiscan.xyz/mainnet/object/0xd868f5fa1b00a195c57e131d26e2401d993d618e2698a2c1824ac939d4990dd0) |
| Mandate + allowance opened by the member | [`55iv8Mxb…zejm`](https://suiscan.xyz/mainnet/tx/55iv8MxbCiuPyNSXKai8XAHy5wJ3Q7nzMgDNn3HPzejm) · Mandate [`0x42ee50b0…`](https://suiscan.xyz/mainnet/object/0x42ee50b05c1c6840d6c488efaf7d50d5f45557a117ce388e728e88b334cee9ec) · Allowance [`0xe003e0ae…`](https://suiscan.xyz/mainnet/object/0xe003e0aefcb001a2bb775f0d18813fb6e5414a339270d874d07de4af35ef87ed) |

Every new payment made in the app shows up on [/proof](https://quits-eight.vercel.app/proof) with its digest.

## Walrus Memory

Memories written by delegate key `951edfde65ae7bd307148bd7e7ed5beed9bfc960958ae7fb7f0e153982cf2505` into account `0x4158ba0847326113deb7f212e3f45a1a41e294144c1fb39fbe4be323a0588919`, owned by `0xbc02b930206de470ed100fcd4d6ae25535647baef950a8dee68bafc73103db8d`. Each one is a Walrus `Blob` object in that wallet, tagged `memwal_namespace` and `memwal_agent_id`. `pnpm verify:onchain` counts them; `/proof` lists the latest with Suiscan and Walruscan links.
