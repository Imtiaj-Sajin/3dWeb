// Seeded pseudo-random numbers (mulberry32).
//
// Everything that decides where something *sits in the world* must come from
// here rather than Math.random, so that every player — and every reload —
// generates a byte-identical world. Without this, two people standing in the
// same spot would see trees in different places, and collision, the camera,
// and bird avoidance would all disagree about what is solid.
//
// Purely ambient motion (a bird's next destination, an NPC's next stroll) may
// still use Math.random: nothing can be hidden behind a bird.

export const WORLD_SEED = 0x5eed1a3f;

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
