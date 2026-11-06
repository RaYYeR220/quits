import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatUsdc, type Micro } from '@quits/core';
import { apiTokens } from '@quits/db';
import type { Proposal, Quits } from '@quits/service';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function userForToken(q: Quits, header: string | null): Promise<string | null> {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const [row] = await q.ctx.db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(token))).limit(1);
  return row?.userId ?? null;
}

function textResult(o: unknown) {
  const s = JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? formatUsdc(v as Micro) : v), 2);
  return { content: [{ type: 'text' as const, text: s }] };
}

async function describe(q: Quits, groupId: string, p: Proposal) {
  const names = Object.fromEntries((await q.members(groupId)).map((m) => [m.id, m.name]));
  return {
    draftId: p.draftId,
    expense: { description: p.expense.description, totalUsdc: formatUsdc(p.expense.usdcMicro), payer: names[p.expense.payerId] },
    shares: Object.fromEntries(Object.entries(p.shares).map(([m, v]) => [names[m] ?? m, formatUsdc(v)])),
    because: p.why.map((w) => ({ rule: w.sentence, learned: w.learnedAt.slice(0, 10), walrusBlob: w.blobId ?? null, state: w.state })),
    memoriesRead: p.memoriesRead,
    ...(p.degraded ? { note: 'Walrus Memory was unreachable; used cached rules.' } : {}),
  };
}

/** The Quits tools any agent can use; the same group memory as the app and the Telegram bot. */
export function buildMcp(q: Quits, userId: string, origin: string): McpServer {
  const server = new McpServer({ name: 'quits', version: '0.1.0' });

  server.registerTool(
    'quits_groups',
    { title: 'List my groups', description: 'Groups the signed-in member belongs to.', inputSchema: {} },
    async () => textResult(await q.groupsOf(userId)),
  );

  server.registerTool(
    'quits_add_expense',
    {
      title: 'Add an expense',
      description: 'Log a shared expense in plain words ("84 € dinner, I paid, 24 of it was wine"). Returns the proposed split and the remembered rules behind it. The expense stays a draft until accepted.',
      inputSchema: { groupId: z.string(), text: z.string().min(3).max(400) },
    },
    async ({ groupId, text }) => {
      const r = await q.addExpenseFromText(groupId, userId, text, { source: 'mcp' });
      if (!r.ok) return textResult('missing' in r ? { needs: r.missing } : { error: `No exchange rate for ${r.fxUnavailable}; give the amount in USD.` });
      return textResult(await describe(q, groupId, r.proposal));
    },
  );

  server.registerTool(
    'quits_correct',
    {
      title: 'Correct a split',
      description: 'Tell Quits what was wrong with a draft split ("Ana doesn\'t drink"). It learns a rule, stores it in Walrus Memory and re-proposes.',
      inputSchema: { draftId: z.string(), text: z.string().min(2).max(300) },
    },
    async ({ draftId, text }) => {
      const r = await q.correct(draftId, userId, text);
      if (!r.ok) return textResult({ question: r.clarify });
      return textResult({
        ...(r.learned ? { learned: r.learned.sentence, scope: r.learned.scope } : { fixedThisExpenseOnly: r.fixed }),
        ...(await describe(q, r.proposal.expense.groupId, r.proposal)),
      });
    },
  );

  server.registerTool(
    'quits_accept',
    { title: 'Accept a split', description: 'Post a draft expense with its proposed split.', inputSchema: { draftId: z.string() } },
    async ({ draftId }) => {
      const r = await q.accept(draftId, userId);
      return textResult({ posted: r.expense.description, shares: r.shares });
    },
  );

  server.registerTool(
    'quits_balances',
    {
      title: 'Who owes what',
      description: 'Balances and open debts of a group. Each debt has an x402 payment URL settled in USDC on Sui.',
      inputSchema: { groupId: z.string() },
    },
    async ({ groupId }) => {
      await q.assertMember(groupId, userId);
      const names = Object.fromEntries((await q.members(groupId)).map((m) => [m.id, m.name]));
      const debts = await q.refreshDebts(groupId);
      return textResult({
        balances: Object.fromEntries(Object.entries(await q.balances(groupId)).map(([m, v]) => [names[m] ?? m, formatUsdc(v)])),
        debts: debts.map((d) => ({ id: d.id, from: names[d.debtorId], to: names[d.creditorId], usdc: formatUsdc(d.usdcMicro), status: d.status, pay: `${origin}/api/pay/${d.id}` })),
      });
    },
  );

  server.registerTool(
    'quits_rules',
    { title: 'What Quits has learned', description: 'The group\'s learned rules with the Walrus blob each lives in.', inputSchema: { groupId: z.string() } },
    async ({ groupId }) => {
      await q.assertMember(groupId, userId);
      const rules = await q.rules(groupId);
      return textResult(rules.map((r) => ({ rule: r.sentence, status: r.status, scope: r.scope, learned: r.learnedAt.slice(0, 10), walrusBlob: r.blobId })));
    },
  );

  return server;
}
