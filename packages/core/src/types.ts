import { z } from 'zod';
import type { Micro } from './money.ts';

export type MemberId = string;

export const CATEGORIES = [
  'groceries',
  'dinner',
  'drinks',
  'rent',
  'utilities',
  'taxi',
  'fuel',
  'accommodation',
  'activity',
  'subscription',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CategorySchema = z.enum(CATEGORIES);

export const TAGS = [
  'alcohol',
  'meat',
  'fish',
  'dessert',
  'kids',
  'ski',
  'fuel',
  'tip',
  'delivery',
  'personal',
] as const;
export type Tag = (typeof TAGS)[number];
export const TagSchema = z.enum(TAGS);

export interface Item {
  label: string;
  usdcMicro: Micro;
  tags: Tag[];
}

export interface Expense {
  id: string;
  groupId: string;
  payerId: MemberId;
  /** Total in micro-USDC after FX. */
  usdcMicro: Micro;
  /** ISO 4217 code of what was actually paid. */
  currency: string;
  /** Amount in the original currency's minor units. */
  amountMinor: bigint;
  category: Category;
  /** Optional line items; their sum never exceeds the total. */
  items: Item[];
  /** Who shares this expense (before rules). */
  participants: MemberId[];
  description: string;
  occurredAt: string;
}

export interface Member {
  id: MemberId;
  name: string;
}
