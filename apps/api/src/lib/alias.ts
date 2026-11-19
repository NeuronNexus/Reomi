import { randomInt } from 'node:crypto';

const ADJECTIVES = [
  'Amber',
  'Ashen',
  'Bold',
  'Bright',
  'Calm',
  'Clever',
  'Cosmic',
  'Crimson',
  'Curious',
  'Dusky',
  'Electric',
  'Fabled',
  'Fierce',
  'Gentle',
  'Gilded',
  'Golden',
  'Hidden',
  'Hushed',
  'Indigo',
  'Lucid',
  'Lunar',
  'Merry',
  'Misty',
  'Mellow',
  'Mystic',
  'Nimble',
  'Noble',
  'Opal',
  'Quiet',
  'Radiant',
  'Restless',
  'Rustic',
  'Scarlet',
  'Serene',
  'Silver',
  'Smoky',
  'Solar',
  'Stormy',
  'Velvet',
  'Wandering',
];

const NOUNS = [
  'Aurora',
  'Banyan',
  'Comet',
  'Crane',
  'Cypress',
  'Dove',
  'Drifter',
  'Ember',
  'Falcon',
  'Fern',
  'Finch',
  'Firefly',
  'Fox',
  'Harbor',
  'Hawk',
  'Heron',
  'Horizon',
  'Ibis',
  'Jasmine',
  'Kestrel',
  'Koel',
  'Lantern',
  'Lark',
  'Lotus',
  'Lynx',
  'Mango',
  'Meadow',
  'Monsoon',
  'Moth',
  'Myna',
  'Nomad',
  'Otter',
  'Panther',
  'Peacock',
  'Pebble',
  'Quill',
  'Raven',
  'River',
  'Sparrow',
  'Willow',
];

const pick = (items: string[]): string => items[randomInt(items.length)] as string;

/** Picks a pseudonym not yet used in the room, numbering it once the room gets crowded. */
export const generateAlias = (taken: ReadonlySet<string>): string => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const alias = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
    if (!taken.has(alias)) return alias;
  }
  for (;;) {
    const alias = `${pick(ADJECTIVES)} ${pick(NOUNS)} ${randomInt(1000, 100_000)}`;
    if (!taken.has(alias)) return alias;
  }
};
