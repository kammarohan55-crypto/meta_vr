/**
 * Player names. A name is typed by its owner and read by everyone at the table, so the same
 * rule runs where it is typed (the browser) and where it is accepted (the table host).
 */

/** Longest name the name screen lets you type. */
export const NAME_MAX = 12;

/** Never shown at a table, wherever they sit in the name (letters only, after undoing digit swaps). */
const BLOCKED_ANYWHERE = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'pussy', 'hitler'];
/** Blocked only as a whole word: inside longer names they are innocent ("Grape", "Cassie"). */
const BLOCKED_WORDS = ['rape', 'nazi', 'porn', 'cock', 'ass', 'sex'];

const SWAPS: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

/**
 * A name fit to show: letters (with their accents and vowel signs), digits, spaces and
 * . ' _ - only, single spaces, at most 16 characters. Returns '' for an empty or blocked name,
 * so the caller keeps its fallback.
 */
export function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[^\p{L}\p{M}\p{N} _.'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
    .trim();
  const plain = name.toLowerCase().replace(/[013457]/g, (d) => SWAPS[d]);
  const letters = plain.replace(/[^a-z]/g, '');
  if (BLOCKED_ANYWHERE.some((w) => letters.includes(w))) return '';
  if (plain.split(/[^a-z]+/).some((w) => BLOCKED_WORDS.includes(w))) return '';
  return name;
}
