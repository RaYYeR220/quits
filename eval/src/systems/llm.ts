import { z } from 'zod';
import { formatUsdc, parseUsdc } from '@quits/core';
import { askJson, type Llm } from '@quits/llm';
import type { EvalExpense } from '../expenses.ts';
import type { GroupDef } from '../groups.ts';
import type { Shares } from '../member.ts';
import type { Proposal, System } from './types.ts';

const Answer = z.object({
  shares: z.array(z.object({ member: z.string(), amount: z.union([z.string(), z.number()]) })),
});

const SYSTEM = `You split one shared expense for a group of people who keep a running tab together.
Work out how much each participant owes for this expense, in USD.
Answer with JSON only: {"shares":[{"member":"<member id>","amount":"12.34"}]}, one entry per participant, two decimals, adding up to the total exactly.
If a member corrected your previous answer, follow the correction.`;

const HISTORY = `
You also get every earlier expense of this group, how it was finally split, and the corrections members made along the way.
They show how this group splits things; apply the same habits to the new expense.`;

const usd = (cents: number) => (cents / 100).toFixed(2);

function itemLines(x: EvalExpense): string[] {
  const rest = x.cents - x.items.reduce((s, i) => s + i.cents, 0);
  return [
    ...x.items.map((i) => `${i.label}: ${usd(i.cents)} USD [${i.tags.join(', ') || 'no tags'}]`),
    ...(x.items.length && rest > 0 ? [`rest of the bill: ${usd(rest)} USD [no tags]`] : []),
  ];
}

function sharesText(s: Shares): string {
  return Object.entries(s)
    .map(([m, v]) => `${m} ${formatUsdc(v)}`)
    .join(', ');
}

function expenseBlock(x: EvalExpense): string {
  const items = itemLines(x);
  return [
    `description: ${x.description}`,
    `category: ${x.category}`,
    `date: ${x.occurredAt.slice(0, 10)}`,
    `paid by: ${x.payerId}`,
    `total: ${usd(x.cents)} USD`,
    items.length ? `items:\n${items.map((l) => `- ${l}`).join('\n')}` : 'items: none, the bill is one amount',
    `participants: ${x.participants.join(', ')}`,
  ].join('\n');
}

interface Past {
  x: EvalExpense;
  final: Shares;
  corrections: string[];
}

function historyBlock(past: Past[]): string {
  if (past.length === 0) return 'Earlier expenses: none yet.\n\n';
  const rows = past.map(({ x, final, corrections }, i) => {
    const items = itemLines(x);
    return [
      `#${i + 1} ${x.occurredAt.slice(0, 10)} "${x.description}" · ${x.category} · paid by ${x.payerId} · total ${usd(x.cents)} · participants ${x.participants.join(', ')}`,
      ...(items.length ? [`   items: ${items.join('; ')}`] : []),
      ...(corrections.length ? [`   corrections: ${corrections.map((c) => `"${c}"`).join(' ')}`] : []),
      `   final split: ${sharesText(final)}`,
    ].join('\n');
  });
  return `Earlier expenses, oldest first:\n${rows.join('\n')}\n\n`;
}

function toShares(a: z.infer<typeof Answer>, ids: Set<string>): Proposal {
  const out: Shares = {};
  for (const s of a.shares) {
    const member = s.member.trim().toLowerCase();
    if (!ids.has(member)) return { invalid: `unknown member ${s.member}` };
    if (member in out) return { invalid: `${member} listed twice` };
    // be lenient about format: "$12.34", 12.34 and "12.3456789" all count
    const raw = (typeof s.amount === 'number' ? (Number.isFinite(s.amount) ? s.amount.toFixed(6) : 'NaN') : s.amount.replace(/[$,\s]|USD/g, '')).replace(
      /^(\d+\.\d{6})\d+$/,
      '$1',
    );
    try {
      const v = parseUsdc(raw);
      if (v < 0n) return { invalid: `negative share for ${member}` };
      out[member] = v;
    } catch {
      return { invalid: `unreadable amount ${String(s.amount)}` };
    }
  }
  return { shares: out };
}

/**
 * An LLM asked to split each expense. Within one expense it sees the member's
 * corrections; with `history` it also gets the whole group history in every
 * prompt (the "just put it all in the context" approach).
 */
function llmSystem(name: 'llm-no-memory' | 'llm-full-history', history: boolean): System {
  return {
    name,
    usesLlm: true,
    async start(g: GroupDef, llm: Llm) {
      const ids = new Set(g.members.map((m) => m.id));
      const roster = `Members: ${g.members.map((m) => `${m.id} (${m.name})`).join(', ')}`;
      const past: Past[] = [];
      let current: EvalExpense | null = null;
      let turns: { answer: Proposal; correction: string }[] = [];
      let last: Proposal = { invalid: 'nothing proposed yet' };

      async function ask(): Promise<Proposal> {
        if (!current) throw new Error('no expense in progress');
        const said = turns
          .map((t) => `${'shares' in t.answer ? `Your previous answer: ${sharesText(t.answer.shares)}` : 'Your previous answer could not be used.'}\nCorrection: "${t.correction}"`)
          .join('\n\n');
        const user = `${roster}\n\n${history ? historyBlock(past) : ''}Expense to split:\n${expenseBlock(current)}\n\n${said ? `${said}\n\nGive the corrected split.` : 'Split this expense.'}`;
        try {
          last = toShares(await askJson(llm, 'shares', history ? SYSTEM + HISTORY : SYSTEM, user, Answer), ids);
        } catch (e) {
          last = { invalid: e instanceof Error ? e.message.slice(0, 200) : String(e) };
        }
        return last;
      }

      return {
        async propose(x) {
          current = x;
          turns = [];
          return ask();
        },
        async correct(text) {
          turns.push({ answer: last, correction: text });
          return { proposal: await ask() };
        },
        async settle(final) {
          if (current) past.push({ x: current, final, corrections: turns.map((t) => t.correction) });
          current = null;
        },
      };
    },
  };
}

export const llmNoMemory = llmSystem('llm-no-memory', false);
export const llmFullHistory = llmSystem('llm-full-history', true);
