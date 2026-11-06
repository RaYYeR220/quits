# The split-learning benchmark

Quits claims that a group stops correcting its splits once it has told Quits its habits a couple of times. This benchmark measures that claim against the obvious alternatives, with the same expenses, the same simulated member and the same model for every system.

## What it measures

Three synthetic groups, each with split habits nobody wrote down:

| Group | People | Hidden habits |
| --- | --- | --- |
| `flat` | Ana, Ben, Clara, Dan | Rent by room size (Ana 40%, the others 20% each). Ana doesn't drink. Ben covers every taxi. Clara doesn't eat meat. Dan is off the streaming subscriptions. |
| `trip` | Ana, Ben, Clara, Dan, Eve | Ana doesn't drink. Clara doesn't eat meat. Only Ben, Dan and Eve pay for ski passes and rentals. Only Ana, Ben and Clara (the car) pay for petrol. Ana pays a double share of lodging (own room). |
| `couple` | Fin, Gia | Everything 60/40. Whatever one of them buys for themselves is theirs alone. |

Each group gets four weeks of ten expenses, drawn from a seeded generator (mulberry32; the seed is in every results file): rent, groceries with wine or chicken on the receipt, ski days with lift passes as a line item, petrol stops, subscriptions, a pharmacy run with contact lenses, and so on. Sometimes one person is away and isn't a participant. Every hidden habit comes up at least three times in the four weeks, and the flat and the trip also have expenses no habit touches (utilities, a shower curtain). The couple has none of those, because 60/40 applies to everything.

The true split of every expense is the Quits split engine (`@quits/core`) run on the hidden habits. A simulated member reviews each proposal:

1. If every share is within one cent of the truth, they accept it. The cent of slack is there so an LLM isn't punished for rounding.
2. Otherwise they send one plain-language correction about one habit that applies to this expense and that the proposal doesn't reflect yet (the one that moves the most money first). Each habit has three paraphrases, e.g. "Ana doesn't drink, leave her out of the alcohol." / "No alcohol on Ana's share please." / "Ana's teetotal, take the booze off her share." Corrections never mention the resulting amounts; habits that are ratios state the ratio ("Fin takes 60% and Gia 40%", "Ana pays double on rent"). When no habit applies, they say the split should just be even.
3. After two corrections they give up and fix it by hand; the expense counts as unresolved.

Systems, all on the same model:

- `equal`: the even split every split app starts with. Never learns.
- `llm-no-memory`: the model gets the expense (description, category, payer, tagged line items, participants) and the member list and answers `{shares: [{member, amount}]}`, validated with zod. It sees this expense's corrections and nothing from earlier expenses. An unparseable or invalid answer counts as wrong.
- `llm-full-history`: the same, plus every earlier expense with its final split and every correction so far, in every prompt. This is the "just put the history in the context" approach.
- `quits`: the real service. The expense goes in as a structured draft (`addExpense`), corrections go through `correct` (the model turns them into a typed rule that is stored in memory), and the next expense is split by the deterministic engine with the rules read back from memory.
- `quits-memory-off`: the same service with memory switched off. It should match `equal`, and it does.

Reported per system, per week and in total:

- **First-try exact**: share of expenses where the first proposal was right.
- **Corrections per 10 expenses**: how often the member had to step in.
- **$ misallocated if nobody corrected**: Σ over expenses of Σ|proposed − true| / 2 for the first proposal, i.e. money that would have landed on the wrong person. An unusable LLM answer counts as the even split here.
- **Unresolved after 2 corrections**.
- **LLM tokens per expense** (prompt + completion, all calls for that expense) and **mean latency per expense** (proposal, corrections and, for Quits, posting and the memory write).

Quits can also read a correction as a one-off fact about that one expense ("Dan wasn't there") and fix only that expense without learning a rule. Every simulated correction states a standing habit, so each time Quits takes one as a one-off, it counts as a correction that taught nothing. The report says how often that happened.

### Same people, second group

People rarely share only one tab. The `trip-after-flat` scenario runs the flat's four weeks and then the trip in one Quits deployment, with the same Ana, Ben, Clara and Dan. Habits a member teaches about themselves ("Ana doesn't drink", "Clara doesn't eat meat") are stored in that member's own memory, so they apply on the trip from its first expense. Habits of the group (the flat's rent split, Ben covering taxis) stay with the flat. The trip's expenses are the same as in the main table, so the scenario compares directly with `quits` on a fresh deployment and with `llm-full-history`, which keeps one history per group.

## Rerun it

```sh
pnpm install
LLM_API_KEY=... pnpm eval                       # all systems, all groups, 4 weeks, seed 20261106, model mercury-3 on Venice
pnpm eval --systems=quits,quits-memory-off --scenarios=trip-after-flat --label=v2
pnpm eval --systems=equal,quits --groups=flat --weeks=2 --seed=7
pnpm eval --model=gemini-3-8-flash --systems=llm-full-history --no-latest
EVAL_LLM=fake pnpm eval                         # offline, scripted model; checks the harness, not a result
pnpm eval:render                                # markdown tables from eval/results/latest.json
pnpm eval:render a.json b.json                  # several runs; each system from the last file that has it
npx vitest run eval
```

`LLM_BASE_URL` defaults to `https://api.venice.ai/api/v1` and any chat-completions endpoint works. At most four requests are in flight; rate limits and 5xx are retried with backoff. Each run writes `eval/results/<runId>.json` (config, seed, model, the git commit it measured, every expense with its proposals, corrections and the rules Quits learned, and the aggregates) and `eval/results/latest.json`. The tables in the main README are rendered from results files by `scripts/render-results.ts`; none are typed by hand. Merging refuses runs with a different seed, model, size or set of groups. Offline runs go to `eval/results/fake/`, which is not committed.

## Caveats

- The hidden habits are written in the Quits rule language, so every habit is one Quits can express. Real groups have habits it can't ("whoever forgot their wallet last time pays"); this benchmark says nothing about those.
- The member is simulated and polite: one clear, on-topic correction at a time, picked by a fixed procedure. Real people are vaguer and sometimes wrong.
- The member only talks about the group's real habits. They never open the rules page to revoke a rule Quits got wrong, so a bad rule stays until a later correction happens to replace it. In the first run that was the main source of misses in the couple group: "her personal things are on her" became "Gia covers every personal item" with no payer condition, and it outranked the narrower rules learned after it. Routing rules are now ranked by how specific they are, then by age (see the changelog).
- The full-history baseline is strong. Within a four-week window the whole history fits in the prompt and the model picks up the habits after seeing each one corrected once. What it pays is in the token and latency columns, and its prompt grows with every expense the group adds; Quits' cost per decision doesn't.
- With the default model most completion tokens are the model's own reasoning, for every system that calls it. The baselines need it to do arithmetic on every expense; Quits only calls the model to turn a correction into a rule and does the arithmetic in code.
- Quits gets the expense as a structured draft, exactly like the baselines. Turning a sentence into an expense (`parseExpense`) is not measured here.
- In the main table each group runs on its own fresh database and memory, so a member's portable rules never help there. The second-group scenario measures them on their own.
- Memory is the in-process stand-in for Walrus Memory with the same API. It returns every rule in a namespace, which is what the real relayer does for namespaces this small; write latency and rate limits of the real network are not part of these numbers.
- The service has no "set shares by hand" call yet, so when the member gives up on a Quits proposal, the draft is posted as proposed. Posted shares never become rules, so this neither helps nor hurts later proposals.
- LLM answers vary from run to run even at temperature 0. The expenses and the member's choices are deterministic given the seed; the models are not.

## Changelog

Every run is in `eval/results/`, and the README lists them all with their numbers. What changed between them:

1. **First run** (seed 20261106). The whole-history prompt beat Quits on first-try accuracy. The cause was in the couple group: "whatever one of them buys for themselves is theirs alone" had no rule kind, so Quits approximated it with a rule about one named person. Added `payerCovers` ("whoever bought it pays for it").
2. **Quits rerun on the same seed** after that change. Quits pulled level. Because the rule language changed after looking at this seed, this is not a fair test, and the README does not lead with it.
3. **Most specific rule wins.** When two routing rules match one expense (a covering rule and an "only these people" rule), the one with more conditions applies, then the newer one. Found in the couple group of the first seed.
4. **New seed, code frozen** (seed 20261107, all systems). First-try accuracy tied; the whole-history prompt needed slightly fewer corrections.
5. **Two correction fixes**, both found in the first seed's second-group scenario, where Quits did worse on the trip after the flat than from scratch. "Ana and Clara don't ski" names two people, and an exclude rule names one, so Quits asked back instead of learning; it now becomes "only the others share ski passes". "Split the fuel between Ana, Ben and Clara, they're the ones in the car" was read as a one-off; a reason that lasts now counts as a habit. Quits rerun on seed 20261107.
6. **Third seed, all systems** (seed 20261108), with the second-group scenario. Seed 20261107 had been used twice, so the headline moved to bills generated after the last change.
