import { describe, expect, it } from 'vitest';
import { scanCommunityText, scanMessage } from '../src/lib/moderation';
import type { ScanContext } from '../src/lib/moderation';

const context = (overrides: Partial<ScanContext> = {}): ScanContext => ({
  sender: { fullName: 'Ananya Rao', email: 'ananya.rao@example.com' },
  others: [
    { fullName: 'Rohan Mehta', email: 'rohanm@example.com' },
    { fullName: 'Meera Iyer', email: 'meera.iyer@mail.com' },
  ],
  aliases: ['Amber Fox', 'Quiet Heron', 'Lunar Moth'],
  allowContact: false,
  ...overrides,
});

const verdictOf = (text: string, overrides?: Partial<ScanContext>) =>
  scanMessage(text, context(overrides));

describe('identity disclosure', () => {
  it('lets ordinary conversation through', () => {
    expect(verdictOf('Mountains for me, always. What about you, Quiet Heron?').verdict).toBe(
      'allow',
    );
    expect(verdictOf('I think the host picked a great question').verdict).toBe('allow');
  });

  it('blocks naming another participant as a strike', () => {
    const result = verdictOf('Pretty sure Quiet Heron is actually Rohan from Bandra');
    expect(result).toMatchObject({
      verdict: 'block',
      reason: 'identity_other',
      severity: 'strong',
    });
  });

  it('catches full names, surnames, emails and spaced-out spellings', () => {
    expect(verdictOf('hi mehta').verdict).toBe('block');
    expect(verdictOf('write to rohanm@example.com').verdict).toBe('block');
    expect(verdictOf('it is r.o.h.a.n lol').verdict).toBe('block');
    expect(verdictOf('MEERA IYER is here').verdict).toBe('block');
  });

  it('does not confuse alias words with names', () => {
    const result = scanMessage('Amber Fox, your answer was the best', {
      ...context(),
      others: [{ fullName: 'Amber Shah', email: 'a.shah@example.com' }],
    });
    expect(result.verdict).toBe('allow');
  });

  it('holds back self-disclosure and contact details without a strike', () => {
    expect(verdictOf('I am Ananya btw')).toMatchObject({
      reason: 'identity_self',
      severity: 'soft',
    });
    expect(verdictOf('call me on +91 98765 43210')).toMatchObject({
      reason: 'contact_info',
      severity: 'soft',
    });
    expect(verdictOf('my insta is @night.owl_22')).toMatchObject({ reason: 'contact_info' });
    expect(verdictOf('add me on instagram.com/someone')).toMatchObject({ reason: 'contact_info' });
  });

  it('allows contact details between people who revealed to each other', () => {
    expect(verdictOf('call me on +91 98765 43210', { allowContact: true }).verdict).toBe('allow');
  });

  it('still protects third parties after a reveal', () => {
    expect(verdictOf('by the way that is Meera', { allowContact: true }).verdict).toBe('block');
  });
});

describe('community harassment', () => {
  it('blocks slut-shaming and appearance insults', () => {
    expect(scanCommunityText('what a slut')).toMatchObject({
      verdict: 'block',
      severity: 'strong',
    });
    expect(scanCommunityText('you look ugly in this')).toMatchObject({
      verdict: 'block',
      severity: 'soft',
    });
  });

  it('lets kind feedback through', () => {
    expect(scanCommunityText('Love the colours in this outfit!').verdict).toBe('allow');
  });
});
