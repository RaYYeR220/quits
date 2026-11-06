/**
 * The hero card's script: six moments of the product, replayed in a loop.
 *
 * Figures follow the demo seed (packages/service/src/demo.ts) and the demo mandate (lib/mandates.ts):
 * Flat 5B and the Lisbon trip as seeded; the Coffee tab's two seeded bills net to
 * Dan → Clara 0.50 USDC and Ana → Ben 0.30 USDC (core settleUp); the demo mandate is
 * 2 USDC a week with a 60-second objection window. Illustrative bits carry `data-placeholder`
 * in the markup: the shortened transaction digest and the one-off coffee bill.
 */

export type Cur = 'zł' | '€' | '$' | 'USDC';
export type GroupKey = 'flat' | 'lisbon' | 'coffee';

export interface Row {
  name: string;
  v: number | null;
  note?: string;
  mem?: boolean;
  dim?: boolean;
}

export type Why =
  | { kind: 'quiet'; text: string }
  | { kind: 'teach'; label: string; text: string; speed: number; neutral?: boolean }
  | { kind: 'learned'; date: string; text: string }
  | { kind: 'group'; mark: string; date: string; text: string }
  | { kind: 'port'; small: string; text: string; travel: boolean }
  | { kind: 'once'; text: string }
  | { kind: 'receipt'; text: string; digest?: string }
  | { kind: 'agent'; seconds: number };

export interface Owed {
  pre: string;
  bold?: string;
  big?: boolean;
}

export interface Card {
  group: GroupKey;
  when: string;
  whenOn: boolean;
  view: 'compose' | 'tab';
  text: string;
  typeKey: number;
  typeSpeed: number;
  typeDelay: number;
  illustrative?: string;
  chips: { label: string; tag?: boolean }[];
  chipsKey: number;
  tab: { small: string; big: string; line: string };
  rows: Row[];
  cur: Cur;
  signed: boolean;
  why: Why | null;
  whyKey: number;
  tip: string;
  owed: Owed | null;
  owedKey: number;
  actA?: string;
  actB?: string;
  pressA: boolean;
  pressB: boolean;
  headline: string;
  trail: boolean;
  avOn: number | null;
}

export const GROUPS: Record<GroupKey, { mark: string; name: string; members: string[]; meta: string }> = {
  flat: { mark: '5B', name: 'Flat 5B', members: ['Ana', 'Ben', 'Clara', 'Dan'], meta: 'Ana, Ben, Clara, Dan · Kraków' },
  lisbon: { mark: 'LT', name: 'Lisbon trip', members: ['Ana', 'Ben', 'Clara'], meta: 'Ana, Ben, Clara · EUR' },
  coffee: { mark: 'CT', name: 'Coffee tab', members: ['Ana', 'Ben', 'Clara', 'Dan'], meta: 'Ana, Ben, Clara, Dan · USD' },
};

export function fmt(v: number, cur: Cur, signed = false): string {
  const s = signed ? (v > 0.004 ? '+' : v < -0.004 ? '−' : '') : '';
  const n = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cur === '$') return `${s}$${n}`;
  if (cur === 'USDC') return `${s}${n} USDC`;
  return `${s}${n} ${cur}`;
}

/** How long the typewriter takes for a line (commas pause a little). */
export function typeMs(text: string, speed: number): number {
  return text.length * speed + (text.match(/,/g)?.length ?? 0) * 90;
}

type Patch = Partial<Card> | ((c: Card) => Partial<Card>);
export type Step = [at: number, patch: Patch];
export interface Beat {
  id: string;
  steps: Step[];
  total: number;
}

/** Let the previous view fade before the next line starts typing. */
const D0 = 360;

const rows = (names: string[], vals: (number | null)[], o: { notes?: string[]; mem?: number[]; dim?: number[] } = {}): Row[] =>
  names.map((name, k) => ({ name, v: vals[k] ?? null, note: o.notes?.[k] ?? '', mem: o.mem?.includes(k), dim: o.dim?.includes(k) }));
const blank = (names: string[]) => rows(names, names.map(() => null));
const why = (w: Why | null, tip = ''): Patch => (c) => ({ why: w, whyKey: c.whyKey + 1, tip });
const owed = (o: Owed | null): Patch => (c) => ({ owed: o, owedKey: c.owedKey + 1 });
const chips = (list: Card['chips']): Patch => (c) => ({ chips: list, chipsKey: c.chipsKey + 1 });
const typed = (text: string, speed: number, illustrative?: string): Patch => (c) => ({
  view: 'compose', text, typeKey: c.typeKey + 1, typeSpeed: speed, typeDelay: D0, illustrative, chips: [], chipsKey: c.chipsKey + 1,
});

const FLAT = GROUPS.flat.members;
const TRIP = GROUPS.lisbon.members;
const CAFE = GROUPS.coffee.members;

/** a · teach: even split, corrected once, saved as Ana's memory, split again */
function teach(): Beat {
  const t = '412 zł dinner at Pod Baranami, Clara paid, 140 of it was wine';
  const said = 'I don’t drink, leave me out of the wine';
  const e = D0 + typeMs(t, 22);
  return {
    id: 'teach',
    steps: [
      [0, { group: 'flat', when: 'New bill', whenOn: false, rows: blank(FLAT), cur: 'zł', signed: false, actA: 'Correct it', actB: 'Looks right', pressA: false, pressB: false, headline: 'who doesn’t drink.', trail: false, avOn: null }],
      [0, typed(t, 22)],
      [0, why(null)],
      [0, owed(null)],
      [e, chips([{ label: '412.00 zł' }, { label: 'Clara paid' }, { label: 'wine 140.00 zł · alcohol', tag: true }])],
      [e + 450, { rows: rows(FLAT, [103, 103, 103, 103], { notes: ['', '', 'paid', ''] }) }],
      [e + 450, why({ kind: 'quiet', text: 'Split evenly. Nothing remembered for this yet.' })],
      [e + 1500, { pressA: true }],
      [e + 1800, { pressA: false }],
      [e + 1800, why({ kind: 'teach', label: 'Correction from Ana', text: said, speed: 26 })],
      [e + 1800 + typeMs(said, 26) + 300, (c) => (c.why?.kind === 'teach' ? { why: { ...c.why, label: 'Saved as a memory, owned by Ana · on Walrus' } } : {})],
      [e + 3900, why({ kind: 'learned', date: 'Oct 14', text: 'Remembered: Ana doesn’t drink' }, 'Memory owned by Ana · stored on Walrus · learned Oct 14 from one correction')],
      [e + 3900, { when: 'Learned', rows: rows(FLAT, [68, 114.67, 114.67, 114.66], { notes: ['no wine', '+ wine 46.67', 'paid · + wine 46.67', '+ wine 46.66'], mem: [0, 1, 2, 3] }) }],
      [e + 4500, owed({ pre: 'Clara is owed ', bold: '297.33 zł' })],
      [e + 5500, { pressB: true }],
    ],
    total: e + 6300,
  };
}

/** b · a group rule, applied by itself: rent on even loops, the taxi rule on odd ones */
function groupRule(cycle: number): Beat {
  const rent = cycle % 2 === 0;
  const t = rent ? '4800 rent for November, Ana paid' : '41 zł Bolt from the airport, Clara paid';
  const e = D0 + typeMs(t, 24);
  return {
    id: rent ? 'rule-rent' : 'rule-taxi',
    steps: [
      [0, { group: 'flat', when: 'New bill', whenOn: false, rows: blank(FLAT), cur: 'zł', signed: false, actA: 'Correct it', actB: 'Looks right', pressA: false, pressB: false, headline: rent ? 'how rent splits.' : 'who covers taxis.', trail: false, avOn: null }],
      [0, typed(t, 24)],
      [0, why(null)],
      [0, owed(null)],
      [e, chips(rent ? [{ label: '4,800.00 zł' }, { label: 'Ana paid' }, { label: 'rent', tag: true }] : [{ label: '41.00 zł' }, { label: 'Clara paid' }, { label: 'taxi', tag: true }])],
      [e + 350, { rows: rent ? rows(FLAT, [1200, 1200, 1200, 1200], { notes: ['paid', '', '', ''] }) : rows(FLAT, [10.25, 10.25, 10.25, 10.25], { notes: ['', '', 'paid', ''] }) }],
      [
        e + 800,
        rent
          ? why({ kind: 'group', mark: '5B', date: 'Oct 15', text: 'Flat 5B rule: rent by room size' }, 'Group memory · Flat 5B · Ana 40%, Ben 20%, Clara 20%, Dan 20% · learned Oct 15')
          : why({ kind: 'group', mark: '5B', date: 'Oct 18', text: 'Flat 5B rule: Ben covers taxis' }, 'Group memory · Flat 5B · learned Oct 18 · stays in this group'),
      ],
      [
        e + 1100,
        {
          rows: rent
            ? rows(FLAT, [1920, 960, 960, 960], { notes: ['paid · 40%', '20%', '20%', '20%'], mem: [0, 1, 2, 3] })
            : rows(FLAT, [0, 41, 0, 0], { notes: ['', 'covers taxis', 'paid', ''], mem: [1], dim: [0, 2, 3] }),
        },
      ],
      [e + 1700, owed(rent ? { pre: 'Ana is owed ', bold: '2,880.00 zł' } : { pre: 'Ben owes Clara ', bold: '41.00 zł' })],
      [e + 3000, { pressB: true }],
    ],
    total: e + 4600,
  };
}

/** c · portable: Ana's own memory arrives in a group where nobody taught it */
function portable(): Beat {
  const t = '84 € Time Out Market dinner, Ben paid, 24 of it was wine';
  const e = D0 + typeMs(t, 22);
  return {
    id: 'portable',
    steps: [
      [0, { group: 'lisbon', when: 'New bill', whenOn: false, rows: blank(TRIP), cur: '€', signed: false, actA: 'Correct it', actB: 'Looks right', pressA: false, pressB: false, headline: 'who doesn’t drink.', trail: false, avOn: null }],
      [0, typed(t, 22)],
      [0, why(null)],
      [0, owed(null)],
      [e, chips([{ label: '84.00 €' }, { label: 'Ben paid' }, { label: 'wine 24.00 € · alcohol', tag: true }])],
      [e + 350, { rows: rows(TRIP, [28, 28, 28], { notes: ['', 'paid', ''] }) }],
      [e + 900, { trail: true, avOn: 0 }],
      [
        e + 900,
        why(
          { kind: 'port', small: 'learned in Flat 5B, Oct 14', text: 'From Ana’s memory: no alcohol on her share', travel: true },
          'Memory owned by Ana · stored on Walrus · learned in Flat 5B on Oct 14 · follows her to every group she joins',
        ),
      ],
      [e + 2100, { trail: false, when: 'From Ana’s memory', rows: rows(TRIP, [20, 32, 32], { notes: ['no wine', 'paid · + wine 12.00', '+ wine 12.00'], mem: [0, 1, 2] }) }],
      [e + 2700, owed({ pre: 'Ben is owed ', bold: '52.00 €' })],
      [e + 4200, { pressB: true, avOn: null }],
    ],
    total: e + 5400,
  };
}

/** e · settle: the Coffee tab, one tap, gasless USDC on Sui */
function settle(): Beat {
  return {
    id: 'settle',
    steps: [
      [
        0,
        {
          group: 'coffee', when: 'Tab', whenOn: false, view: 'tab', cur: 'USDC', signed: true, trail: false, avOn: null,
          tab: { small: 'Coffee tab · balance', big: 'Dan owes Clara 0.50 USDC', line: '2 payments to quits' },
          rows: rows(CAFE, [-0.3, 0.3, 0.5, -0.5], { notes: ['owes Ben', 'is owed', 'is owed', 'owes Clara'] }),
          actA: undefined, actB: 'Pay 0.50 USDC', pressA: false, pressB: false,
        },
      ],
      [0, why(null)],
      [0, owed({ pre: 'Dan pays in one tap' })],
      [1500, { pressB: true }],
      [2100, why({ kind: 'receipt', text: 'Settled on Sui · gasless', digest: '7Kq…f3a' }, 'USDC transfer on Sui mainnet · no gas paid by Dan')],
      [2100, (c) => ({ rows: rows(CAFE, [-0.3, 0.3, 0, 0], { notes: ['owes Ben', 'is owed', 'settled', 'paid Clara'], dim: [2, 3] }), tab: { ...c.tab, line: '1 payment to quits' } })],
      [3000, { actB: undefined }],
      [3000, owed({ pre: 'Dan paid in one tap' })],
    ],
    total: 5200,
  };
}

/** f · the agent pays within the limit Ana signed, after a real 60-second window to object */
function agent(): Beat {
  return {
    id: 'agent',
    steps: [
      [
        0,
        {
          group: 'coffee', when: 'Auto-settle', whenOn: false, view: 'tab', cur: 'USDC', signed: true, trail: false, avOn: null,
          tab: { small: 'Coffee tab · balance', big: 'Ana owes Ben 0.30 USDC', line: 'Ana’s agent pays this · at most 2 USDC a week' },
          rows: rows(CAFE, [-0.3, 0.3, 0, 0], { notes: ['owes Ben', 'is owed', '', ''], dim: [2, 3] }),
          actA: 'Object', actB: undefined, pressA: false, pressB: false,
        },
      ],
      [0, why({ kind: 'agent', seconds: 60 }, 'Ana’s mandate on Sui: only exact debts, only to people she named, at most 2 USDC a week, 60 seconds to object')],
      [0, owed({ pre: 'Only the exact debt, only to Ben' })],
      [4300, why({ kind: 'receipt', text: '60 seconds later: paid by Ana’s agent' }, 'Paid in USDC on Sui from Ana’s allowance, within the 2 USDC weekly limit')],
      [
        4300,
        (c) => ({
          actA: undefined,
          rows: rows(CAFE, [0, 0, 0, 0], { notes: ['paid by her agent', 'paid back', '', ''], mem: [0], dim: [1, 2, 3] }),
          tab: { ...c.tab, big: 'Nobody owes anybody', line: '0.30 of 2 USDC used this week' },
        }),
      ],
      [5000, { when: 'Quits', whenOn: true }],
      [5000, owed({ pre: 'Quits.', big: true })],
    ],
    total: 6800,
  };
}

/** d · a one-off fix: corrected for this bill, nothing learned (illustrative coffee bill) */
function oneOff(): Beat {
  const t = '$1.20 coffees, Clara paid';
  const said = 'Dan wasn’t there.';
  const e = D0 + typeMs(t, 24);
  return {
    id: 'one-off',
    steps: [
      [0, { group: 'coffee', when: 'New bill', whenOn: false, rows: blank(CAFE), cur: '$', signed: false, actA: 'Correct it', actB: 'Looks right', pressA: false, pressB: false, trail: false, avOn: null }],
      [0, typed(t, 24, 'coffee-one-off')],
      [0, why(null)],
      [0, owed(null)],
      [e, chips([{ label: '$1.20' }, { label: 'Clara paid' }, { label: 'coffee' }])],
      [e + 350, { rows: rows(CAFE, [0.3, 0.3, 0.3, 0.3], { notes: ['', '', 'paid', ''] }) }],
      [e + 1200, { pressA: true }],
      [e + 1500, { pressA: false }],
      [e + 1500, why({ kind: 'teach', label: 'Correction', text: said, speed: 34, neutral: true })],
      [e + 2700, why({ kind: 'once', text: 'Fixed for this bill · nothing learned' }, 'A one-off: Dan is left out of this bill only. No memory was written.')],
      [e + 2700, { rows: rows(CAFE, [0.4, 0.4, 0.4, 0], { notes: ['', '', 'paid', 'wasn’t there'], dim: [3] }) }],
      [e + 3300, owed({ pre: 'Clara is owed ', bold: '$0.80' })],
      [e + 4400, { pressB: true }],
    ],
    total: e + 5800,
  };
}

export const BEAT_COUNT = 6;
export function beatAt(i: number, cycle: number): Beat {
  switch (i) {
    case 0:
      return teach();
    case 1:
      return groupRule(cycle);
    case 2:
      return portable();
    case 3:
      return settle();
    case 4:
      return agent();
    default:
      return oneOff();
  }
}

/** One complete still (reduced motion, first paint): Ana's memory applied in the Lisbon trip. */
export const STILL: Card = {
  group: 'lisbon',
  when: 'From Ana’s memory',
  whenOn: false,
  view: 'compose',
  text: '84 € Time Out Market dinner, Ben paid, 24 of it was wine',
  typeKey: 0,
  typeSpeed: 0,
  typeDelay: 0,
  chips: [{ label: '84.00 €' }, { label: 'Ben paid' }, { label: 'wine 24.00 € · alcohol', tag: true }],
  chipsKey: 0,
  tab: { small: '', big: '', line: '' },
  rows: rows(TRIP, [20, 32, 32], { notes: ['no wine', 'paid · + wine 12.00', '+ wine 12.00'], mem: [0, 1, 2] }),
  cur: '€',
  signed: false,
  why: { kind: 'port', small: 'learned in Flat 5B, Oct 14', text: 'From Ana’s memory: no alcohol on her share', travel: false },
  whyKey: 0,
  tip: 'Memory owned by Ana · stored on Walrus · learned in Flat 5B on Oct 14 · follows her to every group she joins',
  owed: { pre: 'Ben is owed ', bold: '52.00 €' },
  owedKey: 0,
  actA: 'Correct it',
  actB: 'Looks right',
  pressA: false,
  pressB: false,
  headline: 'who doesn’t drink.',
  trail: false,
  avOn: null,
};
