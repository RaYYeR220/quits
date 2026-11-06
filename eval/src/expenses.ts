import type { Category, Expense, MemberId, Tag } from '@quits/core';
import type { ExpenseDraft } from '@quits/llm';
import { GROUPS, type GroupDef, type GroupId } from './groups.ts';
import { hash, rng, type Rng } from './rng.ts';

export interface EvalItem {
  label: string;
  cents: number;
  tags: Tag[];
}

/** One expense of the benchmark, in dollars and cents as a person would enter it. */
export interface EvalExpense {
  id: string;
  groupId: GroupId;
  week: number;
  /** Position in the group's stream, from 0. */
  n: number;
  payerId: MemberId;
  category: Category;
  description: string;
  cents: number;
  items: EvalItem[];
  participants: MemberId[];
  occurredAt: string;
}

export const START = '2026-10-05T00:00:00.000Z';
const DAY = 86_400_000;
const MICRO_PER_CENT = 10_000n;

export function toExpense(x: EvalExpense): Expense {
  return {
    id: x.id,
    groupId: x.groupId,
    payerId: x.payerId,
    usdcMicro: BigInt(x.cents) * MICRO_PER_CENT,
    currency: 'USD',
    amountMinor: BigInt(x.cents),
    category: x.category,
    items: x.items.map((i) => ({ label: i.label, usdcMicro: BigInt(i.cents) * MICRO_PER_CENT, tags: i.tags })),
    participants: x.participants,
    description: x.description,
    occurredAt: x.occurredAt,
  };
}

export function toDraft(x: EvalExpense): ExpenseDraft {
  return {
    payerId: x.payerId,
    currency: 'USD',
    amountMinor: BigInt(x.cents),
    category: x.category,
    description: x.description,
    items: x.items.map((i) => ({ label: i.label, amountMinor: BigInt(i.cents), tags: i.tags })),
    participants: x.participants,
    occurredAt: x.occurredAt,
  };
}

// --- building blocks ---------------------------------------------------------

interface Made {
  payerId: MemberId;
  category: Category;
  description: string;
  items: EvalItem[];
  /** Untagged part of the bill on top of the items. */
  rest: number;
}

interface Slot {
  /** Someone may be away for this one. */
  canMiss: boolean;
  make(r: Rng, present: MemberId[], week: number): Made;
}

type Line = readonly [label: string, lo: number, hi: number];

function line(r: Rng, l: Line, tags: Tag[]): EvalItem {
  return { label: l[0], cents: r.cents(l[1], l[2]), tags };
}

function maybe(r: Rng, p: number, lines: readonly Line[], tags: Tag[]): EvalItem[] {
  return r.chance(p) ? [line(r, r.pick(lines), tags)] : [];
}

function payerFrom(r: Rng, present: MemberId[], allowed?: readonly MemberId[]): MemberId {
  const pool = allowed ? present.filter((m) => allowed.includes(m)) : present;
  return r.pick(pool.length ? pool : present);
}

const WINE: Line[] = [
  ['Bottle of wine', 11, 24],
  ['Six-pack of beer', 9, 15],
];
const MEAT: Line[] = [
  ['Chicken thighs', 8, 15],
  ['Ground beef', 7, 13],
  ['Bacon', 5, 9],
];

// --- the flat ----------------------------------------------------------------

const flat: Record<string, Slot> = {
  rent: {
    canMiss: false,
    make: (_r, _p, week) => ({ payerId: 'ana', category: 'rent', description: `Rent, week ${week}`, items: [], rest: 104000 }),
  },
  groceries: {
    canMiss: true,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'groceries',
      description: r.pick(["Trader Joe's", 'Whole Foods', 'Safeway', 'Aldi']),
      items: [...maybe(r, 0.35, WINE, ['alcohol']), ...maybe(r, 0.45, MEAT, ['meat']), ...maybe(r, 0.15, [['Ice cream', 4, 7]], ['dessert'])],
      rest: r.cents(30, 95),
    }),
  },
  bigShop: {
    canMiss: false,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'groceries',
      description: 'Costco run',
      items: [
        line(r, r.pick([['Chicken breasts, family pack', 18, 26], ['Steaks, 4-pack', 28, 42]] as const), ['meat']),
        ...maybe(r, 0.4, [['Case of beer', 22, 30]], ['alcohol']),
      ],
      rest: r.cents(90, 180),
    }),
  },
  pub: {
    canMiss: true,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'drinks',
      description: `Drinks at ${r.pick(['The Owl', 'Zeitgeist', 'The Page', 'Elixir'])}`,
      items: [line(r, ['Beers and cocktails', 30, 70], ['alcohol'])],
      rest: r.cents(10, 25),
    }),
  },
  takeout: {
    canMiss: true,
    make: (r, p) => {
      const kind = r.pick(['pizza', 'thai', 'burgers', 'sushi'] as const);
      const payerId = payerFrom(r, p);
      if (kind === 'pizza')
        return {
          payerId,
          category: 'dinner',
          description: 'Pizza night',
          items: [line(r, ['Pepperoni pizza', 18, 24], ['meat']), ...maybe(r, 0.5, [['Beer', 10, 16]], ['alcohol'])],
          rest: r.cents(16, 22),
        };
      if (kind === 'thai')
        return { payerId, category: 'dinner', description: 'Thai takeout', items: maybe(r, 0.5, [['Chicken satay', 11, 15]], ['meat']), rest: r.cents(40, 70) };
      if (kind === 'burgers')
        return { payerId, category: 'dinner', description: 'Burger night', items: [line(r, ['Burgers', 30, 48], ['meat'])], rest: r.cents(10, 16) };
      return { payerId, category: 'dinner', description: 'Sushi delivery', items: [line(r, ['Sashimi platter', 30, 55], ['fish'])], rest: r.cents(10, 20) };
    },
  },
  dinnerOut: {
    canMiss: true,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'dinner',
      description: `Dinner at ${r.pick(['Lupa', 'Nopa', 'Delfina', 'Zuni Café'])}`,
      items: [
        ...maybe(r, 0.5, [['Bottle of Chianti', 30, 60], ['Wine pairing', 40, 70]], ['alcohol']),
        ...maybe(r, 0.45, [['Ribeye', 26, 42], ['Lamb shoulder', 28, 40]], ['meat']),
        ...maybe(r, 0.2, [['Tiramisu', 9, 16]], ['dessert']),
      ],
      rest: r.cents(50, 120),
    }),
  },
  taxi: {
    canMiss: true,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'taxi',
      description: r.pick(['Uber home', 'Lyft to the airport', 'Cab after the concert', 'Uber to the party']),
      items: [],
      rest: r.cents(14, 48),
    }),
  },
  subscription: {
    canMiss: false,
    make: (r, p, week) => {
      const [description, cents] = ([['Netflix', 2299], ['Spotify Family', 1999], ['Disney+', 1599], ['Max', 1699]] as const)[(week - 1) % 4] ?? ['Netflix', 2299];
      return { payerId: payerFrom(r, p, ['ben', 'clara']), category: 'subscription', description, items: [], rest: cents };
    },
  },
  utilities: {
    canMiss: false,
    make: (r, p) => {
      const [description, lo, hi] = r.pick([['Electricity', 85, 160], ['Internet', 75, 75], ['Water bill', 40, 70]] as const);
      return { payerId: payerFrom(r, p, ['clara', 'dan']), category: 'utilities', description, items: [], rest: r.cents(lo, hi) };
    },
  },
  household: {
    canMiss: false,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'other',
      description: r.pick(['Cleaning supplies', 'Toilet paper and dish soap', 'Light bulbs', 'New shower curtain']),
      items: [],
      rest: r.cents(12, 45),
    }),
  },
};

// --- the trip ----------------------------------------------------------------

const STOPS = ['Chamonix', 'Zermatt', 'St. Anton', 'Cortina'];
const SKIERS = ['ben', 'dan', 'eve'];
const DRIVERS = ['ana', 'ben', 'clara'];

const trip: Record<string, Slot> = {
  lodging: {
    canMiss: false,
    make: (r, p, week) => ({
      payerId: payerFrom(r, p),
      category: 'accommodation',
      description: `${r.pick(['Chalet', 'Airbnb', 'Hotel', 'Guesthouse'])} in ${STOPS[(week - 1) % STOPS.length]}, ${r.int(2, 4)} nights`,
      items: [],
      rest: r.cents(380, 900),
    }),
  },
  skiDay: {
    canMiss: true,
    make: (r, p) => {
      const skiers = p.filter((m) => SKIERS.includes(m)).length;
      const pass = r.cents(55, 79);
      return {
        payerId: payerFrom(r, p),
        category: 'activity',
        description: `Ski day at ${r.pick(['Les Grands Montets', 'Gornergrat', 'Valluga', 'Tofana'])}`,
        items: [
          { label: 'Lift passes', cents: pass * skiers, tags: ['ski'] },
          ...(r.chance(0.3) ? [{ label: 'Ski rental', cents: r.cents(25, 40) * skiers, tags: ['ski'] as Tag[] }] : []),
        ],
        rest: r.cents(45, 90),
      };
    },
  },
  petrol: {
    canMiss: true,
    make: (r, p) => {
      const cents = r.cents(55, 95);
      return {
        payerId: payerFrom(r, p, DRIVERS),
        category: 'fuel',
        description: r.pick(['Petrol, Shell on the A40', 'Fuel stop, OMV', 'Petrol at Agip', 'Fill-up, BP']),
        items: [{ label: 'Petrol', cents, tags: ['fuel'] }],
        rest: 0,
      };
    },
  },
  dinner: {
    canMiss: true,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'dinner',
      description: r.pick(['Fondue at Le Chalet', 'Pizzeria Da Mario', 'Raclette night', 'Gasthof Post', 'Trattoria al Ponte']),
      items: [
        ...maybe(r, 0.55, [['House wine', 35, 70], ['Beers', 20, 40]], ['alcohol']),
        ...maybe(r, 0.6, [['Charcuterie board', 22, 34], ['Schnitzels', 30, 52], ['Steak', 34, 48]], ['meat']),
        ...maybe(r, 0.2, [['Apple strudel', 12, 20]], ['dessert']),
      ],
      rest: r.cents(60, 150),
    }),
  },
  groceries: {
    canMiss: true,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'groceries',
      description: r.pick(['Migros', 'Spar', 'Carrefour Market', 'Coop']),
      items: [...maybe(r, 0.4, [['Beer', 10, 18], ['Wine', 9, 20]], ['alcohol']), ...maybe(r, 0.5, [['Sausages', 8, 14], ['Ham', 6, 11]], ['meat'])],
      rest: r.cents(40, 110),
    }),
  },
  apres: {
    canMiss: true,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'drinks',
      description: `Après-ski at ${r.pick(['the Mooserwirt', 'Le Privé', 'Hennu Stall', 'Bar Lovat'])}`,
      items: [line(r, ['Beers and Glühwein', 40, 85], ['alcohol'])],
      rest: r.cents(12, 25),
    }),
  },
  outing: {
    canMiss: true,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'activity',
      description: r.pick(['Thermal baths', 'Cable car ride', 'Museum tickets', 'Sledding hill']),
      items: [],
      rest: r.cents(40, 150),
    }),
  },
  misc: {
    canMiss: false,
    make: (r, p) => {
      const [description, lo, hi] = r.pick([['Parking garage', 15, 40], ['Pharmacy', 10, 30], ['Snow chains', 60, 90]] as const);
      return { payerId: payerFrom(r, p), category: 'other', description, items: [], rest: r.cents(lo, hi) };
    },
  },
};

// --- the couple --------------------------------------------------------------

// Things one of them buys for themselves, by where they'd buy them.
type Mine = { shop: Line[]; pharmacy: Line[]; groceries: Line[] };
const MINE: Record<MemberId, Mine> = {
  fin: {
    shop: [
      ['Running socks', 15, 24],
      ['Video game', 40, 70],
      ['Gym shorts', 25, 45],
    ],
    pharmacy: [['Razor blades', 18, 30]],
    groceries: [
      ['Protein powder', 28, 45],
      ['Energy drinks', 12, 20],
    ],
  },
  gia: {
    shop: [
      ['Paperback novel', 14, 22],
      ['Yoga mat', 30, 60],
      ['Hair dryer', 45, 80],
    ],
    pharmacy: [
      ['Moisturizer', 18, 38],
      ['Contact lenses', 30, 55],
    ],
    groceries: [
      ['Kombucha', 12, 18],
      ['Protein bars', 12, 18],
    ],
  },
};

function mine(r: Rng, payer: MemberId, where: keyof Mine, p: number): EvalItem[] {
  return maybe(r, p, MINE[payer]?.[where] ?? [], ['personal']);
}

function shop(payer: MemberId): Slot {
  return {
    canMiss: false,
    make: (r) => ({
      payerId: payer,
      category: 'other',
      description: r.pick(['Target run', 'Amazon order']),
      items: mine(r, payer, 'shop', 1),
      rest: r.cents(20, 60),
    }),
  };
}

const couple: Record<string, Slot> = {
  groceries: {
    canMiss: false,
    make: (r, p) => {
      const payerId = payerFrom(r, p);
      return {
        payerId,
        category: 'groceries',
        description: r.pick(["Trader Joe's", 'Whole Foods', 'Farmers market', 'Safeway']),
        items: mine(r, payerId, 'groceries', 0.2),
        rest: r.cents(35, 140),
      };
    },
  },
  shopFin: shop('fin'),
  shopGia: shop('gia'),
  dinner: {
    canMiss: false,
    make: (r, p) => ({
      payerId: payerFrom(r, p),
      category: 'dinner',
      description: `Dinner at ${r.pick(['Flour + Water', 'Kin Khao', 'State Bird', 'La Taqueria'])}`,
      items: maybe(r, 0.4, [['Bottle of wine', 35, 60]], ['alcohol']),
      rest: r.cents(50, 140),
    }),
  },
  takeout: {
    canMiss: false,
    make: (r, p) => ({ payerId: payerFrom(r, p), category: 'dinner', description: r.pick(['Thai delivery', 'Ramen takeout', 'Poke bowls']), items: [], rest: r.cents(25, 60) }),
  },
  bill: {
    canMiss: false,
    make: (r, p, week) => {
      const [description, category, lo, hi] = ([
        ['Electricity', 'utilities', 70, 120],
        ['Netflix', 'subscription', 15.49, 15.49],
        ['Internet', 'utilities', 65, 65],
        ['Phone plan', 'utilities', 80, 80],
      ] as const)[(week - 1) % 4] ?? ['Electricity', 'utilities', 70, 120];
      return { payerId: payerFrom(r, p), category, description, items: [], rest: r.cents(lo, hi) };
    },
  },
  rent: {
    canMiss: false,
    make: () => ({ payerId: 'gia', category: 'rent', description: 'October rent', items: [], rest: 260000 }),
  },
  pharmacy: {
    canMiss: false,
    make: (r, p) => {
      const payerId = payerFrom(r, p);
      return { payerId, category: 'other', description: r.pick(['CVS', 'Walgreens']), items: mine(r, payerId, 'pharmacy', 0.5), rest: r.cents(8, 25) };
    },
  },
  movies: {
    canMiss: false,
    make: (r, p) => ({ payerId: payerFrom(r, p), category: 'activity', description: 'Movie tickets', items: [], rest: r.cents(24, 38) }),
  },
  taxi: {
    canMiss: false,
    make: (r, p) => ({ payerId: payerFrom(r, p), category: 'taxi', description: r.pick(['Uber home', 'Lyft to brunch']), items: [], rest: r.cents(12, 35) }),
  },
  coffee: {
    canMiss: false,
    make: (r, p) => ({ payerId: payerFrom(r, p), category: 'other', description: 'Coffee and pastries', items: [], rest: r.cents(8, 16) }),
  },
};

// --- weekly plans ------------------------------------------------------------

interface Plan {
  slots: Record<string, Slot>;
  /** Happens every week. */
  fixed: string[];
  /** The rest of the week is drawn from here. */
  extra: string[];
  /** Replaces one extra in week 1. */
  firstWeek?: string;
}

const PLANS: Record<GroupId, Plan> = {
  flat: {
    slots: flat,
    fixed: ['rent', 'groceries', 'groceries', 'bigShop', 'pub', 'takeout', 'taxi', 'subscription'],
    extra: ['utilities', 'household', 'groceries', 'dinnerOut', 'dinnerOut', 'taxi'],
  },
  trip: {
    slots: trip,
    fixed: ['lodging', 'lodging', 'skiDay', 'petrol', 'dinner', 'dinner', 'groceries', 'apres'],
    extra: ['skiDay', 'petrol', 'outing', 'misc', 'groceries', 'dinner'],
  },
  couple: {
    slots: couple,
    fixed: ['groceries', 'groceries', 'dinner', 'shopFin', 'shopGia', 'takeout', 'bill'],
    extra: ['groceries', 'dinner', 'pharmacy', 'movies', 'taxi', 'coffee'],
    firstWeek: 'rent',
  },
};

const ABSENT = 0.15;

/** The same stream of expenses for every system, given the seed. */
export function generate(groupId: GroupId, o: { weeks: number; perWeek: number; seed: number }): EvalExpense[] {
  const g: GroupDef = GROUPS[groupId];
  const plan = PLANS[groupId];
  const r = rng(hash(o.seed, groupId));
  const everyone = g.members.map((m) => m.id);
  const out: EvalExpense[] = [];

  for (let week = 1; week <= o.weeks; week++) {
    const names = plan.fixed.slice(0, o.perWeek);
    if (week === 1 && plan.firstWeek && names.length < o.perWeek) names.push(plan.firstWeek);
    while (names.length < o.perWeek) names.push(r.pick(plan.extra));

    const made = names.map((name) => {
      const slot = plan.slots[name];
      if (!slot) throw new Error(`no slot ${name}`);
      let present = everyone;
      if (slot.canMiss && everyone.length > 2 && r.chance(ABSENT)) {
        const away = r.pick(everyone);
        present = everyone.filter((m) => m !== away);
      }
      const m = slot.make(r, present, week);
      // whoever paid was there
      const participants = present.includes(m.payerId) ? present : [...present, m.payerId].sort();
      const at = Date.parse(START) + (week - 1) * 7 * DAY + r.int(0, 6) * DAY + r.int(8, 22) * 3_600_000 + r.int(0, 59) * 60_000;
      return { ...m, participants, at };
    });
    made.sort((a, b) => a.at - b.at);

    for (const m of made) {
      const cents = m.items.reduce((s, i) => s + i.cents, 0) + m.rest;
      out.push({
        id: `${groupId}-${String(out.length + 1).padStart(2, '0')}`,
        groupId,
        week,
        n: out.length,
        payerId: m.payerId,
        category: m.category,
        description: m.description,
        cents,
        items: m.items,
        participants: m.participants,
        occurredAt: new Date(m.at).toISOString(),
      });
    }
  }
  return out;
}
