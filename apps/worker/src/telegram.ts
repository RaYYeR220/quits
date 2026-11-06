import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { formatUsdc } from '@quits/core';
import { apiTokens, telegramLinks, telegramUsers } from '@quits/db';
import { DEMO_FLAT, DEMO_MEMBERS, type Proposal, type Quits } from '@quits/service';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Draft the bot is waiting to hear a correction for, keyed by chat + user. */
const awaitingCorrection = new Map<string, string>();

async function quitsUser(q: Quits, ctx: Context): Promise<string | null> {
  const id = ctx.from?.id;
  if (!id) return null;
  const [row] = await q.ctx.db.select().from(telegramUsers).where(eq(telegramUsers.telegramUserId, String(id))).limit(1);
  return row?.userId ?? null;
}

async function chatGroup(q: Quits, chatId: number): Promise<string | null> {
  const [row] = await q.ctx.db.select().from(telegramLinks).where(eq(telegramLinks.chatId, String(chatId))).limit(1);
  return row?.groupId ?? null;
}

async function render(q: Quits, p: Proposal): Promise<string> {
  const names = Object.fromEntries((await q.members(p.expense.groupId)).map((m) => [m.id, m.name]));
  const lines = [
    `*${p.expense.description}* — ${formatUsdc(p.expense.usdcMicro)} USDC, paid by ${names[p.expense.payerId] ?? '?'}`,
    ...Object.entries(p.shares).map(([m, v]) => `• ${names[m] ?? m}: ${formatUsdc(v)}`),
  ];
  if (p.why.length) {
    lines.push('', '_Remembered:_');
    for (const w of p.why) lines.push(`↳ ${w.sentence} (${w.learnedAt.slice(0, 10)}${w.blobId ? ', on Walrus' : w.state === 'saving' ? ', saving' : ''})`);
  }
  if (p.degraded) lines.push('', '_Walrus Memory was unreachable, used cached rules._');
  return lines.join('\n');
}

const keyboard = (draftId: string) => new InlineKeyboard().text('✅ Looks right', `ok:${draftId}`).text('✏️ Fix it', `fix:${draftId}`);

export function createTelegramBot(token: string, q: Quits, webUrl: string): Bot {
  const bot = new Bot(token);

  bot.command('start', async (ctx) => {
    const code = ctx.match?.trim();
    if (!code) {
      await ctx.reply(
        'Quits keeps your group tab and learns its unwritten rules.\n\nLink your account from your Quits profile, or try the demo flat: /demo ana (or ben, clara, dan).',
      );
      return;
    }
    const [row] = await q.ctx.db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash(code))).limit(1);
    if (!row || row.label !== 'telegram') {
      await ctx.reply('That link has expired. Make a new one from your Quits profile.');
      return;
    }
    await q.ctx.db
      .insert(telegramUsers)
      .values({ telegramUserId: String(ctx.from!.id), userId: row.userId })
      .onConflictDoUpdate({ target: telegramUsers.telegramUserId, set: { userId: row.userId } });
    await q.ctx.db.delete(apiTokens).where(eq(apiTokens.tokenHash, row.tokenHash));
    await ctx.reply('Linked. Add me to your group chat and send /link <group code> there.');
  });

  bot.command('demo', async (ctx) => {
    const who = (ctx.match || 'ana').trim().toLowerCase();
    const m = DEMO_MEMBERS.find((x) => x.name.toLowerCase() === who);
    if (!m) return void (await ctx.reply('Pick ana, ben, clara or dan.'));
    await q.seedDemo();
    await q.ctx.db
      .insert(telegramUsers)
      .values({ telegramUserId: String(ctx.from!.id), userId: m.id })
      .onConflictDoUpdate({ target: telegramUsers.telegramUserId, set: { userId: m.id } });
    if (ctx.chat.type === 'private') {
      await q.ctx.db.insert(telegramLinks).values({ chatId: String(ctx.chat.id), groupId: DEMO_FLAT }).onConflictDoUpdate({ target: telegramLinks.chatId, set: { groupId: DEMO_FLAT } });
    }
    await ctx.reply(`You're ${m.name} in Flat 5B now. Send an expense like:\n"412 zł dinner, I paid, 140 of it was wine"`);
  });

  bot.command('link', async (ctx) => {
    const uid = await quitsUser(q, ctx);
    if (!uid) return void (await ctx.reply('Link your Quits account first (/start).'));
    try {
      const groupId = await q.joinByCode(ctx.match.trim(), uid);
      await q.ctx.db.insert(telegramLinks).values({ chatId: String(ctx.chat.id), groupId }).onConflictDoUpdate({ target: telegramLinks.chatId, set: { groupId } });
      const g = await q.group(groupId);
      await ctx.reply(`This chat now logs to “${g.name}”. Start an expense with + (e.g. "+38 zł Uber, Dan paid").`);
    } catch {
      await ctx.reply('No group with that code.');
    }
  });

  bot.command('balance', async (ctx) => {
    const groupId = await chatGroup(q, ctx.chat.id);
    if (!groupId) return void (await ctx.reply('This chat isn’t linked to a group yet.'));
    const names = Object.fromEntries((await q.members(groupId)).map((m) => [m.id, m.name]));
    const debts = await q.refreshDebts(groupId);
    if (!debts.length) return void (await ctx.reply('Everyone is quits. 🎉'));
    await ctx.reply(
      debts.map((d) => `${names[d.debtorId]} → ${names[d.creditorId]}: ${formatUsdc(d.usdcMicro)} USDC${d.status === 'recorded' ? ' (auto-settling)' : ''}`).join('\n') +
        `\n\nSettle in the app: ${webUrl}/g/${groupId}`,
    );
  });

  bot.callbackQuery(/^(ok|fix):(.+)$/, async (ctx) => {
    const [, action, draftId] = ctx.match;
    const uid = await quitsUser(q, ctx);
    if (!uid || !draftId) return void (await ctx.answerCallbackQuery({ text: 'Link your Quits account first.' }));
    if (action === 'ok') {
      await q.accept(draftId, uid);
      await ctx.answerCallbackQuery({ text: 'Posted.' });
      await ctx.editMessageReplyMarkup();
      return;
    }
    awaitingCorrection.set(`${ctx.chat?.id}:${ctx.from.id}`, draftId);
    await ctx.answerCallbackQuery();
    await ctx.reply('What’s off? (e.g. "Ana doesn’t drink")', { reply_markup: { force_reply: true, selective: true } });
  });

  bot.on('message:text', async (ctx) => {
    const uid = await quitsUser(q, ctx);
    if (!uid) return;
    const key = `${ctx.chat.id}:${ctx.from.id}`;
    const pending = awaitingCorrection.get(key);
    if (pending) {
      awaitingCorrection.delete(key);
      const r = await q.correct(pending, uid, ctx.message.text);
      if (!r.ok) {
        awaitingCorrection.set(key, pending);
        return void (await ctx.reply(r.clarify, { reply_markup: { force_reply: true, selective: true } }));
      }
      await ctx.reply(`Got it — “${r.learned.sentence}”\n\n${await render(q, r.proposal)}`, { parse_mode: 'Markdown', reply_markup: keyboard(r.proposal.draftId) });
      return;
    }
    const isGroupChat = ctx.chat.type !== 'private';
    let text = ctx.message.text.trim();
    if (isGroupChat) {
      if (!text.startsWith('+')) return;
      text = text.slice(1).trim();
    }
    const groupId = await chatGroup(q, ctx.chat.id);
    if (!groupId) return void (await ctx.reply('Link this chat to a group first: /link <code>.'));
    const r = await q.addExpenseFromText(groupId, uid, text, { source: 'telegram' });
    if (!r.ok) {
      return void (await ctx.reply('missing' in r ? `I need the ${r.missing.join(' and ')}.` : `I can’t price ${r.fxUnavailable} right now. Send it in USD?`));
    }
    await ctx.reply(await render(q, r.proposal), { parse_mode: 'Markdown', reply_markup: keyboard(r.proposal.draftId) });
  });

  bot.catch((err) => console.error('telegram', err.error));
  return bot;
}
