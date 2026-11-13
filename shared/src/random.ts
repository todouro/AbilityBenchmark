/**
 * Deterministic PRNG shared by the server and browser test modules.
 * The same seed always produces the same sequence in every JS runtime.
 */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = createSeededRandom(seed);
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }

  return shuffled;
}

export function seededIntegers(
  seed: string,
  count: number,
  min: number,
  max: number
): number[] {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > 10_000 ||
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    max < min
  ) {
    throw new RangeError("Invalid seeded integer sequence bounds.");
  }

  const random = createSeededRandom(seed);
  const width = max - min + 1;

  return Array.from({ length: count }, () => min + Math.floor(random() * width));
}
