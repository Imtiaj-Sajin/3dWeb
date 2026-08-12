// Small seeded 2D value-noise + fbm. Deterministic, no dependencies.

const PERM = new Uint8Array(512);
(() => {
  // xorshift-seeded permutation table so the world is identical every visit
  let s = 1337 >>> 0;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000) / 1000;
  };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

function hash(ix, iz) {
  return PERM[(PERM[ix & 255] + iz) & 255] / 255;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// Single octave of value noise, output in [-1, 1]
export function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  const u = smooth(fx);
  const v = smooth(fz);
  const val = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  return val * 2 - 1;
}

// Fractal brownian motion (3 octaves), output roughly in [-1, 1]
export function fbm2(x, z) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 3; i++) {
    sum += noise2(x * freq, z * freq) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / 0.875;
}
