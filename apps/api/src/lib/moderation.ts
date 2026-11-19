import type { FLAG_REASONS, FLAG_SEVERITIES } from '@reomi/shared';

type Reason = (typeof FLAG_REASONS)[number];
type Severity = (typeof FLAG_SEVERITIES)[number];

export interface Identity {
  fullName: string | null;
  email: string;
  city?: string | null;
}

export interface ScanContext {
  sender: Identity;
  /** Everyone else whose identity must stay hidden from this audience. */
  others: readonly Identity[];
  /** Aliases used in the room. Their words are not names, even if they look like one. */
  aliases: readonly string[];
  /** Two people who revealed to each other may swap contact details. */
  allowContact: boolean;
}

export type Verdict =
  | { verdict: 'allow' }
  | { verdict: 'block'; reason: Reason; severity: Severity; matched: string; message: string };

/** Words too common to treat as a name on their own, even when someone is called that. */
const COMMON_WORDS = new Set(
  `the and you are for not but all any can had her was one our out day get has him his how man new
  now old see two way who boy did its let put say she too use dad mom sun joy love hope rose will
  may june grace faith happy lucky sunny honey baby sweet star king queen raj ram dev ash sky rain
  bob max ben sam tom ray amber silver golden river lotus jasmine dove fox hawk raven willow fern
  meadow harbor lark heron finch otter`
    .split(/\s+/)
    .filter(Boolean),
);

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '@': 'a',
  $: 's',
  '7': 't',
};

const normalise = (text: string): string =>
  text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

const deLeet = (text: string): string => text.replace(/[0134@$57]/g, (char) => LEET[char] ?? char);

const squash = (text: string): string => deLeet(text).replace(/[^a-z]/g, '');

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasWord = (haystack: string, word: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${escapeRegex(word)}($|[^a-z0-9])`).test(haystack);

/** The pieces of someone's identity worth looking for, longest first. */
export const identityTerms = (identity: Identity): string[] => {
  const terms = new Set<string>();
  const name = normalise(identity.fullName ?? '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter((part) => part.length >= 3 && !COMMON_WORDS.has(part));
    for (const part of parts) terms.add(part);
    if (name.includes(' ')) terms.add(name);
  }
  const email = normalise(identity.email);
  if (email.includes('@')) {
    terms.add(email);
    const local = email.split('@')[0]!.replace(/[^a-z0-9._]/g, '');
    if (local.length >= 4 && !COMMON_WORDS.has(local)) terms.add(local);
  }
  return [...terms].sort((a, b) => b.length - a.length);
};

const findIdentity = (text: string, squashed: string, identity: Identity): string | null => {
  for (const term of identityTerms(identity)) {
    if (hasWord(text, term) || hasWord(deLeet(text), term)) return term;
    // Catches spaced or dotted spellings like "r.o.h.a.n" for longer names.
    const flat = term.replace(/[^a-z]/g, '');
    if (flat.length >= 5 && squashed.includes(flat)) return term;
  }
  return null;
};

const CONTACT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, label: 'an email address' },
  { pattern: /(?:\+?\d[\s-]?){10,}/, label: 'a phone number' },
  {
    pattern:
      /\b(?:insta(?:gram)?|ig|snap(?:chat)?|telegram|tg|whats\s?app|wa|twitter|linkedin|fb|facebook|discord)\b\s*(?:id|handle|is|:|-|@)?\s*@?[a-z0-9._]{3,}/i,
    label: 'a social handle',
  },
  { pattern: /(^|\s)@[a-z0-9._]{3,}/i, label: 'a social handle' },
  {
    pattern:
      /\b(?:https?:\/\/|www\.)\S+|\b(?:instagram\.com|facebook\.com|linkedin\.com|twitter\.com|x\.com|snapchat\.com|t\.me|wa\.me|discord\.gg)\/\S*/i,
    label: 'a link',
  },
];

/**
 * Decides whether a message may be delivered. It runs before anything is stored or sent, so a
 * disclosure never reaches the room. Exposing someone else is a strike; revealing yourself or
 * sharing contact details outside a mutual reveal is only blocked, with a nudge to use Reveal.
 */
export const scanMessage = (raw: string, context: ScanContext): Verdict => {
  let text = normalise(raw);
  for (const alias of context.aliases) {
    text = text.split(normalise(alias)).join(' ');
  }
  const squashed = squash(text);

  for (const other of context.others) {
    const matched = findIdentity(text, squashed, other);
    if (matched) {
      return {
        verdict: 'block',
        reason: 'identity_other',
        severity: 'strong',
        matched,
        message:
          'That message looks like it identifies someone else in this room, so it was not sent. ' +
          'Exposing another person is against the rules and counts as a strike.',
      };
    }
  }

  if (context.allowContact) return { verdict: 'allow' };

  const ownMatch = findIdentity(text, squashed, context.sender);
  if (ownMatch) {
    return {
      verdict: 'block',
      reason: 'identity_self',
      severity: 'soft',
      matched: ownMatch,
      message:
        'That message includes your real name or email, so we held it back. ' +
        'Use Reveal when you are ready to share who you are.',
    };
  }

  for (const { pattern, label } of CONTACT_PATTERNS) {
    // Aliases are already stripped from `text`, so "@Amber Fox" mentions are not handles.
    const found = text.match(pattern);
    if (found) {
      return {
        verdict: 'block',
        reason: 'contact_info',
        severity: 'soft',
        matched: found[0].trim(),
        message: `That message contains ${label}, so it was not sent. Swap details after a mutual reveal.`,
      };
    }
  }

  return { verdict: 'allow' };
};

/**
 * Words that attack people rather than ideas, aimed at the harassment communities exist to avoid:
 * appearance insults and slut-shaming. Strong terms are a strike, mild ones are only held back.
 */
const STRONG_TERMS = [
  'slut',
  'whore',
  'randi',
  'chhinal',
  'kill yourself',
  'kys',
  'go die',
  'bitch',
  'skank',
  'tharki',
];
const MILD_TERMS = ['ugly', 'fatso', 'fatty', 'disgusting body', 'gross body', 'loser', 'pathetic'];

export const scanCommunityText = (raw: string): Verdict => {
  const text = deLeet(normalise(raw));
  for (const term of STRONG_TERMS) {
    if (hasWord(text, term)) {
      return {
        verdict: 'block',
        reason: 'harassment',
        severity: 'strong',
        matched: term,
        message:
          'That reads as harassment, so it was not posted. Insults about bodies, looks or sex lives are not allowed here.',
      };
    }
  }
  for (const term of MILD_TERMS) {
    if (hasWord(text, term)) {
      return {
        verdict: 'block',
        reason: 'harassment',
        severity: 'soft',
        matched: term,
        message:
          'That might land as a put-down, so we held it back. Keep feedback about the work, not the person.',
      };
    }
  }
  return { verdict: 'allow' };
};
