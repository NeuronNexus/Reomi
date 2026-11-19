import { describe, expect, it } from 'vitest';
import { assessAdmission, isHealthy, mutuallyCompatible, pressure } from '../src/lib/balance';
import type { Person } from '../src/lib/balance';

const man = (wants: string[] = ['women']): Person => ({ gender: 'man', wants });
const woman = (wants: string[] = ['men']): Person => ({ gender: 'woman', wants });
const nb = (wants: string[]): Person => ({ gender: 'non_binary', wants });

describe('interest balancing', () => {
  it('lets a room start before both sides arrive', () => {
    expect(assessAdmission([], man()).ok).toBe(true);
    expect(assessAdmission([man()], man()).ok).toBe(true);
  });

  it('pauses more seekers of a scarce group', () => {
    const room = [man(), man()];
    const result = assessAdmission(room, man());
    expect(result.ok).toBe(false);
    expect(result.blockedFor).toEqual(['women']);
  });

  it('always welcomes someone who supplies the scarce group', () => {
    const room = [man(), man(), man(), man()];
    expect(assessAdmission(room, woman()).ok).toBe(true);
  });

  it('reopens once the room balances', () => {
    const room = [man(), man(), woman()];
    expect(assessAdmission(room, man()).ok).toBe(true);
    expect(assessAdmission([...room, man(), man()], man()).ok).toBe(false);
  });

  it('balances reciprocal interest, not head counts', () => {
    // Four women seeking women are fine together even with no men at all.
    const room = [woman(['women']), woman(['women']), woman(['women'])];
    expect(assessAdmission(room, woman(['women'])).ok).toBe(true);
  });

  it('splits demand for people interested in several groups', () => {
    const groups = pressure([man(['women', 'men'])]);
    expect(groups.find((g) => g.group === 'women')!.demand).toBe(0.5);
    expect(groups.find((g) => g.group === 'men')!.demand).toBe(0.5);
    expect(groups.find((g) => g.group === 'men')!.supply).toBe(1);
  });

  it('does not limit groups nobody is seeking', () => {
    const room = [woman(), woman(), woman(), woman(), woman()];
    expect(assessAdmission(room, woman()).ok).toBe(false);
    expect(assessAdmission(room, nb(['non_binary'])).ok).toBe(true);
  });

  it('reports health for the host', () => {
    expect(isHealthy([man(), woman()])).toBe(true);
    expect(isHealthy([man(), man(), man(), man()])).toBe(false);
  });

  it('knows who could like whom', () => {
    expect(mutuallyCompatible(man(), woman())).toBe(true);
    expect(mutuallyCompatible(man(), man())).toBe(false);
    expect(mutuallyCompatible(woman(['women']), woman(['women', 'men']))).toBe(true);
  });
});
