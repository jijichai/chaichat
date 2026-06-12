// Random, friendly, ePDS-safe handles: ^[a-z0-9-]{5,20}$, no dots, no edge hyphens.
// adj(≤8) + '-' + noun(≤8) + '-' + 2 digits ≤ 20 chars.

const ADJECTIVES = [
  'quiet', 'amber', 'brave', 'calm', 'clever', 'cosmic', 'crisp', 'dapper',
  'dusty', 'eager', 'fuzzy', 'gentle', 'golden', 'happy', 'humble', 'jolly',
  'keen', 'lively', 'lucky', 'mellow', 'misty', 'noble', 'peppy', 'plucky',
  'proud', 'rapid', 'rosy', 'rustic', 'silent', 'silky', 'snappy', 'spicy',
  'sunny', 'swift', 'tender', 'tidy', 'velvet', 'vivid', 'warm', 'witty',
  'zesty', 'breezy', 'chill', 'daring', 'floral', 'frosty', 'honest', 'mighty',
];

const NOUNS = [
  'otter', 'falcon', 'badger', 'comet', 'dahlia', 'ember', 'fjord', 'gecko',
  'harbor', 'iris', 'jasper', 'kestrel', 'lagoon', 'mango', 'nebula', 'onyx',
  'panda', 'quartz', 'raven', 'sparrow', 'tiger', 'umbra', 'violet', 'walnut',
  'yarrow', 'zephyr', 'acorn', 'bonsai', 'cedar', 'dune', 'echo', 'fern',
  'grove', 'heron', 'inlet', 'juniper', 'kelp', 'lotus', 'meadow', 'nutmeg',
  'orchid', 'pebble', 'reef', 'sage', 'thistle', 'willow', 'saffron', 'tundra',
];

function pick<T>(arr: readonly T[]): T {
  const i = crypto.getRandomValues(new Uint32Array(1))[0]! % arr.length;
  return arr[i]!;
}

/** e.g. "quiet-otter-42" */
export function randomHandle(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 90;
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${10 + n}`;
}

/** Slugify a circle name into an ePDS-safe handle local part. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 20)
    .replace(/-+$/, '');
  return slug;
}

export function isValidHandlePart(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{3,18})[a-z0-9]$/.test(s) && !s.includes('--');
}
