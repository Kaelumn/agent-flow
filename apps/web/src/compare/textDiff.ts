export interface Piece {
  text: string;
  kind: 'same' | 'del' | 'ins';
}

const tokens = (s: string) => s.split(/(\s+)/).filter((t) => t !== '');

/** Past this many token pairs the exact comparison gets slow, so the two texts are shown whole instead. */
const MAX_PAIRS = 250_000;

/**
 * A word-level comparison of two texts: what stays, what was removed from `before`, what was added in `after`.
 * Returns the pieces for each side, so each side can be drawn with its own highlights.
 */
export function wordDiff(before: string, after: string): { before: Piece[]; after: Piece[] } {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > MAX_PAIRS) return { before: [{ text: before, kind: 'del' }], after: [{ text: after, kind: 'ins' }] };

  // Longest common subsequence of tokens.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] = a[i] === b[j] ? lcs[(i + 1) * cols + j + 1]! + 1 : Math.max(lcs[(i + 1) * cols + j]!, lcs[i * cols + j + 1]!);
    }
  }

  const left: Piece[] = [];
  const right: Piece[] = [];
  const push = (list: Piece[], text: string, kind: Piece['kind']) => {
    const last = list[list.length - 1];
    if (last && last.kind === kind) last.text += text;
    else list.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(left, a[i]!, 'same');
      push(right, b[j]!, 'same');
      i++;
      j++;
    } else if (lcs[(i + 1) * cols + j]! >= lcs[i * cols + j + 1]!) push(left, a[i++]!, 'del');
    else push(right, b[j++]!, 'ins');
  }
  while (i < a.length) push(left, a[i++]!, 'del');
  while (j < b.length) push(right, b[j++]!, 'ins');
  return { before: left, after: right };
}
