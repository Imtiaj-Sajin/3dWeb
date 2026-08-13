// Terrain heightfield, road, and ground mesh with painted vertex colors.
// The height function is analytic, so walking never needs raycasts:
// characters just ask heightAt(x, z).

import * as THREE from 'three';
import { fbm2, noise2 } from './noise.js';
import { roadX } from '../shared/world.js';

// re-exported so the rest of the client keeps importing it from here, while
// the server imports the same definition straight from shared/
export { roadX };

const { smoothstep, lerp, clamp } = THREE.MathUtils;

export const WORLD_RADIUS = 96; // soft boundary for characters
export const TERRAIN_SIZE = 250;
const SEGMENTS = 190;

// ---------- road path ----------

export function roadDist(x, z) {
  return Math.abs(x - roadX(z));
}

// Height profile along the road: long soft rises and dips (the "crest" feel)
function roadProfile(z) {
  return fbm2(3.7, z * 0.012) * 5 + 1.4 * Math.sin(z * 0.02 + 0.7);
}

// ---------- height ----------

export function heightAt(x, z) {
  const hills =
    fbm2(x * 0.016, z * 0.016) * 6.5 +
    fbm2(x * 0.045 + 11.3, z * 0.045 + 7.7) * 1.1;

  const d = roadDist(x, z);
  const w = smoothstep(d, 3.8, 16); // 0 on the road, 1 in open land
  let h = lerp(roadProfile(z), hills, w);

  // Rim of tall dunes near the world edge hides the horizon line,
  // but the road corridor cuts through it.
  const r = Math.hypot(x, z);
  h += smoothstep(r, 70, 118) * 13 * smoothstep(d, 6, 18);
  return h;
}

// Approximate surface normal via central differences
export function normalAt(x, z, eps = 0.6) {
  const hl = heightAt(x - eps, z);
  const hr = heightAt(x + eps, z);
  const hd = heightAt(x, z - eps);
  const hu = heightAt(x, z + eps);
  return new THREE.Vector3(hl - hr, 2 * eps, hd - hu).normalize();
}

// ---------- colors ----------

const COL = {
  asphalt: new THREE.Color('#9fa6af'),
  asphaltDark: new THREE.Color('#8f97a2'),
  sand: new THREE.Color('#ecd6a4'),
  sandWarm: new THREE.Color('#e3c68f'),
  grassA: new THREE.Color('#84b665'),
  grassB: new THREE.Color('#6da354'),
  grassDark: new THREE.Color('#5c944b'),
};

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

// Ground color at a world position — also used to tint scattered props.
export function groundColorAt(x, z, out = new THREE.Color()) {
  const d = roadDist(x, z);
  const h = heightAt(x, z);

  // base grass: two greens mixed by broad noise, darker in low pockets
  const gmix = fbm2(x * 0.03 + 5.2, z * 0.03 + 9.1) * 0.5 + 0.5;
  out.copy(COL.grassA).lerp(COL.grassB, gmix);
  const pocket = smoothstep(fbm2(x * 0.02 + 21, z * 0.02 + 3), 0.15, 0.7);
  out.lerp(COL.grassDark, pocket * 0.5);

  // sandy patches scattered through the grass
  const patch = fbm2(x * 0.05 + 31, z * 0.05 + 17);
  out.lerp(tmpA.copy(COL.sand), smoothstep(patch, 0.42, 0.62) * 0.9);

  // high ground fades to sun-bleached sand (dune tops)
  out.lerp(tmpA.copy(COL.sandWarm), smoothstep(h, 5.5, 11) * 0.85);

  // road shoulder sand band
  out.lerp(tmpA.copy(COL.sand), 1 - smoothstep(d, 4.4, 6.8));

  // asphalt with subtle patchiness
  const amix = noise2(x * 0.12, z * 0.12) * 0.5 + 0.5;
  tmpB.copy(COL.asphalt).lerp(COL.asphaltDark, amix);
  out.lerp(tmpB, 1 - smoothstep(d, 3.4, 4.1));

  // gentle per-position brightness jitter for a painterly feel
  const jitter = 1 + noise2(x * 0.6 + 50, z * 0.6) * 0.035;
  out.r = clamp(out.r * jitter, 0, 1);
  out.g = clamp(out.g * jitter, 0, 1);
  out.b = clamp(out.b * jitter, 0, 1);
  return out;
}

// ---------- meshes ----------

export function buildTerrain() {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    groundColorAt(x, z, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// A flat ribbon that follows the road surface — used for paint lines & cracks.
// centerFn(z) returns the lateral offset from the road center at that z.
// y hugs the road: just enough clearance over the terrain mesh (which
// deviates <1cm from the analytic height on the road) without slicing
// through the feet of characters standing on the paint.
function buildRibbon(zStart, zEnd, step, width, offsetFn, y = 0.025) {
  const positions = [];
  const indices = [];
  const side = new THREE.Vector3();
  let row = 0;

  for (let z = zStart; z <= zEnd + 0.001; z += step, row++) {
    const cx = roadX(z) + offsetFn(z);
    // tangent of the road in XZ
    const dx = roadX(z + 0.5) - roadX(z - 0.5);
    side.set(1, 0, -dx).normalize(); // perpendicular to tangent (dx,0,1)
    const hw = width / 2;
    const x1 = cx - side.x * hw;
    const z1 = z - side.z * hw;
    const x2 = cx + side.x * hw;
    const z2 = z + side.z * hw;
    positions.push(x1, heightAt(x1, z1) + y, z1, x2, heightAt(x2, z2) + y, z2);
    if (row > 0) {
      const a = (row - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildRoadMarkings() {
  const group = new THREE.Group();
  group.name = 'road-markings';

  // DoubleSide: the ribbon winding faces down, and it's a handful of tris.
  // No polygonOffset — the ribbons sit 0.14 above the road, and offsetting
  // depth makes them draw on top of characters standing on them.
  const paint = new THREE.MeshBasicMaterial({
    color: '#f4ecd7',
    fog: true,
    side: THREE.DoubleSide,
  });

  // dashed center line
  const dashes = [];
  for (let z = -112; z < 112; z += 7.5) {
    dashes.push(buildRibbon(z, z + 3.2, 1.6, 0.24, () => 0));
  }
  // solid edge lines
  const edgeL = buildRibbon(-116, 116, 2, 0.3, () => -3.05);
  const edgeR = buildRibbon(-116, 116, 2, 0.3, () => 3.05);

  for (const g of [...dashes, edgeL, edgeR]) {
    group.add(new THREE.Mesh(g, paint));
  }

  // dark tar cracks wandering across the asphalt
  const crackMat = new THREE.MeshBasicMaterial({
    color: '#41454e',
    fog: true,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 9; i++) {
    const z0 = -100 + i * 22 + noise2(i * 3.7, 1.1) * 8;
    const wobble = 1.5 + Math.abs(noise2(i, 7)) * 1.5;
    const phase = noise2(i * 1.3, 4.4) * 10;
    const drift = noise2(i * 2.9, 8.2) * 2;
    const crack = buildRibbon(
      z0,
      z0 + 4 + Math.abs(noise2(i, 2)) * 5,
      0.7,
      0.09,
      (z) => Math.sin(z * wobble + phase) * 1.6 + drift,
      0.018
    );
    group.add(new THREE.Mesh(crack, crackMat));
  }

  return group;
}
