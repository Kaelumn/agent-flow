const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(ms: number) {
  const diff = ms - Date.now();
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return relative.format(Math.round(diff / size), unit);
  }
  return 'just now';
}

export const fullTime = (ms: number) => new Date(ms).toLocaleString('en-US');

export const pretty = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
