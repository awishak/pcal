/**
 * Deterministic shuffling for randomised answer / question order.
 *
 * Randomising order removes primacy bias (people pick the first plausible
 * option), but it has to be *stable* for a given respondent, if the order
 * reshuffled on every render, clicking anything would be a lottery. So we
 * seed from the respondent key plus the question id: different people see
 * different orders, one person sees one order.
 */

/** FNV-1a, small, fast, good enough to seed a PRNG. */
function hashSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32, tiny seeded PRNG, uniform enough for shuffling. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher-Yates with a seeded PRNG. Same seed in, same order out.
 * Returns a new array; the input is untouched.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice()
  const rand = mulberry32(hashSeed(seed))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Shuffle only when `enabled`; otherwise hand back the original order. */
export function maybeShuffle<T>(items: readonly T[], enabled: boolean, seed: string): T[] {
  return enabled ? seededShuffle(items, seed) : items.slice()
}
