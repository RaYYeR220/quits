import { and, eq, isNull } from 'drizzle-orm';
import { groups, members, users } from '@quits/db';
import type { Member } from '@quits/core';
import { QuitsError, type Ctx } from './context.ts';

export interface NewUser {
  id?: string;
  name: string;
  suiAddress?: string | null;
  authProvider: 'zklogin' | 'wallet' | 'demo' | 'telegram';
}

export async function ensureUser(ctx: Ctx, u: NewUser): Promise<string> {
  if (u.suiAddress) {
    const [existing] = await ctx.db.select().from(users).where(eq(users.suiAddress, u.suiAddress)).limit(1);
    if (existing) return existing.id;
  }
  if (u.id) {
    const [existing] = await ctx.db.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (existing) return existing.id;
  }
  const id = u.id ?? ctx.id();
  await ctx.db.insert(users).values({ id, name: u.name, suiAddress: u.suiAddress ?? null, authProvider: u.authProvider });
  return id;
}

function inviteCode(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
}

export async function createGroup(
  ctx: Ctx,
  g: { id?: string; name: string; defaultCurrency: string; ownerId: string; isDemo?: boolean; createdAt?: Date },
): Promise<string> {
  const id = g.id ?? ctx.id();
  await ctx.db.insert(groups).values({
    id,
    name: g.name,
    code: inviteCode(ctx.id()),
    defaultCurrency: g.defaultCurrency.toUpperCase(),
    createdBy: g.ownerId,
    isDemo: g.isDemo ?? false,
    ...(g.createdAt ? { createdAt: g.createdAt } : {}),
  });
  const [owner] = await ctx.db.select().from(users).where(eq(users.id, g.ownerId)).limit(1);
  if (!owner) throw new QuitsError('not_found', 'owner not found');
  await ctx.db.insert(members).values({ groupId: id, userId: g.ownerId, displayName: owner.name, role: 'owner', ...(g.createdAt ? { joinedAt: g.createdAt } : {}) });
  return id;
}

export async function addMember(ctx: Ctx, groupId: string, userId: string, at?: Date): Promise<void> {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new QuitsError('not_found', 'user not found');
  await ctx.db
    .insert(members)
    .values({ groupId, userId, displayName: u.name, ...(at ? { joinedAt: at } : {}) })
    .onConflictDoNothing();
}

export async function joinByCode(ctx: Ctx, code: string, userId: string): Promise<string> {
  const [g] = await ctx.db.select().from(groups).where(eq(groups.code, code.toUpperCase())).limit(1);
  if (!g) throw new QuitsError('not_found', 'no group with that code');
  await addMember(ctx, g.id, userId);
  return g.id;
}

export async function getGroup(ctx: Ctx, groupId: string) {
  const [g] = await ctx.db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!g) throw new QuitsError('not_found', 'group not found');
  return g;
}

export async function groupMembers(ctx: Ctx, groupId: string): Promise<(Member & { suiAddress: string | null; memwalAccountId: string | null })[]> {
  const rows = await ctx.db
    .select({ id: users.id, name: members.displayName, suiAddress: users.suiAddress, memwalAccountId: users.memwalAccountId })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.groupId, groupId), isNull(members.leftAt)));
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function assertMember(ctx: Ctx, groupId: string, userId: string): Promise<void> {
  const [m] = await ctx.db
    .select()
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.userId, userId), isNull(members.leftAt)))
    .limit(1);
  if (!m) throw new QuitsError('forbidden', 'not a member of this group');
}

export async function userGroups(ctx: Ctx, userId: string) {
  return ctx.db
    .select({ id: groups.id, name: groups.name, code: groups.code, defaultCurrency: groups.defaultCurrency, isDemo: groups.isDemo })
    .from(members)
    .innerJoin(groups, eq(groups.id, members.groupId))
    .where(and(eq(members.userId, userId), isNull(members.leftAt)));
}
