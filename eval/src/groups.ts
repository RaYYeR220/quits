import { RuleSchema, type Member, type Rule } from '@quits/core';

export const GROUP_IDS = ['flat', 'trip', 'couple'] as const;
export type GroupId = (typeof GROUP_IDS)[number];

/** A split habit the group never wrote down, and the ways a member says it out loud. */
export interface HiddenRule {
  rule: Rule;
  /** Paraphrases of the correction. They name the habit, never the resulting amounts. */
  say: string[];
}

export interface GroupDef {
  id: GroupId;
  name: string;
  about: string;
  members: Member[];
  hidden: HiddenRule[];
}

const LEARNED = '2026-10-01T00:00:00.000Z';

function hidden(id: string, body: Record<string, unknown>, say: string[]): HiddenRule {
  return { rule: RuleSchema.parse({ v: 1, id, learnedAt: LEARNED, ...body }), say };
}

const people = (...names: string[]): Member[] => names.map((n) => ({ id: n.toLowerCase(), name: n }));

const anaNoAlcohol = (g: string) =>
  hidden(`${g}.ana-no-alcohol`, { kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] } }, [
    'Ana doesn’t drink, leave her out of the alcohol.',
    'No alcohol on Ana’s share please.',
    'Ana’s teetotal, take the booze off her share.',
  ]);

const claraNoMeat = (g: string) =>
  hidden(`${g}.clara-no-meat`, { kind: 'exclude', member: 'clara', when: { tags: ['meat'] } }, [
    'Clara doesn’t eat meat, she shouldn’t pay for it.',
    'Leave Clara out of anything with meat.',
    'Take the meat off Clara’s share, she never eats it.',
  ]);

export const GROUPS: Record<GroupId, GroupDef> = {
  flat: {
    id: 'flat',
    name: 'Flat 5B',
    about: 'Four flatmates sharing rent, bills, groceries and nights out. Rent is paid weekly.',
    members: people('Ana', 'Ben', 'Clara', 'Dan'),
    hidden: [
      hidden('flat.rent-by-room', { kind: 'weights', weights: { ana: 40, ben: 20, clara: 20, dan: 20 }, when: { category: ['rent'] } }, [
        'Ana has the big room, so she pays double what each of the others pays on rent.',
        'Rent isn’t even: Ana’s room is twice the size, so her share is twice anyone else’s.',
        'Rent goes by room size. Ana pays 40%, Ben, Clara and Dan 20% each.',
      ]),
      anaNoAlcohol('flat'),
      hidden('flat.ben-covers-taxis', { kind: 'covers', member: 'ben', when: { category: ['taxi'] } }, [
        'Ben always pays for the taxis himself.',
        'Taxis are on Ben, he expenses them through work.',
        'Don’t split cabs, Ben covers every ride.',
      ]),
      claraNoMeat('flat'),
      hidden('flat.dan-no-subscriptions', { kind: 'exclude', member: 'dan', when: { category: ['subscription'] } }, [
        'Dan doesn’t use any of the subscriptions, keep him off them.',
        'Leave Dan out of the streaming subscriptions.',
        'Dan never signed up for these subscriptions, he shouldn’t pay.',
      ]),
    ],
  },
  trip: {
    id: 'trip',
    name: 'Alps road trip',
    about:
      'Five friends on a four-week winter trip. Ana, Ben and Clara drive Ana’s car; Dan and Eve take the train between stops. Only Ben, Dan and Eve ski.',
    members: people('Ana', 'Ben', 'Clara', 'Dan', 'Eve'),
    hidden: [
      anaNoAlcohol('trip'),
      claraNoMeat('trip'),
      hidden('trip.skiers-pay-ski', { kind: 'only', members: ['ben', 'dan', 'eve'], when: { tags: ['ski'] } }, [
        'Only Ben, Dan and Eve ski, so the ski stuff is just on them.',
        'Ana and Clara don’t ski, leave them out of the ski passes and rentals.',
        'Split anything for skiing between the skiers: Ben, Dan and Eve.',
      ]),
      hidden('trip.car-pays-fuel', { kind: 'only', members: ['ana', 'ben', 'clara'], when: { tags: ['fuel'] } }, [
        'Petrol is only for the people in the car: Ana, Ben and Clara.',
        'Dan and Eve take the train, they don’t pay for fuel.',
        'Split the fuel between Ana, Ben and Clara, they’re the ones in the car.',
      ]),
      hidden('trip.ana-double-lodging', { kind: 'weights', weights: { ana: 2, ben: 1, clara: 1, dan: 1, eve: 1 }, when: { category: ['accommodation'] } }, [
        'Ana has a room to herself, so she pays a double share of the lodging.',
        'Accommodation isn’t even: Ana’s share is twice everyone else’s because she gets her own room.',
        'Ana pays two shares of every place we stay, the rest of us one each.',
      ]),
    ],
  },
  couple: {
    id: 'couple',
    name: 'Fin & Gia',
    about: 'A couple sharing a household. They split everything by income, but what you buy for yourself is yours.',
    members: people('Fin', 'Gia'),
    hidden: [
      hidden('couple.sixty-forty', { kind: 'weights', weights: { fin: 60, gia: 40 }, when: {} }, [
        'We split everything 60/40, Fin pays the bigger part.',
        'It’s not half and half: Fin pays three parts for every two of Gia’s.',
        'Fin takes 60% and Gia 40% of everything we share.',
      ]),
      hidden('couple.fin-personal', { kind: 'only', members: ['fin'], when: { tags: ['personal'], payer: 'fin' } }, [
        'Fin bought that for himself, his personal things are on him.',
        'Personal stuff Fin buys is his alone, don’t split it.',
        'When Fin buys something just for himself, Gia shouldn’t pay any of it.',
      ]),
      hidden('couple.gia-personal', { kind: 'only', members: ['gia'], when: { tags: ['personal'], payer: 'gia' } }, [
        'Gia bought that for herself, her personal things are on her.',
        'Personal stuff Gia buys is hers alone, don’t split it.',
        'When Gia buys something just for herself, Fin shouldn’t pay any of it.',
      ]),
    ],
  },
};

/** What a member says when the split should just be even and something got in the way. */
export const SAY_EVEN = [
  'This one is just split evenly between everyone who was there.',
  'Nothing special about this one, split it equally.',
  'Everyone pays the same on this one.',
];

export function hiddenRules(g: GroupDef): Rule[] {
  return g.hidden.map((h) => h.rule);
}
