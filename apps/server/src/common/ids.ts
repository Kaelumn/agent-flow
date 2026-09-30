import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function random(length: number) {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** Record ids: sortable by creation time, 20 chars. */
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${random(19 - prefix.length - 8)}`;

/** Node and edge ids inside a graph: short enough to read in a chat. */
export const newElementId = (prefix: string) => `${prefix}_${random(6)}`;
