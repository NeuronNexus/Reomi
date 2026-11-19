import { GENDER_GROUP, INTERESTS } from '@reomi/shared';
import type { GENDERS } from '@reomi/shared';

type Gender = (typeof GENDERS)[number];
type Group = (typeof INTERESTS)[number];

export interface Person {
  gender: Gender | null;
  wants: readonly string[];
}

export interface GroupPressure {
  group: Group;
  /** Seekers of this group, split evenly when someone wants several groups. */
  demand: number;
  /** People in the room who belong to this group. */
  supply: number;
}

export interface Assessment {
  ok: boolean;
  groups: GroupPressure[];
  /** Groups whose seekers are paused, when `ok` is false. */
  blockedFor: Group[];
}

/**
 * How lopsided a group may get. Demand may reach `RATIO` seekers per person in the group, with a
 * little `SLACK` so that a room can start before both sides have arrived.
 */
export const RATIO = 2;
export const SLACK = 2;

const isGroup = (value: string): value is Group => (INTERESTS as readonly string[]).includes(value);

export const pressure = (people: readonly Person[]): GroupPressure[] => {
  const totals = new Map<Group, GroupPressure>(
    INTERESTS.map((group) => [group, { group, demand: 0, supply: 0 }]),
  );
  for (const person of people) {
    if (person.gender) totals.get(GENDER_GROUP[person.gender])!.supply += 1;
    const wants = person.wants.filter(isGroup);
    for (const group of wants) totals.get(group)!.demand += 1 / wants.length;
  }
  return [...totals.values()].map((entry) => ({
    ...entry,
    demand: Math.round(entry.demand * 100) / 100,
  }));
};

const allowed = ({ demand, supply }: GroupPressure): boolean =>
  demand <= Math.max(RATIO * supply, supply + SLACK) + 1e-9;

/**
 * Balances reciprocal interest rather than head counts. A newcomer is paused only when a group they
 * want to meet is already oversubscribed and their arrival would make it worse. Someone who adds
 * supply to a scarce group is always welcome, and groups nobody is seeking are never limited.
 */
export const assessAdmission = (members: readonly Person[], candidate: Person): Assessment => {
  const before = pressure(members);
  const after = pressure([...members, candidate]);
  const wants = new Set(candidate.wants.filter(isGroup));

  const blockedFor = after
    .filter((group, index) => {
      if (!wants.has(group.group) || allowed(group)) return false;
      // Already over the line before this person: only block if they push it further out.
      const previous = before[index]!;
      return group.demand - group.supply > previous.demand - previous.supply;
    })
    .map((group) => group.group);

  return { ok: blockedFor.length === 0, groups: after, blockedFor };
};

/** Whether the room as it stands is within the limits. */
export const isHealthy = (people: readonly Person[]): boolean => pressure(people).every(allowed);

const GROUP_WORDS: Record<Group, string> = {
  women: 'women',
  men: 'men',
  non_binary: 'non-binary and gender-diverse people',
};

export const explainBlock = (blockedFor: readonly Group[]): string => {
  const words = blockedFor.map((group) => GROUP_WORDS[group]);
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : words[0];
  return (
    `This room already has more people looking for ${list} than it can match right now, ` +
    'so new seekers are paused until it balances out.'
  );
};

/** Two people could be interested in each other. */
export const mutuallyCompatible = (a: Person, b: Person): boolean =>
  Boolean(
    a.gender &&
    b.gender &&
    a.wants.includes(GENDER_GROUP[b.gender]) &&
    b.wants.includes(GENDER_GROUP[a.gender]),
  );
